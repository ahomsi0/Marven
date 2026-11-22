// lib/agent/agentProcesses.ts — process bookkeeping for the agent's run_command
// tool: which commands are long-running dev servers, killing a command's
// whole process tree, and a registry of live child processes so they can all
// be killed when the app quits.

import { spawn, type ChildProcess } from "child_process";

// ── Server detection ─────────────────────────────────────────────────────────

/**
 * Anchored patterns, tested against each simple-command segment of the line
 * (after stripping env assignments and wrappers like `nohup`). Kept narrow on
 * purpose: only commands that start a server and never exit on their own.
 * Anything else (builds, tests, `node script.js`, `python3 x.py`, arbitrary
 * `npm run <script>`) runs normally so its output reaches the model.
 */
const SERVER_SEGMENT_PATTERNS: RegExp[] = [
  // npm/pnpm/yarn/bun scripts with a conventional server name.
  /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|preview)(?:\s|$)/i,
  /^deno\s+task\s+(?:dev|start|serve|preview)(?:\s|$)/i,
  // Framework/dev-server CLIs, optionally through npx / pnpm exec / bunx.
  /^(?:(?:npx|bunx|pnpm\s+(?:exec|dlx)|yarn\s+dlx|bun\s+x)\s+(?:-y\s+|--yes\s+)?)?(?:next\s+(?:dev|start)|vite(?:\s+(?:dev|serve|preview))?(?=\s+-|\s*$)|nuxt\s+dev|nuxi\s+dev|astro\s+(?:dev|preview)|remix\s+dev|gatsby\s+develop|ng\s+serve|vue-cli-service\s+serve|webpack\s+serve|webpack-dev-server|http-server|live-server|serve|nodemon)(?:\s|$)/i,
  /^python3?\s+-m\s+http\.server(?:\s|$)/i,
  /^python3?\s+manage\.py\s+runserver(?:\s|$)/i,
  /^(?:flask\s+run|uvicorn|gunicorn|hypercorn)(?:\s|$)/i,
  /^php\s+(?:-S\s|artisan\s+serve(?:\s|$))/i,
  /^(?:bin\/)?(?:bundle\s+exec\s+)?rails\s+(?:s|server)(?:\s|$)/i,
  /^(?:bundle\s+exec\s+)?jekyll\s+serve(?:\s|$)/i,
  /^hugo\s+server?(?:\s|$)/i,
];

/** True when `cmd` starts a long-running dev server (run detached in the background). */
export function isLongRunningServerCommand(cmd: string): boolean {
  if (typeof cmd !== "string") return false;
  const segments = cmd.split(/&&|\|\||[;&|\n]/);
  return segments.some((raw) => {
    const seg = raw
      .trim()
      .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "")
      .replace(/^(?:(?:nohup|exec|time|env)\s+)+/, "")
      .replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
    return seg.length > 0 && SERVER_SEGMENT_PATTERNS.some((re) => re.test(seg));
  });
}

// ── Process tree kill ────────────────────────────────────────────────────────

/**
 * Kill a child and everything it spawned. On Unix the child must have been
 * spawned with `detached: true` (its own process group), so signalling the
 * negative pid reaches the shell, its children and grandchildren. Killing
 * only the shell leaves grandchildren holding stdout/stderr open, so the
 * child's 'close' event would never fire.
 */
export function killProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } catch {
      try { child.kill(signal); } catch { /* already gone */ }
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // Not a group leader (or already gone) — fall back to the child itself.
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

// On globalThis so every Next route bundle shares one registry (same pattern
// as approvals.ts / checkpointStore.ts), and so Electron's main process can
// reach the kill function when Next runs in-process (packaged builds).
const g = globalThis as typeof globalThis & {
  __marvenAgentProcesses?: Set<ChildProcess>;
  __marvenKillAgentProcesses?: () => number;
};
if (!g.__marvenAgentProcesses) g.__marvenAgentProcesses = new Set();
const registry = g.__marvenAgentProcesses;

/** Track a child until it exits. */
export function registerAgentProcess(child: ChildProcess): void {
  if (!child.pid) return;
  registry.add(child);
  const forget = () => registry.delete(child);
  child.once("exit", forget);
  child.once("error", forget);
}

/** Number of tracked, still-running agent processes. */
export function agentProcessCount(): number {
  return registry.size;
}

/** Kill every tracked agent process tree (dev servers etc.). Returns how many were signalled. */
export function killAgentProcesses(): number {
  let n = 0;
  for (const child of registry) {
    killProcessTree(child, "SIGKILL");
    n++;
  }
  registry.clear();
  return n;
}

g.__marvenKillAgentProcesses = killAgentProcesses;
