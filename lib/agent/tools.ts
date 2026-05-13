import { exec, execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import type { ToolDefinition } from "@/types";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List files and directories in the workspace or a subdirectory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within workspace. Defaults to root." },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Read the full contents of a file in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite a file. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file." },
        content: { type: "string", description: "Full file contents to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command inside the workspace. Use for npm, git, tests, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        cwd: { type: "string", description: "Optional relative subdirectory to run in." },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description: "Search for a string across workspace source files.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "String to search for." },
        path: { type: "string", description: "Optional subdirectory to scope the search." },
      },
      required: ["query"],
    },
  },
];

const BLOCKED = [/sudo/, /rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, />\s*\/dev\//];

export function assertSafePath(workspaceRoot: string, relPath: string): string {
  const resolved = path.resolve(workspaceRoot, relPath);
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error(`Path "${relPath}" escapes the workspace`);
  }
  return resolved;
}

const MAX_READ = 8_000;

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot: string
): Promise<string> {
  switch (name) {
    case "list_files": {
      const rel = (args.path as string | undefined) ?? ".";
      const resolved = assertSafePath(workspaceRoot, rel);
      const stat = await fs.stat(resolved).catch(() => null);
      const dir = stat?.isFile() ? path.dirname(resolved) : resolved;
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return (
        entries
          .map((e) => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`)
          .join("\n") || "(empty directory)"
      );
    }

    case "read_file": {
      const abs = assertSafePath(workspaceRoot, args.path as string);
      const content = await fs.readFile(abs, "utf-8");
      if (content.length > MAX_READ) {
        return (
          content.slice(0, MAX_READ) +
          `\n\n[truncated — ${content.length - MAX_READ} more chars]`
        );
      }
      return content;
    }

    case "write_file": {
      const abs = assertSafePath(workspaceRoot, args.path as string);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, args.content as string, "utf-8");
      return `Written: ${args.path}`;
    }

    case "run_command": {
      const cmd = args.command as string;
      for (const pattern of BLOCKED) {
        if (pattern.test(cmd)) {
          return `Blocked: command matches unsafe pattern "${pattern.source}"`;
        }
      }
      const cwd = args.cwd
        ? assertSafePath(workspaceRoot, args.cwd as string)
        : workspaceRoot;
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 30_000 });
        return (stdout + stderr).trim() || "(no output)";
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    }

    case "search_files": {
      const query = args.query as string;
      const searchPath = args.path
        ? assertSafePath(workspaceRoot, args.path as string)
        : workspaceRoot;

      const extensions = ["ts", "tsx", "js", "jsx", "json", "md"];
      const includeArgs = extensions.flatMap((ext) => ["--include", `*.${ext}`]);

      try {
        const { stdout } = await execFileAsync("grep", ["-r", "-n", ...includeArgs, query, "."], {
          cwd: searchPath,
        });
        return stdout.trim() || "No matches found";
      } catch (err) {
        // grep exits 1 when no matches found — that's not an error
        const execErr = err as { code?: number; stdout?: string };
        if (execErr.code === 1) return "No matches found";
        return "No matches found";
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
