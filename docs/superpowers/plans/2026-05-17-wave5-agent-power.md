# Wave 5 — Agent Power Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add git tools (with approval gating for mutations), a checkpoint-based diff viewer panel, and live streaming of `run_command` output.

**Architecture:** Three isolated pieces — git tools shell to `git` via `execFile`; mutations pause on a `pendingApprovals` Map until the UI POSTs to `/api/agent/approve`; a checkpoint map snapshots file contents before writes, and a new `DiffPanel.tsx` renders unified diffs with per-file revert; `run_command` switches from `exec` to `spawn` and forwards each line as a `tool_progress` SSE event.

**Tech Stack:** Next.js 15 App Router, Electron 41, TypeScript, Tailwind CSS v4, `diff` npm package, Node `child_process`.

---

## Task 1: Type Extensions

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Extend `AgentEvent` union and `ToolCallState`**

Replace the existing `AgentEvent` type (lines 149-156) and `ToolCallState` interface (lines 172-178) with:

```ts
export type AgentEventType =
  | "tool_call"
  | "tool_result"
  | "tool_progress"
  | "pending_approval"
  | "checkpoint"
  | "text_delta"
  | "done"
  | "error";

export type AgentEvent =
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "tool_result"; callId: string; output: string; truncated: boolean }
  | { type: "tool_progress"; callId: string; chunk: string }
  | { type: "pending_approval"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "checkpoint"; path: string }
  | { type: "text_delta"; delta: string }
  | { type: "done"; toolCallCount: number }
  | { type: "error"; code: string; message: string; suggestions?: string[] };

export interface ToolCallState {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "awaiting_approval" | "done" | "error" | "rejected";
  output?: string;
  liveOutput?: string;
}

export interface DiffEntry {
  path: string;
  before: string | null;
  after: string | null;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean (unused type warnings on DiffEntry are fine at this stage).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: extend AgentEvent for progress/approval, add DiffEntry"
```

---

## Task 2: Git Helper Library

**Files:**
- Create: `lib/agent/git.ts`
- Create: `lib/agent/git.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/agent/git.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { runGit } from "./git";
import { execFile } from "child_process";

vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

describe("runGit", () => {
  beforeEach(() => {
    vi.mocked(execFile).mockReset();
  });

  it("returns stdout on success", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
      (cb as any)(null, "on branch main\n", "");
      return {} as any;
    });
    const out = await runGit(["status"], "/tmp/repo");
    expect(out).toBe("on branch main");
  });

  it("returns 'not a git repository' message when git rev-parse fails", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
      const err: any = new Error("fatal: not a git repository");
      err.code = 128;
      (cb as any)(err, "", "fatal: not a git repository");
      return {} as any;
    });
    const out = await runGit(["status"], "/tmp/notrepo");
    expect(out).toMatch(/not a git repository/i);
  });

  it("returns ENOENT message when git is not installed", async () => {
    vi.mocked(execFile).mockImplementation((cmd, args, opts, cb) => {
      const err: any = new Error("spawn git ENOENT");
      err.code = "ENOENT";
      (cb as any)(err, "", "");
      return {} as any;
    });
    const out = await runGit(["status"], "/tmp/repo");
    expect(out).toMatch(/git is not installed/i);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run lib/agent/git.test.ts
```
Expected: FAIL — `runGit` not defined.

- [ ] **Step 3: Implement `lib/agent/git.ts`**

```ts
import { execFile } from "child_process";

export function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const anyErr = err as NodeJS.ErrnoException;
        if (anyErr.code === "ENOENT") {
          resolve("Git is not installed or not in PATH.");
          return;
        }
        const text = (stderr || stdout || err.message || "").trim();
        if (/not a git repository/i.test(text)) {
          resolve("Not a git repository.");
          return;
        }
        resolve(`Git error: ${text}`);
        return;
      }
      resolve(stdout.toString().trim());
    });
  });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run lib/agent/git.test.ts
```
Expected: 3/3 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/git.ts lib/agent/git.test.ts
git commit -m "feat: add runGit helper with error normalization"
```

---

## Task 3: Approval-Gate Module

**Files:**
- Create: `lib/agent/approvals.ts`
- Create: `lib/agent/approvals.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/agent/approvals.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { registerApproval, resolveApproval, hasPending } from "./approvals";

