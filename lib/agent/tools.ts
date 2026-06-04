import { exec, execFile, spawn } from "child_process";
import { promisify } from "util";
import net from "net";
import fs from "fs/promises";
import path from "path";
import type { ToolDefinition } from "@/types";
import { appendScopedMemory, type MemoryContext, type MemoryScope } from "@/lib/memoryClient";
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
    description: "Write or overwrite a file. Creates parent directories if needed. PREFER apply_patch for small/medium edits to existing files — it's faster, cheaper, and safer than re-sending the whole file.",
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
    name: "apply_patch",
    description: "Apply surgical search-and-replace edits to an EXISTING file. Strongly preferred over write_file for small/medium changes — it only sends the snippets that change, not the whole file. Each edit's 'search' text must match exactly (whitespace-sensitive) and must be unique within the file. If a snippet appears more than once, include enough surrounding context to make it unique. To delete code, set 'replace' to an empty string. Edits apply in order.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file. The file must already exist." },
        edits: {
          type: "array",
          description: "Ordered list of search/replace edits.",
          items: {
            type: "object",
            properties: {
              search:  { type: "string", description: "Exact text to find in the file. Whitespace-sensitive. Must be unique (use surrounding context if not)." },
              replace: { type: "string", description: "Text to substitute. Empty string to delete." },
            },
            required: ["search", "replace"],
          },
        },
      },
      required: ["path", "edits"],
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
    description: "Save information to persistent memory for future sessions. Use scope='global' for durable user preferences, scope='project' for repo-specific context, and scope='conversation' for task-local notes. If scope is omitted, default is project when a workspace exists, otherwise global.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "The information to save to memory." },
        scope: { type: "string", description: "Optional memory scope: global, project, or conversation." },
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
  {
    name: "search_codebase",
    description:
      "Semantic search across the workspace. Returns code chunks ranked by meaning, not just keywords. Use this BEFORE search_files when looking for concepts, patterns, or 'where do we do X' questions.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
        limit: {
          type: "number",
          description: "Number of chunks to return. Default 8, max 20.",
        },
      },
      required: ["query"],
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

const FIND_IGNORED = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".turbo",
  ".cache",
  "coverage",
  ".worktrees",
  ".vercel",
]);

/**
 * Search the workspace (up to two levels deep) for files whose basename
 * exactly matches `basename`. Used by the write_file phantom-directory guard
 * to suggest real paths when the model invents a non-existent parent folder.
 */
