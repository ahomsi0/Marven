import { exec, execFile, spawn } from "child_process";
import { promisify } from "util";
import net from "net";
import fs from "fs/promises";
import path from "path";
import type { ToolDefinition } from "@/types";
import { appendMemory } from "@/lib/memoryClient";
import { runGit } from "./git";

const GIT_MUTATION_TOOLS = new Set(["git_commit", "git_branch", "git_checkout"]);
export function isGitMutation(toolName: string): boolean {
  return GIT_MUTATION_TOOLS.has(toolName);
}

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
    description: "Run a shell command inside the workspace. Use for npm install, git, tests, builds, etc. Server-starting commands (node server.js, npm start, python -m http.server, etc.) are automatically run in the background and return the local URL immediately.",
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
  {
    name: "web_search",
    description: "Search the web for information using DuckDuckGo. Returns abstracts and top related results.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description: "Fetch the content of a URL and return it as plain text (HTML stripped). Useful for reading documentation, GitHub files, or API responses.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch." },
      },
      required: ["url"],
    },
  },
  {
    name: "remember",
    description: "Save information to persistent memory for future agent sessions. Use for user preferences, project context, or recurring facts.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The information to save to memory." },
      },
      required: ["content"],
    },
  },
  {
    name: "git_status",
    description: "Show the working tree status of the current workspace (porcelain v1 format).",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "git_diff",
    description: "Show unstaged changes. If `path` is provided, diff only that file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional file path relative to workspace root" },
      },
      required: [],
    },
  },
  {
    name: "git_log",
    description: "Show the last 10 commits as a one-line summary.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "git_commit",
    description: "Stage all changes and create a commit with the given message. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The commit message" },
      },
      required: ["message"],
    },
  },
  {
    name: "git_branch",
    description: "Create a new branch (if create=true) or switch to an existing one. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The branch name" },
        create: { type: "boolean", description: "If true, create the branch before switching" },
      },
      required: ["name"],
    },
  },
  {
    name: "git_checkout",
    description: "Restore a file from HEAD or switch to a branch. Requires user approval.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "A branch name or file path" },
      },
      required: ["target"],
    },
  },
];

const BLOCKED = [/sudo/, /rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, />\s*\/dev\//];

export function formatWebSearchResult(data: {
  AbstractText?: string;
  AbstractURL?: string;
  RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: unknown[] }>;
}): string {
  const lines: string[] = [];
  if (data.AbstractText) {
    lines.push(data.AbstractText);
    if (data.AbstractURL) lines.push(`Source: ${data.AbstractURL}`);
    lines.push("");
  }
  const topics = (data.RelatedTopics ?? [])
    .filter((t) => t.Text && !t.Topics)
    .slice(0, 5);
  if (topics.length > 0) {
    lines.push("Related:");
    for (const t of topics) {
      lines.push(`- ${t.Text}${t.FirstURL ? ` (${t.FirstURL})` : ""}`);
    }
  }
  return lines.join("\n").trim() || "No results found.";
}

export function assertSafePath(workspaceRoot: string, relPath: string): string {
  const resolved = path.resolve(workspaceRoot, relPath);
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error(`Path "${relPath}" escapes the workspace`);
  }
  return resolved;
}

const MAX_READ = 8_000;

function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(start, () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on("error", () => {
      findFreePort(start + 1).then(resolve, reject);
    });
  });
}

function waitForFirstPort(ports: number[], timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    let resolved = false;
    function attempt() {
      if (resolved) return;
      if (Date.now() >= deadline) { resolve(null); return; }
      let pending = ports.length;
      for (const port of ports) {
        const sock = net.createConnection({ port, host: "127.0.0.1" });
        sock.once("connect", () => {
          if (!resolved) { resolved = true; sock.destroy(); resolve(port); }
          else sock.destroy();
        });
        sock.once("error", () => {
          sock.destroy();
          if (--pending === 0) setTimeout(attempt, 250);
        });
      }
    }
    attempt();
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    function attempt() {
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => { sock.destroy(); resolve(true); });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() < deadline) setTimeout(attempt, 200);
        else resolve(false);
      });
    }
    attempt();
  });
}

