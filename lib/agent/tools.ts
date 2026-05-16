import { exec, execFile, spawn } from "child_process";
import { promisify } from "util";
import net from "net";
import fs from "fs/promises";
import path from "path";
import type { ToolDefinition } from "@/types";
import { appendMemory } from "@/lib/memoryClient";

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
        const child = spawn("sh", ["-c", cmd], {
          cwd,
          detached: true,
          stdio: "ignore",
        });
        child.unref();

        // If command has an explicit port, wait for that one
        if (explicitPort) {
          const port = parseInt(explicitPort[1]);
          const alive = await waitForPort(port, 4000);
          if (alive) return `Server started.\nOpen: http://localhost:${port}`;
          return `Server launching on port ${port}. Open: http://localhost:${port}`;
        }

        // No explicit port — probe common dev server ports (Vite=5173, CRA/Next=3000, webpack=8080, etc.)
        const COMMON_PORTS = [3000, 3001, 5173, 4200, 8080, 8000, 4000];
        const port = await waitForFirstPort(COMMON_PORTS, 5000);
        if (port) return `Server started.\nOpen: http://localhost:${port}`;
        return `Server process launched. Try: http://localhost:3000 or http://localhost:5173`;
      }

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

    case "web_search": {
      const query = args.query as string;
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      try {
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
      appendMemory(content);
      return "Remembered.";
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
