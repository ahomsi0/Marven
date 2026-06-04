import { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import { executeTool } from "@/lib/agent/tools";

interface VerifyRequestBody {
  workspaceRoot?: string;
  commands?: string[];
}

const SCRIPT_ORDER = ["lint", "test", "build"] as const;

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

function packageManagerFor(root: string): Promise<"npm" | "pnpm" | "yarn" | "bun"> {
  const checks: Array<[string, "npm" | "pnpm" | "yarn" | "bun"]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ];

  return (async () => {
    for (const [filename, pm] of checks) {
      try {
        await fs.access(path.join(root, filename));
        return pm;
      } catch {
        // keep checking
      }
    }
    return "npm";
  })();
}

function isDefaultNpmTestScript(script: string): boolean {
  return /no test specified/i.test(script);
}

async function detectCommands(workspaceRoot: string): Promise<string[]> {
  try {
    const packageJsonPath = path.join(workspaceRoot, "package.json");
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    const pm = await packageManagerFor(workspaceRoot);

    return SCRIPT_ORDER.flatMap((name) => {
      const script = scripts[name];
      if (!script?.trim()) return [];
      if (name === "test" && isDefaultNpmTestScript(script)) return [];
      if (pm === "npm") return [name === "test" ? "npm test" : `npm run ${name}`];
      if (pm === "yarn") return [`yarn ${name}`];
      if (pm === "pnpm") return [`pnpm ${name}`];
      return [`bun run ${name}`];
    });
  } catch {
    return [];
  }
}

function commandFailed(output: string): boolean {
  return (
    /\[exit code:\s*[1-9]\d*\]/.test(output) ||
    output.startsWith("Command failed to start:") ||
    /\[killed: timed out after \d+ms\]/.test(output)
  );
}

export async function POST(req: NextRequest) {
  let body: VerifyRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const workspaceRoot = body.workspaceRoot?.trim() ?? "";
  if (!workspaceRoot) {
    return new Response("workspaceRoot is required", { status: 400 });
  }

  const requestedCommands = (body.commands ?? [])
    .map((c) => c.trim())
    .filter(Boolean);
  const commands = requestedCommands.length > 0
    ? requestedCommands
    : await detectCommands(workspaceRoot);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      if (commands.length === 0) {
        emit("text_delta", {
          type: "text_delta",
          delta: "Auto-verify skipped. No lint, test, or build scripts were detected in this workspace.",
        });
        emit("done", { type: "done", toolCallCount: 0 });
        controller.close();
        return;
      }

      let failures = 0;

      try {
        for (let i = 0; i < commands.length; i++) {
          const command = commands[i];
          const callId = `verify-${Date.now()}-${i}`;
          emit("tool_call", {
            type: "tool_call",
            callId,
            tool: "run_command",
            args: { command },
          });

          const output = await executeTool(
            "run_command",
            { command },
            workspaceRoot,
            (chunk) => emit("tool_progress", { type: "tool_progress", callId, chunk }),
          );

          if (commandFailed(output)) failures += 1;

          emit("tool_result", {
            type: "tool_result",
            callId,
            output,
            truncated: false,
          });
        }

        const summary =
          failures === 0
            ? `Auto-verify passed. Ran ${commands.length} command${commands.length !== 1 ? "s" : ""}.`
            : `Auto-verify found issues. ${failures} of ${commands.length} command${commands.length !== 1 ? "s" : ""} failed.`;
        emit("text_delta", { type: "text_delta", delta: summary });
        emit("done", { type: "done", toolCallCount: commands.length });
      } catch (error) {
        emit("error", {
          type: "error",
          code: "verify_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