function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port, host: "127.0.0.1" });
    const finish = (open: boolean) => { sock.destroy(); resolve(open); };
    sock.once("connect", () => finish(true));
    sock.once("error", () => finish(false));
    setTimeout(() => finish(false), 250);
  });
}

async function snapshotOpenPorts(ports: number[]): Promise<Set<number>> {
  const results = await Promise.all(ports.map(async (p) => ({ p, open: await isPortOpen(p) })));
  return new Set(results.filter((r) => r.open).map((r) => r.p));
}

// Pick an interpreter that exists on the host. On Unix we use `sh -c`, on
// Windows we use `cmd.exe /d /s /c` — sh is not installed by default and the
// previous hardcoded "sh" call simply failed silently on Windows, leaving
// `npm start` and friends unable to launch from the agent.
function shellInvocation(command: string): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    return { shell: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", command] };
  }
  return { shell: "sh", args: ["-c", command] };
}

async function streamShellCommand(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void,
  timeoutMs = 30_000,
): Promise<string> {
  return new Promise((resolve) => {
    let acc = "";
    let killed = false;
    const { shell, args } = shellInvocation(command);
    const child = spawn(shell, args, { cwd, windowsHide: true });
    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    const handle = (buf: Buffer) => {
      const chunk = buf.toString("utf8");
      acc += chunk;
      onChunk(chunk);
    };
    child.stdout.on("data", handle);
    child.stderr.on("data", handle);

    child.on("close", (code) => {
      clearTimeout(timer);
      const suffix = killed
        ? `\n[killed: timed out after ${timeoutMs}ms]`
        : code === 0 ? "" : `\n[exit code: ${code}]`;
      resolve((acc + suffix).slice(0, 8000));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(`Command failed to start: ${err.message}`);
    });
  });
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
  onProgress?: (chunk: string) => void,
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
      // Models sometimes emit literal \n instead of actual newlines
      const content = (args.content as string)
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\r/g, "\r");
      await fs.writeFile(abs, content, "utf-8");
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

      // Detect server-starting commands — run them in background and return the URL
      const serverPattern = /(?:^|\s)(node\s+\S+\.(?:js|mjs)|python\s+-m\s+http\.server|python3?\s+\S+\.py|npx?\s+serve|npm\s+(?:start|run\s+\S+)|bun\s+(?:run\s+\S+|\S+\.(?:js|ts)))\b/i;
      const explicitPort = cmd.match(/\b(3\d{3}|4\d{3}|5\d{3}|8\d{3}|9\d{3})\b/);
      if (serverPattern.test(cmd)) {
        // Snapshot which ports are ALREADY open (Marven itself runs on 3000 in dev,
        // and other services may be running) — so we only pick a NEW port that
        // appears after we spawn the child.
        const COMMON_PORTS = [3000, 3001, 5173, 4200, 8080, 8000, 4000, 4321, 4173];
        const portsToWatch = explicitPort ? [parseInt(explicitPort[1])] : COMMON_PORTS;
        const alreadyOpen = explicitPort ? new Set<number>() : await snapshotOpenPorts(portsToWatch);

        // Pipe stdio so we can read the URL the server prints. Detached + unref
        // means the child survives this request handler returning. Pick a shell
        // that actually exists on the host (sh on Unix, cmd.exe on Windows) —
        // hardcoding "sh" used to silently fail on Windows so npm start never
        // ran and the user got an empty localhost page.
        const { shell, args: shellArgs } = shellInvocation(cmd);
        const child = spawn(shell, shellArgs, {
          cwd,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        child.unref();

        const urlFromOutput = new Promise<string | null>((resolve) => {
          const matcher = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d+))?(?:\/\S*)?/i;
          const handle = (buf: Buffer) => {
            const m = buf.toString().match(matcher);
            if (m) resolve(m[0].replace("0.0.0.0", "localhost").replace(/\/$/, ""));
          };
          child.stdout?.on("data", handle);
          child.stderr?.on("data", handle);
          // Drain streams so the child doesn't stall on full pipe buffers, even
          // after we've found a URL (we keep listening so they get consumed).
          setTimeout(() => resolve(null), 20_000);
        });

        const newPort = (async () => {
          const deadline = Date.now() + 20_000;
          while (Date.now() < deadline) {
            for (const p of portsToWatch) {
              if (alreadyOpen.has(p)) continue;
              if (await isPortOpen(p)) return p;
            }
            await new Promise((r) => setTimeout(r, 400));
          }
          return null;
        })();

        const winner = await Promise.race([
          urlFromOutput.then((u) => (u ? { kind: "url" as const, value: u } : null)),
          newPort.then((p) => (p ? { kind: "port" as const, value: p } : null)),
        ]);

        let resolvedUrl: string | null = null;
        if (winner?.kind === "url") resolvedUrl = winner.value;
        else if (winner?.kind === "port") resolvedUrl = `http://localhost:${winner.value}`;
        // Race-loser fallbacks — wait a beat more on whichever didn't win.
        if (!resolvedUrl) {
          const p = await newPort;
          if (p) resolvedUrl = `http://localhost:${p}`;
        }
        if (!resolvedUrl) {
          const u = await urlFromOutput;
          if (u) resolvedUrl = u;
        }

        if (resolvedUrl) {
          return `SERVER READY at ${resolvedUrl}\n\nTell the user the URL is ${resolvedUrl}. Format it as a clickable link.\n\nLive URL: ${resolvedUrl}`;
        }
        return `SERVER LAUNCHING but no URL detected within 20s. Tell the user the server is starting in the background — they can try http://localhost:3000 or http://localhost:5173 once it's ready.`;
      }

      const output = await streamShellCommand(cmd, cwd, (chunk) => onProgress?.(chunk));
      return output || "(no output)";
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

    case "web_search": {
      const query = args.query as string;
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      try {
        if (!query.trim()) {
          return "Search failed: query must not be empty.";
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        const data = await res.json() as {
          AbstractText?: string;
          AbstractURL?: string;
          RelatedTopics?: Array<{ Text?: string; FirstURL?: string; Topics?: unknown[] }>;
        };
        return formatWebSearchResult(data);
      } catch (err) {
        return `Search failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    case "fetch_url": {
      const url = args.url as string;
      try {
        if (!/^https?:\/\//i.test(url)) {
          return `Fetch failed: only http:// and https:// URLs are supported.`;
        }
        // SSRF note: loopback/LAN addresses are reachable on a desktop app.
        // Accepted risk — the AI is a trusted local agent with workspace access.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) return `Error ${res.status}: ${res.statusText}`;
        const text = await res.text();
        const stripped = text
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        return stripped.length > 8_000
          ? stripped.slice(0, 8_000) + "\n[truncated]"
          : stripped;
      } catch (err) {
        return `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    case "remember": {
      const content = args.content as string;
      try {
        appendMemory(content);
        return "Remembered.";
      } catch (err) {
        return `Remember failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    case "git_status":
      return runGit(["status", "--porcelain=v1"], workspaceRoot);

    case "git_diff": {
      const path = (args.path as string | undefined)?.trim();
      return runGit(path ? ["diff", "--", path] : ["diff"], workspaceRoot);
    }

    case "git_log":
      return runGit(["log", "--oneline", "-10"], workspaceRoot);

    case "git_commit": {
      const message = (args.message as string | undefined)?.trim();
      if (!message) return "git_commit failed: message is required.";
      const addOut = await runGit(["add", "-A"], workspaceRoot);
      if (addOut.startsWith("Git error:") || addOut.startsWith("Not a git repository") || addOut.startsWith("Git is not installed")) return addOut;
      return runGit(["commit", "-m", message], workspaceRoot);
    }

    case "git_branch": {
      const branchName = (args.name as string | undefined)?.trim();
      if (!branchName) return "git_branch failed: name is required.";
      const create = args.create === true;
      return runGit(create ? ["checkout", "-b", branchName] : ["checkout", branchName], workspaceRoot);
    }

    case "git_checkout": {
      const target = (args.target as string | undefined)?.trim();
      if (!target) return "git_checkout failed: target is required.";
      return runGit(["checkout", target], workspaceRoot);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