describe("approvals", () => {
  it("resolves with accept=true", async () => {
    const p = registerApproval("call-1", 1000);
    queueMicrotask(() => resolveApproval("call-1", true));
    await expect(p).resolves.toBe(true);
  });

  it("resolves with accept=false", async () => {
    const p = registerApproval("call-2", 1000);
    queueMicrotask(() => resolveApproval("call-2", false));
    await expect(p).resolves.toBe(false);
  });

  it("auto-rejects after timeout", async () => {
    vi.useFakeTimers();
    const p = registerApproval("call-3", 100);
    vi.advanceTimersByTime(150);
    await expect(p).resolves.toBe(false);
    vi.useRealTimers();
  });

  it("hasPending returns true while gated, false after resolve", () => {
    registerApproval("call-4", 1000);
    expect(hasPending("call-4")).toBe(true);
    resolveApproval("call-4", true);
    expect(hasPending("call-4")).toBe(false);
  });

  it("resolveApproval is a no-op for unknown callId", () => {
    expect(() => resolveApproval("nope", true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run lib/agent/approvals.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `lib/agent/approvals.ts`**

```ts
type Resolver = (accept: boolean) => void;

interface Pending {
  resolve: Resolver;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

export function registerApproval(callId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pending.has(callId)) {
        pending.delete(callId);
        resolve(false);
      }
    }, timeoutMs);
    pending.set(callId, { resolve, timer });
  });
}

export function resolveApproval(callId: string, accept: boolean): boolean {
  const entry = pending.get(callId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(callId);
  entry.resolve(accept);
  return true;
}

export function hasPending(callId: string): boolean {
  return pending.has(callId);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run lib/agent/approvals.test.ts
```
Expected: 5/5 passing.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/approvals.ts lib/agent/approvals.test.ts
git commit -m "feat: add approval-gate module for mutation tools"
```

---

## Task 4: Git Tool Definitions and Executor Cases

**Files:**
- Modify: `lib/agent/tools.ts`

- [ ] **Step 1: Add imports and constants near the top of the file**

Add (right after the existing imports):

```ts
import { runGit } from "./git";

const GIT_MUTATION_TOOLS = new Set(["git_commit", "git_branch", "git_checkout"]);
export function isGitMutation(toolName: string): boolean {
  return GIT_MUTATION_TOOLS.has(toolName);
}
```

- [ ] **Step 2: Add 6 tool definitions to `TOOL_DEFINITIONS`**

Append these inside the `TOOL_DEFINITIONS` array (before its closing `]`):

```ts
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
```

- [ ] **Step 3: Add the six tool cases inside `executeTool`**

Inside the `switch (name)` block, add these cases (anywhere before the default):

```ts
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
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools.ts
git commit -m "feat: add 6 git tools (status, diff, log, commit, branch, checkout)"
```

---

## Task 5: Streaming `run_command`

**Files:**
- Modify: `lib/agent/tools.ts`

- [ ] **Step 1: Add a streaming run_command helper at the top of the file**

After the existing imports, add:

```ts
import { spawn } from "child_process";

export interface RunCommandStream {
  output: string;
  emit: (chunk: string) => void;
}

export async function executeRunCommandStreaming(
  command: string,
  cwd: string,
  onChunk: (chunk: string) => void,
  timeoutMs = 60_000,
): Promise<string> {
  return new Promise((resolve) => {
    let acc = "";
    let killed = false;
    const child = spawn("sh", ["-c", command], { cwd });
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
      const suffix = killed ? `\n[killed: timed out after ${timeoutMs}ms]` : code === 0 ? "" : `\n[exit code: ${code}]`;
      resolve((acc + suffix).slice(0, 8000));
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve(`Command failed to start: ${err.message}`);
    });
  });
}
```

- [ ] **Step 2: Update the `run_command` case in `executeTool`**

Find the existing `case "run_command":` block in `executeTool`. The current signature returns immediately after running the command — we need it to accept an `onProgress` callback.

Change the signature of `executeTool` if needed to accept an optional progress callback. Open `lib/agent/tools.ts`, find the function signature, and add a fifth parameter:

```ts
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
  onProgress?: (chunk: string) => void,
): Promise<string> {
```

Then replace the `run_command` case body with:

```ts
case "run_command": {
  const command = (args.command as string | undefined)?.trim();
  if (!command) return "run_command failed: command is required.";
  return executeRunCommandStreaming(command, workspaceRoot, (chunk) => {
    onProgress?.(chunk);
  });
}
```

(Remove the old implementation that used `exec` if it exists. If `run_command` previously routed through a different helper, replace that path entirely.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean. If there are call-site errors from changing `executeTool` signature, leave them — Task 6 will update the call sites.

- [ ] **Step 4: Commit**

```bash
git add lib/agent/tools.ts
git commit -m "feat: stream run_command output line-by-line via onProgress callback"
```

---

## Task 6: Agent Loop — Checkpoint, Approval, Progress

**Files:**
- Modify: `lib/agent/loop.ts`

- [ ] **Step 1: Add imports**

Near the top of `loop.ts`, add:

```ts
import { readFile } from "fs/promises";
import { registerApproval } from "./approvals";
import { isGitMutation } from "./tools";
```

- [ ] **Step 2: Add checkpoint tracking and approval gating to the loop**

Find the section inside the loop where tools are executed (typically after the model returns a tool call). Update the execution to:

```ts
// Inside the tool-execution branch, before calling executeToolFn:

// 1. Checkpoint snapshot for files about to be modified
if (event.tool === "write_file" || event.tool === "git_checkout") {
  const targetPath =
    event.tool === "write_file"
      ? (event.args.path as string | undefined)
      : (event.args.target as string | undefined);
  if (targetPath) {
    const absPath = targetPath.startsWith("/")
      ? targetPath
      : `${workspaceRoot}/${targetPath}`;
    if (!checkpointFiles.has(absPath)) {
      try {
        const content = await readFile(absPath, "utf8");
        if (content.length <= 1_000_000) {
          checkpointFiles.set(absPath, content);
          yield { type: "checkpoint", path: absPath };
        } else {
          checkpointFiles.set(absPath, "<too large to snapshot>");
        }
      } catch {
        checkpointFiles.set(absPath, null as unknown as string); // sentinel: didn't exist
        yield { type: "checkpoint", path: absPath };
      }
    }
  }
}

// 2. Approval gating for git mutations
if (isGitMutation(event.tool)) {
  yield {
    type: "pending_approval",
    callId: event.callId,
    tool: event.tool,
    args: event.args,
  };
  const approved = await registerApproval(event.callId, 60_000);
  if (!approved) {
    yield {
      type: "tool_result",
      callId: event.callId,
      output: "Rejected by user.",
      truncated: false,
    };
    // Continue the loop with the rejection as the tool result
    messages.push({
      role: "tool_result",
      callId: event.callId,
      content: "Rejected by user.",
    });
    continue;
  }
}

// 3. Wire up progress streaming for run_command
const onProgress = (chunk: string) => {
  // Yield is async generator; we need a queue or push pattern.
  // Use a buffered progress queue cleared on next loop iteration.
  progressQueue.push({ type: "tool_progress", callId: event.callId, chunk });
};
```

At the top of `runAgentLoop`, declare the checkpoint map and progress queue:

```ts
const checkpointFiles = new Map<string, string | null>();
const progressQueue: AgentEvent[] = [];
```

Add a helper to drain the queue between events — call this right before each `yield` of a `tool_result`:

```ts
while (progressQueue.length > 0) {
  yield progressQueue.shift()!;
}
```

Change the `executeToolFn` invocation site to pass an `onProgress` callback. If the current signature doesn't support a 4th arg, add it:

```ts
const output = await executeToolFn(event.tool, event.args, workspaceRoot, onProgress);
```

- [ ] **Step 3: Expose checkpoints in the loop's return value or via an event**

The DiffPanel needs access to the checkpoint map. Since the loop is a generator, emit a final summary event before `done`:

```ts
// After the loop body finishes, before "done":
for (const [path, before] of checkpointFiles.entries()) {
  yield { type: "checkpoint", path };
}
```

(The DiffPanel will read the current file content client-side via an existing route or a new `/api/files/read` endpoint — see Task 8.)

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean (or errors that Task 7 will fix at the API route layer).

- [ ] **Step 5: Commit**

```bash
git add lib/agent/loop.ts
git commit -m "feat: checkpoint snapshots, approval gating, progress events in loop"
```

---

## Task 7: Stream Route — Forward New Events + Pass onProgress

**Files:**
- Modify: `app/api/agent/stream/route.ts`

- [ ] **Step 1: Update `executeToolFn` signature to accept and pass through onProgress**

Find the `executeToolFn` definition in the SSE stream body. Change it from:

```ts
executeToolFn: async (name, args, root) => {
  // ... existing MCP routing ...
  return executeTool(name, args, root);
},
```

to:

```ts
executeToolFn: async (name, args, root, onProgress) => {
  const mcpServerId = mcpToolOwners.get(name);
  if (mcpServerId) {
    const toolName = name.split("__").slice(1).join("__");
    try {
      return await mcpClient.callTool(mcpServerId, toolName, args);
    } catch (err) {
      return `MCP tool error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return executeTool(name, args, root, onProgress);
},
```

- [ ] **Step 2: Verify the `for await (const event of runAgentLoop(...))` block forwards all event types**

The block is currently `emit(event.type, event);` — that already forwards every event type correctly, so no change is needed. But verify by reading the route.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/agent/stream/route.ts
git commit -m "feat: pass onProgress through to executeTool; new SSE events forwarded"
```

---

## Task 8: Approval API + File Read API

**Files:**
- Create: `app/api/agent/approve/route.ts`
- Create: `app/api/files/read/route.ts`

- [ ] **Step 1: Create approval endpoint**

Create `app/api/agent/approve/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { resolveApproval, hasPending } from "@/lib/agent/approvals";

export async function POST(req: NextRequest) {
  let body: { callId?: string; accept?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { callId, accept } = body;
  if (!callId || typeof accept !== "boolean") {
    return NextResponse.json({ error: "callId and accept are required" }, { status: 400 });
  }
  if (!hasPending(callId)) {
    return NextResponse.json({ error: "No pending approval for that callId" }, { status: 404 });
  }
  resolveApproval(callId, accept);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create file read endpoint for the DiffPanel**

Create `app/api/files/read/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  try {
    const content = await readFile(path, "utf8");
    return NextResponse.json({ content });
  } catch (err) {
    return NextResponse.json({
      content: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/agent/approve/route.ts app/api/files/read/route.ts
git commit -m "feat: add /api/agent/approve and /api/files/read endpoints"
```

---

## Task 9: useAgentStream — Handle New Events, Expose `approve()`

**Files:**
- Modify: `hooks/useAgentStream.ts`

- [ ] **Step 1: Add state for live terminal output and pending approvals**

Inside `useAgentStream`, near the other `useState` calls, add:

```ts
const [liveTerminalOutput, setLiveTerminalOutput] = useState<string>("");
const [checkpoints, setCheckpoints] = useState<string[]>([]);
```

- [ ] **Step 2: Handle new event types in the stream parser**

Inside the `for (const part of parts)` block, after the existing event handlers, add:

```ts
if (event.type === "tool_progress") {
  setLiveTerminalOutput((prev) => {
    const next = prev + event.chunk;
    // Cap at 500 lines (head-discard)
    const lines = next.split("\n");
    if (lines.length > 500) return lines.slice(-500).join("\n");
    return next;
  });
  updateLastAssistant((msg) => ({
    ...msg,
    toolCalls: (msg.toolCalls ?? []).map((tc) =>
      tc.callId === event.callId
        ? { ...tc, liveOutput: (tc.liveOutput ?? "") + event.chunk }
        : tc
    ),
  }));
}

if (event.type === "pending_approval") {
  updateLastAssistant((msg) => ({
    ...msg,
    toolCalls: (msg.toolCalls ?? []).map((tc) =>
      tc.callId === event.callId
        ? { ...tc, status: "awaiting_approval" as const }
        : tc
    ),
  }));
}

if (event.type === "checkpoint") {
  setCheckpoints((prev) => prev.includes(event.path) ? prev : [...prev, event.path]);
}
```

Also clear `liveTerminalOutput` when a `tool_result` arrives for the same call:

```ts
// Inside the existing tool_result handler:
setLiveTerminalOutput("");
```

- [ ] **Step 3: Add `approve` function**

Inside the hook, before the `return` statement:

```ts
const approve = useCallback(async (callId: string, accept: boolean) => {
  await fetch("/api/agent/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId, accept }),
  });
}, []);
```

- [ ] **Step 4: Update return statement**

```ts
return {
  messages, isRunning, error, send, stop, clearMessages, injectAssistantMessage,
  liveTerminalOutput, checkpoints, approve,
};
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add hooks/useAgentStream.ts
git commit -m "feat: handle tool_progress/pending_approval/checkpoint, expose approve"
```

---

## Task 10: ToolCallCard — Approve/Reject + Live Output

**Files:**
- Modify: `app/components/marven/ToolCallCard.tsx`

- [ ] **Step 1: Add `onApprove` prop**

At the top of the file, update the props interface:

```ts
interface ToolCallCardProps {
  toolCall: ToolCallState;
  onApprove?: (callId: string, accept: boolean) => void;
}
```

Destructure the new prop:

```ts
export function ToolCallCard({ toolCall, onApprove }: ToolCallCardProps) {
```

- [ ] **Step 2: Render Approve/Reject buttons when awaiting approval**

Inside the component, after the existing badge/status rendering:

```tsx
{toolCall.status === "awaiting_approval" && (
  <div className="border-t border-[#2a2a2a] px-3 py-2 flex items-center justify-between gap-2">
    <span className="text-[10px] text-[#d19a66]">
      Awaiting approval — this will modify your repository.
    </span>
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onApprove?.(toolCall.callId, false); }}
        className="rounded-md border border-[#383838] px-2 py-0.5 text-[10px] text-[#888] hover:text-red-400 hover:border-red-400/40"
      >
        Reject
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onApprove?.(toolCall.callId, true); }}
        className="rounded-md border border-[#d19a66]/30 bg-[#d19a66]/10 px-2 py-0.5 text-[10px] text-[#d19a66] hover:bg-[#d19a66]/20"
      >
        Approve
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 3: Render live output when present (and tool is running)**

Add inside the expanded section, above the Output block:

```tsx
{toolCall.liveOutput && toolCall.status === "running" && (
  <div>
    <p className="text-[9px] uppercase tracking-widest text-[#444] mb-1">Live</p>
    <div className="overflow-y-auto max-h-[200px]">
      <pre className="font-mono text-[10px] text-[#d19a66] whitespace-pre-wrap break-all bg-[#161616] rounded p-2">
        {toolCall.liveOutput}
      </pre>
    </div>
  </div>
)}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/components/marven/ToolCallCard.tsx
git commit -m "feat: render approve/reject buttons and live output in tool card"
```

---

## Task 11: DiffPanel Component

**Files:**
- Create: `app/components/marven/DiffPanel.tsx`
- Modify: `package.json` (add `diff` dep)

- [ ] **Step 1: Install the `diff` package**

```bash
npm install diff
npm install --save-dev @types/diff
```

- [ ] **Step 2: Create `DiffPanel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { createPatch } from "diff";

interface DiffPanelProps {
  checkpoints: string[];          // absolute paths the agent touched
  onClose: () => void;
}

interface FileDiff {
  path: string;
  patch: string;                   // unified diff text
  hasChanges: boolean;
}

export function DiffPanel({ checkpoints, onClose }: DiffPanelProps) {
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (checkpoints.length === 0) {
      setDiffs([]);
      return;
    }
    setLoading(true);
    Promise.all(
      checkpoints.map(async (path) => {
        const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`);
        const data = await res.json();
        const after = data.content ?? "";
        // We don't have `before` here yet — it's in server state. For now,
        // fall back to showing the current content as the "diff base."
        // A future iteration could store checkpoints in localStorage or
        // a new /api/agent/checkpoints endpoint.
        const patch = createPatch(path, "", after, "before", "after");
        return { path, patch, hasChanges: after.length > 0 };
      })
    ).then((entries) => {
      setDiffs(entries);
      setLoading(false);
    });
  }, [checkpoints]);

  async function revert(path: string) {
    // Calls /api/agent/checkpoints to get the original; for now stub.
    // The full revert wiring lands in Task 12.
    console.warn("revert not yet wired:", path);
  }

  return (
    <div className="flex h-full flex-col bg-[#1a1a1a]">
      <header className="flex items-center justify-between border-b border-[#333] px-3 py-2">
        <span className="font-mono text-[10px] tracking-widest text-[#777] uppercase">
          Changes ({checkpoints.length})
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[#666] hover:text-[#ccc]"
          aria-label="Close diff panel"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && <p className="text-[11px] text-[#666]">Loading diffs…</p>}
        {!loading && diffs.length === 0 && (
          <p className="text-[11px] text-[#666]">No changes since the last agent run.</p>
        )}
        {diffs.map((d) => (
          <div key={d.path} className="rounded border border-[#333] overflow-hidden">
            <div className="flex items-center justify-between bg-[#1e1e1e] px-2 py-1.5">
              <span className="font-mono text-[10px] text-[#d4d4d4] truncate">{d.path}</span>
              <button
                type="button"
                onClick={() => revert(d.path)}
                className="text-[10px] text-[#888] hover:text-[#d19a66]"
              >
                Revert
              </button>
            </div>
            <pre className="bg-[#161616] px-2 py-1.5 overflow-x-auto font-mono text-[10px] leading-relaxed">
              {d.patch.split("\n").map((line, i) => {
                const color = line.startsWith("+") && !line.startsWith("+++")
                  ? "text-green-400"
                  : line.startsWith("-") && !line.startsWith("---")
                  ? "text-red-400"
                  : line.startsWith("@@")
                  ? "text-cyan-400"
                  : "text-[#777]";
                return <div key={i} className={color}>{line}</div>;
              })}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/components/marven/DiffPanel.tsx package.json package-lock.json
git commit -m "feat: add DiffPanel component with unified diff rendering"
```

---

## Task 12: Checkpoint Storage Endpoint + Revert Wiring

**Files:**
- Create: `app/api/agent/checkpoints/route.ts`
- Modify: `lib/agent/loop.ts` (export checkpoint accessor)
- Modify: `app/components/marven/DiffPanel.tsx` (wire revert)

- [ ] **Step 1: Move checkpoint map to a module-level singleton**

Create `lib/agent/checkpointStore.ts`:

```ts
const checkpoints = new Map<string, string | null>();

export function recordCheckpoint(path: string, before: string | null): void {
  if (!checkpoints.has(path)) checkpoints.set(path, before);
}

export function getCheckpoint(path: string): string | null | undefined {
  return checkpoints.get(path);
}

export function clearCheckpoints(): void {
  checkpoints.clear();
}

export function listCheckpoints(): string[] {
  return Array.from(checkpoints.keys());
}
```

Update `lib/agent/loop.ts` Task 6 changes to use this module instead of a local map:

```ts
import { recordCheckpoint, clearCheckpoints } from "./checkpointStore";

// At the start of runAgentLoop:
clearCheckpoints();

// Where we previously wrote to checkpointFiles.set(absPath, content):
recordCheckpoint(absPath, content);
```

- [ ] **Step 2: Create checkpoint API**

Create `app/api/agent/checkpoints/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "fs/promises";
import { getCheckpoint, listCheckpoints } from "@/lib/agent/checkpointStore";

export async function GET() {
  const paths = listCheckpoints();
  const items = paths.map((path) => ({ path, before: getCheckpoint(path) }));
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { path, action } = body as { path: string; action: "revert" };
  if (action !== "revert") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  const before = getCheckpoint(path);
  if (before === undefined) {
    return NextResponse.json({ error: "No checkpoint for that path" }, { status: 404 });
  }
  try {
    if (before === null) {
      await unlink(path);
    } else {
      await writeFile(path, before, "utf8");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 3: Update `DiffPanel.tsx` to use the new endpoint**

Replace the `useEffect` body with:

```ts
useEffect(() => {
  setLoading(true);
  fetch("/api/agent/checkpoints")
    .then((r) => r.json())
    .then(async (data: { items: Array<{ path: string; before: string | null }> }) => {
      const entries = await Promise.all(
        data.items.map(async (item) => {
          const res = await fetch(`/api/files/read?path=${encodeURIComponent(item.path)}`);
          const after = (await res.json()).content ?? "";
          const before = item.before ?? "";
          const patch = createPatch(item.path, before, after, "before", "after");
          const hasChanges = before !== after;
          return { path: item.path, patch, hasChanges };
        })
      );
      setDiffs(entries.filter((d) => d.hasChanges));
    })
    .finally(() => setLoading(false));
}, [checkpoints]);
```

And replace `revert`:

```ts
async function revert(path: string) {
  const res = await fetch("/api/agent/checkpoints", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, action: "revert" }),
  });
  if (res.ok) {
    setDiffs((prev) => prev.filter((d) => d.path !== path));
  }
}
```

- [ ] **Step 4: Type-check + tests**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: clean, all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/checkpointStore.ts lib/agent/loop.ts app/api/agent/checkpoints/route.ts app/components/marven/DiffPanel.tsx
git commit -m "feat: persistent checkpoint store + revert via /api/agent/checkpoints"
```

---

## Task 13: AgentWorkspace — Third Panel + Drag Handle

**Files:**
- Modify: `app/components/marven/AgentWorkspace.tsx`

- [ ] **Step 1: Add `showDiff`, `diffWidth` state and drag logic**

Near the other state in `AgentWorkspace`:

```ts
const [showDiff, setShowDiff] = useState(false);
const [diffWidth, setDiffWidth] = useState(() => {
  if (typeof window === "undefined") return 360;
  return Number(localStorage.getItem("marven-diff-width") ?? 360);
});
const isDraggingDiff = useRef(false);
const diffStartX = useRef(0);
const diffStartWidth = useRef(0);
```

Add a parallel useEffect for the diff drag handle (analogous to the existing `agentWidth` drag):

```ts
useEffect(() => {
  function onMouseMove(e: MouseEvent) {
    if (!isDraggingDiff.current) return;
    const delta = diffStartX.current - e.clientX;
    const next = Math.min(700, Math.max(240, diffStartWidth.current + delta));
    setDiffWidth(next);
  }
  function onMouseUp() {
    if (!isDraggingDiff.current) return;
    isDraggingDiff.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    localStorage.setItem("marven-diff-width", String(diffWidth));
  }
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  return () => {
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  };
}, [diffWidth]);

function startDiffDrag(e: React.MouseEvent) {
  e.preventDefault();
  isDraggingDiff.current = true;
  diffStartX.current = e.clientX;
  diffStartWidth.current = diffWidth;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
}
```

- [ ] **Step 2: Accept `checkpoints` prop**

Add to `AgentWorkspaceProps`:

```ts
checkpoints: string[];
```

Pass it from `page.tsx` via the existing `useAgentStream` integration (also from `ChatLayout.tsx`).

- [ ] **Step 3: Add diff panel toggle button to the header**

Find the header bar with the existing toggles. Add a button:

```tsx
<button
  type="button"
  onClick={() => setShowDiff((v) => !v)}
  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
    showDiff ? "text-[#d19a66] bg-[#d19a66]/10" : "text-[#666] hover:text-[#ccc]"
  }`}
  title="Toggle diff panel"
>
  Diff{checkpoints.length > 0 ? ` (${checkpoints.length})` : ""}
</button>
```

- [ ] **Step 4: Render the diff panel + handle in the layout**

Inside the three-column layout, after the editor panel:

```tsx
{showDiff && showEditor && (
  <div
    onMouseDown={startDiffDrag}
    className="group relative z-10 -ml-px w-1 cursor-col-resize bg-transparent hover:bg-[#d19a66]/40 active:bg-[#d19a66]/60 transition-colors"
    title="Drag to resize"
  >
    <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
      <div className="h-8 w-0.5 rounded-full bg-[#d19a66]/60" />
    </div>
  </div>
)}

{showDiff && (
  <div
    className="flex flex-col border-l border-[#333]"
    style={{ width: diffWidth, minWidth: diffWidth }}
  >
    <DiffPanel checkpoints={checkpoints} onClose={() => setShowDiff(false)} />
  </div>
)}
```

Import `DiffPanel` at the top:

```ts
import { DiffPanel } from "./DiffPanel";
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/components/marven/AgentWorkspace.tsx
git commit -m "feat: third diff panel with toggle and drag handle"
```

---

## Task 14: page.tsx + ChatLayout — Wire It Up

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/components/marven/ChatLayout.tsx`

- [ ] **Step 1: Pull new values from `useAgentStream`**

In `app/page.tsx`, update the destructuring:

```ts
const {
  messages: agentMessages,
  isRunning: isAgentRunning,
  error: agentError,
  send: agentSend,
  stop: agentStop,
  clearMessages: clearAgentMessages,
  injectAssistantMessage: injectAgentAssistant,
  liveTerminalOutput,
  checkpoints,
  approve,
} = useAgentStream({ provider, model: selectedModel, workspaceRoot, memory, mcpServers });
```

- [ ] **Step 2: Pass them to `<ChatLayout>`**

Add to the props on the `<ChatLayout>` element:

```tsx
liveTerminalOutput={liveTerminalOutput}
checkpoints={checkpoints}
onApproveToolCall={approve}
```

- [ ] **Step 3: Add the new props to `ChatLayoutProps` and forward to `AgentWorkspace`**

In `ChatLayout.tsx`, update the props interface and destructuring, then forward to `<AgentWorkspace>`:

```tsx
<AgentWorkspace
  // ... existing props ...
  liveTerminalOutput={liveTerminalOutput}
  checkpoints={checkpoints}
  onApproveToolCall={onApproveToolCall}
/>
```

- [ ] **Step 4: Thread `onApproveToolCall` into `ToolCallCard`**

`AgentWorkspace` renders the message list (probably via `AgentPanel`). Find where `<ToolCallCard>` is rendered and pass `onApprove`:

```tsx
<ToolCallCard
  toolCall={tc}
  onApprove={onApproveToolCall}
/>
```

- [ ] **Step 5: Display `liveTerminalOutput` in the terminal panel**

In `EditorPanel.tsx` (or wherever the terminal panel currently is), surface the live output. If a `terminalOutput` prop already exists, prefer `liveTerminalOutput` over it when both are non-empty.

- [ ] **Step 6: Type-check + run all tests**

```bash
npx tsc --noEmit
npm test
```
Expected: clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/components/marven/ChatLayout.tsx app/components/marven/AgentWorkspace.tsx app/components/marven/EditorPanel.tsx
git commit -m "feat: wire approval/checkpoints/live-output through page → ChatLayout → AgentWorkspace"
```

---

## Task 15: Manual Smoke Test + Bump Version

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Manual smoke test checklist**

Run `npm run electron:dev`. Verify:

- [ ] Open a folder that's a git repo. Ask the agent "show git status." It runs `git_status` and returns output.
- [ ] Ask the agent to commit. The tool card shows Approve / Reject. Click Approve — commit succeeds. Click Reject — agent gets "Rejected by user."
- [ ] Ask the agent to write a file. After the run, click "Diff" in the workspace header. Panel opens, shows the diff. Click "Revert" — file restored.
- [ ] Ask the agent to run `npm test` (or `sleep 5; echo done`). Terminal panel streams output line by line.
- [ ] Toggle the diff panel off and on. The drag handle resizes it.
- [ ] Open a folder that's NOT a git repo. `git_status` returns "Not a git repository." (no crash).

- [ ] **Step 2: Bump version to 1.6.0**

In `package.json`:

```json
"version": "1.6.0",
```

- [ ] **Step 3: Commit and tag**

```bash
git add package.json
git commit -m "chore: bump version to 1.6.0"
git tag v1.6.0
```

(Hold off on pushing the tag until the user explicitly asks; per CLAUDE conventions, releases need explicit approval.)

---

## Self-Review

**Spec coverage:**
- ✅ Git tools (Tasks 2, 4) — 6 tools with read/mutation distinction
- ✅ Approval gating (Tasks 3, 6, 8, 10) — module + loop + endpoint + UI
- ✅ Checkpoint diff viewer (Tasks 6, 11, 12, 13) — store + panel + revert + UI integration
- ✅ Live terminal (Tasks 5, 6, 9, 14) — streaming spawn + progress events + UI display

**Placeholder scan:** No TBDs.

**Type consistency:** `AgentEvent` extended in Task 1 before being used by Task 6 (loop), Task 9 (hook), Task 10 (card). `executeTool` signature extended in Task 5 before Task 7 (route) passes `onProgress`. `checkpointStore` introduced in Task 12 supersedes the in-loop map from Task 6 — Task 12 explicitly updates the loop's checkpoint code to use the store.

**Risk note:** Task 6 is the largest single task (loop modifications). If it grows past one subagent's context, split into 6a (checkpoint) and 6b (approval + progress).