async function findFilesByBasename(
  workspaceRoot: string,
  basename: string,
  maxResults: number,
): Promise<string[]> {
  const matches: string[] = [];

  async function scan(dir: string, depth: number): Promise<void> {
    if (matches.length >= maxResults || depth > 2) return;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= maxResults) return;
      if (FIND_IGNORED.has(entry.name) || entry.name.startsWith(".")) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scan(abs, depth + 1);
      } else if (entry.name === basename) {
        matches.push(path.relative(workspaceRoot, abs));
      }
    }
  }

  await scan(workspaceRoot, 0);
  return matches;
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
  /**
   * Set of absolute paths the agent has read in the current loop run.
   * Populated by the `read_file` case and consulted by the `write_file` case
   * to enforce read-before-write on existing files and guard against
   * catastrophic shrink-overwrites. Optional — when omitted, guards are skipped
   * (preserves existing test/CLI behavior).
   */
  recentReads?: Set<string>,
  memoryContext?: MemoryContext,
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
      // Record the read so write_file can verify the file was actually
      // inspected before the model overwrites it.
      recentReads?.add(abs);
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
      const parentDir = path.dirname(abs);

      // Phantom-directory guard: if the parent directory doesn't exist AND a
      // file with the same basename already lives somewhere in the workspace,
      // refuse the write and suggest the real location. Catches the common
      // weak-model failure of writing `public/style.css` when only `style.css`
      // exists at the root.
      if (parentDir !== workspaceRoot) {
        let parentExists = true;
        try {
          await fs.stat(parentDir);
        } catch {
          parentExists = false;
        }
        if (!parentExists) {
          const basename = path.basename(abs);
          const matches = await findFilesByBasename(workspaceRoot, basename, 5);
          if (matches.length > 0) {
            const rel = path.relative(workspaceRoot, parentDir);
            const list = matches.map((m) => `- ${m}`).join("\n");
            return `write_file refused: directory "${rel}/" does not exist in the workspace, but a file named "${basename}" already exists here:\n${list}\nDid you mean one of those paths? Re-call write_file with the correct path.`;
          }
        }
      }

      // Unescape literal \n / \t / \r the way the file expects them.
      const content = (args.content as string)
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\r/g, "\r");

      // Determine if the target file already exists and grab its size for
      // the read-before-write + size-shrink guards.
      let existingSize: number | null = null;
      try {
        const st = await fs.stat(abs);
        if (st.isFile()) existingSize = st.size;
      } catch {
        existingSize = null;
      }

      // Guards only apply when the file already exists AND we have read-set
      // tracking enabled (i.e. running inside the agent loop). In tests and
      // CLI usage where recentReads is undefined we leave behavior unchanged.
      if (existingSize !== null && recentReads) {
        const wasRead = recentReads.has(abs);

        // Read-before-write guard — model is about to overwrite content it
        // never inspected this session. Refuse and tell it to read first.
        if (!wasRead) {
          return `write_file refused: "${args.path}" already exists (${existingSize} bytes) but you have NOT called read_file on it in this conversation. Refusing to overwrite unseen content. Call read_file("${args.path}") first, then re-issue write_file with the full new content that preserves what should stay.`;
        }

        // Size-shrink sanity guard — even after a read, if the model is
        // dumping back <30% of what it read, that's almost certainly an
        // accidental wipe. Refuse and ask for the full content.
        const SHRINK_THRESHOLD = 0.3;
        if (
          existingSize >= 500 &&
          content.length < existingSize * SHRINK_THRESHOLD
        ) {
          return `write_file refused: new content is ${content.length} bytes but the existing "${args.path}" is ${existingSize} bytes — that's a ${Math.round((1 - content.length / existingSize) * 100)}% reduction. This usually means you forgot to include the existing content. Re-call write_file with the FULL file (existing content + your additions/changes). If you genuinely intend to shrink the file, delete it first or rewrite it explicitly.`;
        }
      }

      await fs.mkdir(parentDir, { recursive: true });
      await fs.writeFile(abs, content, "utf-8");
      return `Written: ${args.path}`;
    }

    case "apply_patch": {
      const abs = assertSafePath(workspaceRoot, args.path as string);
      const rawEdits = args.edits;
      if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
        return `apply_patch failed: edits must be a non-empty array.`;
      }

      // Unescape literal \n / \t / \r the same way write_file does — models
      // sometimes serialize newlines as backslash-n inside JSON strings.
      function unescape(s: unknown): string {
        return typeof s === "string"
          ? s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
          : "";
      }

      const edits = rawEdits.map((e: unknown) => {
        const o = (e ?? {}) as { search?: unknown; replace?: unknown };
        return { search: unescape(o.search), replace: unescape(o.replace) };
      });

      // Validate before touching disk — bail with a clear message rather
      // than half-applying.
      let original: string;
      try {
        original = await fs.readFile(abs, "utf-8");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `apply_patch failed: could not read ${args.path}. ${msg}`;
      }

      let next = original;
      const summaries: string[] = [];
      for (let i = 0; i < edits.length; i++) {
        const { search, replace } = edits[i];
        if (!search) {
          return `apply_patch failed at edit #${i + 1}: 'search' is empty. To create a new file use write_file instead.`;
        }
        const firstIdx = next.indexOf(search);
        if (firstIdx === -1) {
          return `apply_patch failed at edit #${i + 1}: 'search' text not found in ${args.path}. The text must match EXACTLY including whitespace. Read the file again, copy the snippet to replace, and retry. No edits were committed.`;
        }
        const secondIdx = next.indexOf(search, firstIdx + 1);
        if (secondIdx !== -1) {
          return `apply_patch failed at edit #${i + 1}: 'search' text appears multiple times in ${args.path}. Add 1-2 lines of surrounding context (before/after) so the snippet is unique, then retry. No edits were committed.`;
        }
        next = next.slice(0, firstIdx) + replace + next.slice(firstIdx + search.length);
        const delta = replace.length - search.length;
        summaries.push(
          replace.length === 0
            ? `#${i + 1}: deleted ${search.length} chars`
            : delta > 0
              ? `#${i + 1}: +${delta} chars`
              : delta < 0
                ? `#${i + 1}: ${delta} chars`
                : `#${i + 1}: rewrote ${search.length} chars`,
        );
      }

      if (next === original) {
        return `apply_patch ok — no net change (all edits were no-ops).`;
      }

      await fs.writeFile(abs, next, "utf-8");
      return `apply_patch ok — ${edits.length} edit(s) applied to ${args.path}\n${summaries.join("\n")}`;
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
        const requestedScope = (args.scope as string | undefined)?.trim();
        const scope: MemoryScope =
          requestedScope === "global" || requestedScope === "project" || requestedScope === "conversation"
            ? requestedScope
            : workspaceRoot ? "project" : "global";
        appendScopedMemory(content, scope, {
          workspaceRoot,
          conversationId: memoryContext?.conversationId,
        });
        return `Remembered in ${scope} memory.`;
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

    case "search_codebase": {
      const mod = await import("@/lib/index/search");
      const limit = typeof args.limit === "number" ? args.limit : 8;
      const results = await mod.searchCodebase({
        workspaceRoot,
        query: String(args.query ?? ""),
        limit,
      });
      if (!Array.isArray(results)) return JSON.stringify(results);
      if (results.length === 0) return "No matches.";
      return results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.path}:${r.startLine + 1}-${r.endLine + 1} (distance ${r.distance.toFixed(3)})\n${r.text}`,
        )
        .join("\n\n");
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
