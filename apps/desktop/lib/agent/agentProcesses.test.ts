import { describe, it, expect, afterEach } from "vitest";
import { spawn, spawnSync } from "child_process";
import os from "os";
import {
  isLongRunningServerCommand,
  registerAgentProcess,
  agentProcessCount,
  killAgentProcesses,
} from "./agentProcesses";
import { streamShellCommand } from "./tools";

describe("isLongRunningServerCommand", () => {
  it.each([
    "npm run dev",
    "npm start",
    "npm run start",
    "pnpm dev",
    "yarn serve",
    "bun run preview",
    "npm run dev -- --port 3001",
    "cd web && npm run dev",
    "PORT=4000 npm start",
    "npx next dev",
    "next dev -p 3005",
    "npx vite",
    "vite --host",
    "vite preview --port 4173",
    "npx serve -s build",
    "python -m http.server 8000",
    "python3 -m http.server",
    "python manage.py runserver",
    "flask run --debug",
    "uvicorn app:app --reload",
    "php -S localhost:8000",
    "php artisan serve",
    "rails s",
    "bundle exec rails server",
    "ng serve",
    "hugo server",
    "nohup npm run dev > dev.log 2>&1",
  ])("treats %j as a dev server", (cmd) => {
    expect(isLongRunningServerCommand(cmd)).toBe(true);
  });

  it.each([
    "npm run build",
    "npm run test",
    "npm run lint",
    "npm test",
    "npm install",
    "npm run dev:build",
    "node script.js",
    "node server.js --help",
    "python3 analyze.py",
    "python script.py",
    "bun run build",
    "bun index.ts",
    "npx vite build",
    "vite build",
    "npx next build",
    "npx tsc --noEmit",
    "echo serve",
    "ls -la",
    "cat package.json | grep dev",
  ])("runs %j normally", (cmd) => {
    expect(isLongRunningServerCommand(cmd)).toBe(false);
  });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(pred: () => boolean, ms = 3000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return pred();
}

const unix = process.platform !== "win32";
const hasPerl = unix && spawnSync("perl", ["-e", "1"]).status === 0;

describe.skipIf(!unix)("streamShellCommand", () => {
  const strays: number[] = [];
  afterEach(() => {
    for (const pid of strays.splice(0)) {
      try { process.kill(pid, "SIGKILL"); } catch { /* gone */ }
    }
  });

  it("returns normal output and exit codes", async () => {
    expect(await streamShellCommand("echo hi", os.tmpdir(), () => {})).toBe("hi\n");
    expect(await streamShellCommand("echo oops; exit 3", os.tmpdir(), () => {})).toBe("oops\n\n[exit code: 3]");
  });

  it("kills the whole process group on timeout, grandchildren included", async () => {
    const started = Date.now();
    const out = await streamShellCommand("sleep 30 & echo GRANDCHILD=$!; wait", os.tmpdir(), () => {}, 400);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(out).toContain("[killed: timed out after 400ms]");
    const pid = Number(/GRANDCHILD=(\d+)/.exec(out)?.[1]);
    expect(pid).toBeGreaterThan(0);
    strays.push(pid);
    expect(await waitFor(() => !isAlive(pid))).toBe(true);
  });

  it.skipIf(!hasPerl)("resolves after exit even when an escaped grandchild keeps the pipes open", async () => {
    // The perl child moves itself into its own process group, so the group
    // kill can't reach it and it keeps stdout open — 'close' never fires.
    const started = Date.now();
    const out = await streamShellCommand(
      `perl -e '$|=1; setpgrp(0,0); print "STRAY=$$\\n"; sleep 30' & sleep 0.3; echo done`,
      os.tmpdir(),
      () => {},
      10_000,
    );
    const pid = Number(/STRAY=(\d+)/.exec(out)?.[1]);
    if (pid) strays.push(pid);
    expect(out).toContain("done");
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe.skipIf(!unix)("agent process registry", () => {
  it("tracks detached processes and kills their trees on demand", async () => {
    const child = spawn("sh", ["-c", "sleep 30 & echo $!; wait"], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    child.unref();
    const grandchild = await new Promise<number>((resolve) => {
      child.stdout!.once("data", (b: Buffer) => resolve(Number(b.toString().trim())));
    });
    const before = agentProcessCount();
    registerAgentProcess(child);
    expect(agentProcessCount()).toBe(before + 1);

    const kill = (globalThis as { __marvenKillAgentProcesses?: () => number }).__marvenKillAgentProcesses;
    expect(typeof kill).toBe("function");
    expect(kill!()).toBeGreaterThanOrEqual(1);
    expect(agentProcessCount()).toBe(0);
    expect(await waitFor(() => !isAlive(grandchild))).toBe(true);
    expect(await waitFor(() => !isAlive(child.pid!))).toBe(true);
    killAgentProcesses(); // idempotent
  });
});
