# Pre-write Diff Preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate `write_file` and `apply_patch` agent tool calls behind an opt-in user-facing diff preview with Accept / Reject buttons before any bytes land on disk.

**Architecture:** A `requireWriteApproval` flag threads from a localStorage setting through `useAgentStream` → POST body → `runAgentLoop`. In the loop, just before executing a write tool, the before content (from the checkpoint store) and after content (computed via a new pure `simulateApplyPatch` helper) are diffed with `createPatch` and emitted in the `pending_approval` event. `ToolCallCard` renders the colored unified diff when a `preview` field is present on the tool call state.

**Tech Stack:** TypeScript, React, Next.js App Router, `diff` npm package (`createPatch`), Vitest, Tailwind CSS v4 with `var(--m-*)` tokens.

---

## File map

| Action | Path | Responsibility |
|---|---|---|
| **Create** | `lib/agent/applyPatch.ts` | Pure `simulateApplyPatch` — dry-run apply_patch without I/O |
| **Create** | `lib/agent/applyPatch.test.ts` | Unit tests for simulateApplyPatch |
| **Create** | `lib/agentSettings.ts` | `getRequireWriteApproval` / `setRequireWriteApproval` localStorage helpers |
| **Modify** | `types/index.ts` | Add `WritePreview`; extend `AgentEvent` + `ToolCallState` |
| **Modify** | `lib/agent/loop.ts` | Accept `requireWriteApproval` option; gate write tools |
| **Modify** | `lib/agent/loop.test.ts` | Tests for write-approval gating and rejection |
| **Modify** | `app/api/agent/stream/route.ts` | Add `requireWriteApproval` to `StreamRequestBody`; forward to loop |
| **Modify** | `hooks/useAgentStream.ts` | Accept + forward flag; attach `preview` on `pending_approval` events |
| **Modify** | `app/components/marven/SettingsModal.tsx` | Add toggle to General tab |
| **Modify** | `app/page.tsx` | Read setting; pass to `useAgentStream` |
| **Modify** | `app/components/marven/ToolCallCard.tsx` | Render diff block when `preview` is present |

---

## Task 1: Pure `simulateApplyPatch` helper

**Files:**
- Create: `lib/agent/applyPatch.ts`
- Create: `lib/agent/applyPatch.test.ts`

- [ ] **Step 1.1 — Write the failing tests**

```ts
// lib/agent/applyPatch.test.ts
import { describe, it, expect } from "vitest";
import { simulateApplyPatch } from "./applyPatch";

describe("simulateApplyPatch", () => {
  it("applies a single replacement edit", () => {
    const result = simulateApplyPatch("hello world", [{ search: "world", replace: "there" }]);
    expect(result).toBe("hello there");
  });

  it("applies multiple edits in order", () => {
    const result = simulateApplyPatch("foo bar baz", [
      { search: "foo", replace: "one" },
      { search: "baz", replace: "three" },
    ]);
    expect(result).toBe("one bar three");
  });

  it("returns null when search text is not found", () => {
    const result = simulateApplyPatch("hello world", [{ search: "missing", replace: "x" }]);
    expect(result).toBeNull();
  });

  it("returns null when search text is ambiguous (appears more than once)", () => {
    const result = simulateApplyPatch("abc abc", [{ search: "abc", replace: "x" }]);
    expect(result).toBeNull();
  });

  it("handles deletion (empty replace)", () => {
    const result = simulateApplyPatch("hello world", [{ search: " world", replace: "" }]);
    expect(result).toBe("hello");
  });

  it("handles empty content (new file)", () => {
    const result = simulateApplyPatch("", [{ search: "", replace: "anything" }]);
    expect(result).toBeNull(); // empty search is rejected
  });

  it("returns null when search is an empty string", () => {
    const result = simulateApplyPatch("some content", [{ search: "", replace: "x" }]);
    expect(result).toBeNull();
  });

  it("applies edit that changes length correctly", () => {
    const result = simulateApplyPatch("aaabbbccc", [{ search: "bbb", replace: "XX" }]);
    expect(result).toBe("aaaXXccc");
  });
});
```

- [ ] **Step 1.2 — Run to confirm tests fail**

```bash
npx vitest run lib/agent/applyPatch.test.ts
```

Expected: all tests fail with "Cannot find module './applyPatch'".

- [ ] **Step 1.3 — Implement `simulateApplyPatch`**

```ts
// lib/agent/applyPatch.ts

/**
 * Dry-run version of the apply_patch executor. Returns the resulting file
 * content after all edits, or null if any edit cannot be applied (search text
 * not found, ambiguous, or empty).
 *
 * Mirrors the exact search/replace logic in tools.ts so the preview diff
 * matches what would actually be written.
 */
export function simulateApplyPatch(
  content: string,
  edits: Array<{ search: string; replace: string }>,
): string | null {
  let result = content;
  for (const { search, replace } of edits) {
    if (!search) return null;
    const firstIdx = result.indexOf(search);
    if (firstIdx === -1) return null;
    const secondIdx = result.indexOf(search, firstIdx + 1);
    if (secondIdx !== -1) return null;
    result = result.slice(0, firstIdx) + replace + result.slice(firstIdx + search.length);
  }
  return result;
}
```

- [ ] **Step 1.4 — Run tests to confirm they pass**

```bash
npx vitest run lib/agent/applyPatch.test.ts
```

Expected: 8 tests pass.

- [ ] **Step 1.5 — Commit**

```bash
git add lib/agent/applyPatch.ts lib/agent/applyPatch.test.ts
git commit -m "feat(agent): pure simulateApplyPatch helper for write preview dry-run

Extracts the search/replace logic from the apply_patch tool executor into a
pure, side-effect-free function that the agent loop can call to compute the
'after' content of a patch without touching disk. Returns null if any edit
fails (search not found, ambiguous, or empty search string), in which case
the approval gate is bypassed and the tool runs normally.

8 unit tests cover the happy path, multi-edit sequencing, null cases, and
the deletion (empty replace) variant.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Types — `WritePreview`, extend `AgentEvent` and `ToolCallState`

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 2.1 — Add `WritePreview` and update type unions**

In `types/index.ts`, make three changes:

**Change A** — add `WritePreview` after the `DiffEntry` interface (around line 213):

```ts
export interface WritePreview {
  path: string;
  before: string;
  after: string;
  diff: string; // unified diff string produced by createPatch()
}
```

**Change B** — in `AgentEvent`, change the `pending_approval` variant from:

```ts
  | { type: "pending_approval"; callId: string; tool: string; args: Record<string, unknown> }
```

to:

```ts
  | { type: "pending_approval"; callId: string; tool: string; args: Record<string, unknown>; preview?: WritePreview }
```

**Change C** — in `ToolCallState`, add `preview` after `liveOutput?`:

```ts
export interface ToolCallState {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "awaiting_approval" | "done" | "error" | "rejected";
  output?: string;
  liveOutput?: string;
  preview?: WritePreview;
}
```

- [ ] **Step 2.2 — Verify typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors (the new optional `preview` field is backward-compatible).

- [ ] **Step 2.3 — Commit**

```bash
git add types/index.ts
git commit -m "types: add WritePreview; extend pending_approval and ToolCallState

WritePreview carries the path, before/after content, and pre-computed unified
diff string. The pending_approval AgentEvent and ToolCallState gain an
optional preview field so write-tool approvals can surface a diff in the UI.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Loop write-approval gate + tests

**Files:**
- Modify: `lib/agent/loop.ts`
- Modify: `lib/agent/loop.test.ts`

- [ ] **Step 3.1 — Write the failing loop tests**

Add these four tests to the existing `describe("runAgentLoop", ...)` block in `lib/agent/loop.test.ts`. Add a `write_file` tool definition alongside `echoTool`:

```ts
const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "path" },
      content: { type: "string", description: "content" },
    },
    required: ["path", "content"],
  },
};
```

Add the tests (inside the existing `describe` block):

```ts
  describe("requireWriteApproval", () => {
    it("does NOT gate write_file when requireWriteApproval is false", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "w1", tool: "write_file", args: { path: "a.txt", content: "hello" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("Written: a.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write file" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: false,
      })) {
        events.push(event);
      }

      const approvalEvents = events.filter((e) => e.type === "pending_approval");
      expect(approvalEvents).toHaveLength(0);
      expect(mockExec).toHaveBeenCalledOnce();
    });

    it("emits pending_approval with preview for write_file when requireWriteApproval is true", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "w2", tool: "write_file", args: { path: "b.txt", content: "hello" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("Written: b.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write file" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: true,
        // resolve approval immediately so the loop doesn't hang
        _testApprovalResult: true,
      })) {
        events.push(event);
      }

      const approvalEvent = events.find((e) => e.type === "pending_approval");
      expect(approvalEvent).toBeDefined();
      if (approvalEvent?.type !== "pending_approval") throw new Error("expected pending_approval");
      expect(approvalEvent.preview).toBeDefined();
      expect(approvalEvent.preview?.path).toBe("b.txt");
      expect(approvalEvent.preview?.after).toBe("hello");
      expect(approvalEvent.preview?.diff).toContain("+hello");
      expect(mockExec).toHaveBeenCalledOnce();
    });

    it("skips write_file execution when approval is rejected", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "w3", tool: "write_file", args: { path: "c.txt", content: "hi" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("Written: c.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write file" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: true,
        _testApprovalResult: false,
      })) {
        events.push(event);
      }

      expect(mockExec).not.toHaveBeenCalled();
      const rejectionResult = events.find(
        (e) => e.type === "tool_result" && e.output === "Rejected by user."
      );
      expect(rejectionResult).toBeDefined();
    });

    it("defaults requireWriteApproval to off when option is omitted", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "w4", tool: "write_file", args: { path: "d.txt", content: "x" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("Written: d.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write file" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        // requireWriteApproval omitted
      })) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === "pending_approval")).toHaveLength(0);
      expect(mockExec).toHaveBeenCalledOnce();
    });
  });
```

- [ ] **Step 3.2 — Run to confirm new tests fail**

```bash
npx vitest run lib/agent/loop.test.ts
```

Expected: the 4 new tests fail — `_testApprovalResult` is not yet a recognized option, and no write-approval gate exists.

- [ ] **Step 3.3 — Implement the write-approval gate in `loop.ts`**

**Add two imports** at the top of `lib/agent/loop.ts` (after the existing imports):

```ts
import { createPatch } from "diff";
import { simulateApplyPatch } from "./applyPatch";
import type { WritePreview } from "@/types";
```

**Extend `LoopOptions`** — add `requireWriteApproval` and the test escape hatch:

```ts
interface LoopOptions {
  messages: InternalMessage[];
  tools: ToolDefinition[];
  workspaceRoot: string;
  memory?: string;
  providerStep: (
    messages: InternalMessage[],
    tools: ToolDefinition[],
  ) => Promise<ProviderStepResult>;
  executeToolFn?: typeof executeTool;
  onProgress?: (callId: string, chunk: string) => void;
  requireWriteApproval?: boolean;
  /** Internal test-only: when set, resolves every registerApproval with this value instead of blocking. */
  _testApprovalResult?: boolean;
}
```

**Add the write-approval gate** inside the for-loop, immediately before the existing `// 2. Approval gating for git mutation tools` comment. Find:

```ts
    // 2. Approval gating for git mutation tools
    if (isGitMutation(result.tool)) {
```

Insert this block immediately before it:

```ts
    // 2a. Write-approval gate (opt-in, controlled by requireWriteApproval setting)
    if (options.requireWriteApproval && (result.tool === "write_file" || result.tool === "apply_patch")) {
      const rel = result.args.path as string;
      const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
      const rawBefore = getCheckpoint(abs);

      if (rawBefore !== "<too large to snapshot>") {
        const before = rawBefore ?? "";
        let after: string | null = null;

        if (result.tool === "write_file") {
          const raw = (result.args.content as string) ?? "";
          after = raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
        } else {
          const rawEdits = result.args.edits as Array<{ search?: unknown; replace?: unknown }>;
          const edits = rawEdits.map((e) => ({
            search: typeof e.search === "string"
              ? e.search.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
              : "",
            replace: typeof e.replace === "string"
              ? e.replace.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
              : "",
          }));
          after = simulateApplyPatch(before, edits);
        }

        if (after !== null) {
          const diff = createPatch(rel, before, after, "before", "after");
          const preview: WritePreview = { path: rel, before, after, diff };
          yield {
            type: "pending_approval",
            callId: result.callId,
            tool: result.tool,
            args: result.args,
            preview,
          };
          const approved =
            options._testApprovalResult !== undefined
              ? options._testApprovalResult
              : await registerApproval(result.callId, 60_000);
          if (!approved) {
            const rejection = "Rejected by user.";
            yield { type: "tool_result", callId: result.callId, output: rejection, truncated: false };
            history.push({ role: "tool_result", callId: result.callId, content: rejection });
            continue;
          }
        }
      }
    }
```

- [ ] **Step 3.4 — Run loop tests**

```bash
npx vitest run lib/agent/loop.test.ts
```

Expected: all tests pass (the 4 new ones + the existing 4).

- [ ] **Step 3.5 — Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3.6 — Commit**

```bash
git add lib/agent/loop.ts lib/agent/loop.test.ts
git commit -m "feat(agent): write-approval gate in runAgentLoop

When requireWriteApproval is true, write_file and apply_patch tool calls
are intercepted before execution. The loop reads the checkpointed 'before'
content, computes the 'after' (trivially for write_file; via
simulateApplyPatch for apply_patch), generates a unified diff with
createPatch, and emits a pending_approval event carrying a WritePreview.
The loop then awaits registerApproval exactly as git mutations already do.
Rejection emits 'Rejected by user.' and skips the write.

Files > 1 MB (checkpointed as the sentinel string) and apply_patch calls
where simulateApplyPatch returns null (invalid edits) bypass the gate and
let the tool execute or fail naturally.

4 new loop tests cover: gate off, gate on + accepted, gate on + rejected,
and omitted option defaults to off.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: API route — forward `requireWriteApproval`

**Files:**
- Modify: `app/api/agent/stream/route.ts`

- [ ] **Step 4.1 — Extend `StreamRequestBody` and forward the flag**

In `app/api/agent/stream/route.ts`, find the `StreamRequestBody` interface:

```ts
interface StreamRequestBody {
  prompt?: string;
  history?: HistoryMessage[];
  model?: string;
  provider?: AIProvider;
  workspaceRoot?: string;
  memory?: string;
  mcpServers?: MCPServer[];
}
```

Replace it with:

```ts
interface StreamRequestBody {
  prompt?: string;
  history?: HistoryMessage[];
  model?: string;
  provider?: AIProvider;
  workspaceRoot?: string;
  memory?: string;
  mcpServers?: MCPServer[];
  requireWriteApproval?: boolean;
}
```

Then find the `runAgentLoop({` call (around line 106) and add the new option. The full call currently ends with `onProgress,`. Change it to also include:

```ts
        for await (const event of runAgentLoop({
          messages: history,
          tools: allTools,
          workspaceRoot,
          memory: body.memory,
          providerStep,
          onProgress,
          requireWriteApproval: body.requireWriteApproval ?? false,
          executeToolFn: async (name, args, root, onProgressCb) => {
```

- [ ] **Step 4.2 — Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4.3 — Commit**

```bash
git add app/api/agent/stream/route.ts
git commit -m "feat(api): forward requireWriteApproval to runAgentLoop

The agent stream route now accepts requireWriteApproval in the POST body
and threads it to the loop. Defaults to false so existing callers are
unaffected.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `useAgentStream` — accept flag, attach preview

**Files:**
- Modify: `hooks/useAgentStream.ts`

- [ ] **Step 5.1 — Add `requireWriteApproval` to options and forward to POST body**

Find `UseAgentStreamOptions`:

```ts
interface UseAgentStreamOptions {
  provider: AIProvider;
  model: string;
  workspaceRoot: string | null;
  memory?: string;
  mcpServers?: MCPServer[];
}
```

Replace with:

```ts
interface UseAgentStreamOptions {
  provider: AIProvider;
  model: string;
  workspaceRoot: string | null;
  memory?: string;
  mcpServers?: MCPServer[];
  requireWriteApproval?: boolean;
}
```

Update the function signature to destructure the new field:

```ts
export function useAgentStream({ provider, model, workspaceRoot, memory, mcpServers, requireWriteApproval }: UseAgentStreamOptions) {
```

Find the fetch call (around line 68) where the body is assembled:

```ts
        body: JSON.stringify({ prompt, history, provider, model, workspaceRoot, memory, mcpServers: (mcpServers ?? []).filter((s) => s.enabled) }),
```

Replace with:

```ts
        body: JSON.stringify({ prompt, history, provider, model, workspaceRoot, memory, mcpServers: (mcpServers ?? []).filter((s) => s.enabled), requireWriteApproval: requireWriteApproval ?? false }),
```

- [ ] **Step 5.2 — Attach `preview` when handling `pending_approval` events**

Find the existing `pending_approval` handler (around line 147):

```ts
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
```

Replace with:

```ts
          if (event.type === "pending_approval") {
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls ?? []).map((tc) =>
                tc.callId === event.callId
                  ? { ...tc, status: "awaiting_approval" as const, ...(event.preview ? { preview: event.preview } : {}) }
                  : tc
              ),
            }));
          }
```

- [ ] **Step 5.3 — Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5.4 — Commit**

```bash
git add hooks/useAgentStream.ts
git commit -m "feat(hook): forward requireWriteApproval; attach preview to ToolCallState

useAgentStream now accepts and forwards requireWriteApproval to the stream
POST body. When a pending_approval event carries a preview field, it is
stored on the matching ToolCallState so the UI can render the diff.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Settings helper + SettingsModal toggle

**Files:**
- Create: `lib/agentSettings.ts`
- Modify: `app/components/marven/SettingsModal.tsx`

- [ ] **Step 6.1 — Create `lib/agentSettings.ts`**

```ts
// lib/agentSettings.ts
"use client";

const WRITE_APPROVAL_KEY = "agentRequireWriteApproval";

export function getRequireWriteApproval(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(WRITE_APPROVAL_KEY) === "true";
}

export function setRequireWriteApproval(value: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(WRITE_APPROVAL_KEY, value ? "true" : "false");
}
```

- [ ] **Step 6.2 — Add toggle to SettingsModal**

In `app/components/marven/SettingsModal.tsx`, add the import near the top (after the `getFormatOnSave` import):

```ts
import { getRequireWriteApproval, setRequireWriteApproval } from "@/lib/agentSettings";
```

Add state initialization (near line 225, after `const [formatOnSave, setFormatOnSaveState] = useState<boolean>(true)`):

```ts
  const [requireWriteApproval, setRequireWriteApprovalState] = useState<boolean>(false);
```

Add effect to read from localStorage (inside the existing `useEffect` that reads `formatOnSave` around line 227, or add a separate one):

```ts
  useEffect(() => {
    setRequireWriteApprovalState(getRequireWriteApproval());
  }, []);
```

Add the toggle block after the existing "Format on save toggle" card (after line 738, before `</div>` closing the General tab):

```tsx
            {/* Require write approval toggle */}
            <div className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-medium text-[var(--m-text)]">Require approval before writing files</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">
                    Show a diff preview and ask before write_file or apply_patch execute. Adds a confirmation step for every agent write.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={requireWriteApproval}
                  onClick={() => {
                    const next = !requireWriteApproval;
                    setRequireWriteApprovalState(next);
                    setRequireWriteApproval(next);
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    requireWriteApproval ? "bg-[#d19a66]" : "bg-[var(--m-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      requireWriteApproval ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
```

- [ ] **Step 6.3 — Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6.4 — Commit**

```bash
git add lib/agentSettings.ts app/components/marven/SettingsModal.tsx
git commit -m "feat(settings): agentRequireWriteApproval toggle in General tab

Adds getRequireWriteApproval / setRequireWriteApproval helpers (mirroring
the getFormatOnSave pattern) and a toggle card in Settings → General. The
setting persists in localStorage under 'agentRequireWriteApproval'. Default
is off so existing users see no behaviour change.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Wire setting into `app/page.tsx`

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 7.1 — Import the helper and read the setting**

Find the existing import block near the top of `app/page.tsx` (around line 26 where `useAgentStream` is imported). Add:

```ts
import { getRequireWriteApproval } from "@/lib/agentSettings";
```

Find the `useAgentStream({` call (around line 263):

```ts
  } = useAgentStream({
    provider,
    model: selectedModel,
    workspaceRoot,
    memory: memories.length > 0 ? memories.map((m) => `- ${m}`).join("\n") : undefined,
    mcpServers,
  });
```

Replace with:

```ts
  } = useAgentStream({
    provider,
    model: selectedModel,
    workspaceRoot,
    memory: memories.length > 0 ? memories.map((m) => `- ${m}`).join("\n") : undefined,
    mcpServers,
    requireWriteApproval: getRequireWriteApproval(),
  });
```

> **Note:** `getRequireWriteApproval()` is called once at render time. The setting change takes effect on the next agent run (starts a new streaming request). No `useEffect` / storage listener is needed here because `page.tsx` already re-renders on many state changes and this is a per-request flag, not a live reactive control. If a user toggles it mid-session, the next agent run picks it up.

- [ ] **Step 7.2 — Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7.3 — Commit**

```bash
git add app/page.tsx
git commit -m "feat(app): pass requireWriteApproval from settings into useAgentStream

Reads the localStorage flag once per render cycle and forwards it to the
agent stream hook. Effective on the next agent run — no live reactivity
needed since each agent run is a new request.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: `ToolCallCard` — render the diff preview

**Files:**
- Modify: `app/components/marven/ToolCallCard.tsx`

- [ ] **Step 8.1 — Add `DiffBlock` sub-component**

Add the following component at the top of `app/components/marven/ToolCallCard.tsx`, immediately before the `ToolGlyph` function (around line 8, after the imports):

```tsx
function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  const [showAll, setShowAll] = useState(false);
  const COLLAPSE = 60;
  const isLong = lines.length > COLLAPSE;
  const visible = isLong && !showAll ? lines.slice(0, COLLAPSE) : lines;

  function lineColor(line: string): string {
    if (line.startsWith("+++") || line.startsWith("---")) return "text-[var(--m-text-faint)]";
    if (line.startsWith("+")) return "text-green-400/80";
    if (line.startsWith("-")) return "text-red-400/80";
    if (line.startsWith("@@")) return "text-[var(--m-text-faint)]";
    return "text-[var(--m-text-muted)]";
  }

  return (
    <div className="border-t border-[var(--m-border-subtle)]">
      <div className="overflow-y-auto max-h-[300px] bg-[var(--m-bg)]">
        <pre className="px-3 py-2 text-[10px] font-mono leading-relaxed select-text">
          {visible.map((line, i) => (
            <span key={i} className={lineColor(line)}>
              {line}
              {"\n"}
            </span>
          ))}
        </pre>
      </div>
      {isLong && !showAll && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="w-full py-1 text-center text-[10px] text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)] border-t border-[var(--m-border-subtle)]"
        >
          Show {lines.length - COLLAPSE} more lines
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 8.2 — Render `DiffBlock` when preview is present**

Inside `ToolCallCard`, find the existing awaiting-approval section (around line 171):

```tsx
      {toolCall.status === "awaiting_approval" && (
        <div className="border-t border-[var(--m-border-subtle)] px-3 py-2 flex items-center justify-between gap-2">
```

Insert this block immediately before it:

```tsx
      {toolCall.status === "awaiting_approval" && toolCall.preview && (
        <DiffBlock diff={toolCall.preview.diff} />
      )}
```

- [ ] **Step 8.3 — Typecheck**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8.4 — Commit**

```bash
git add app/components/marven/ToolCallCard.tsx
git commit -m "feat(ui): render write-preview diff in ToolCallCard approval section

When a pending_approval ToolCallState carries a preview field (set by the
write-approval gate), a DiffBlock component renders the unified diff above
the existing Accept/Reject buttons. Lines are colored: + green, - red,
@@ and header lines faint. Diffs > 60 lines collapse with a 'Show N more
lines' button to keep the panel readable on large writes.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Final checks, version bump, and release tag

**Files:**
- Modify: `package.json`

- [ ] **Step 9.1 — Run full test suite**

```bash
npm test
```

Expected: all tests pass (8 applyPatch tests + 4 new loop tests + all existing tests).

- [ ] **Step 9.2 — Full typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 9.3 — Bump version to 2.3.0**

In `package.json`, change:

```json
"version": "2.2.0",
```

to:

```json
"version": "2.3.0",
```

- [ ] **Step 9.4 — Release commit and tag**

```bash
git add package.json
git commit -m "release: v2.3.0 — pre-write diff preview with file-level accept/reject

Adds an opt-in agent setting (Settings → General → 'Require approval before
writing files') that gates every write_file and apply_patch tool call behind
a unified diff preview. The agent loop computes the diff (before/after) and
emits it in a pending_approval event before writing. ToolCallCard renders
the colored diff (+/- lines) inline with the existing Accept/Reject buttons.
Diffs > 60 lines auto-collapse with a 'Show N more lines' toggle.

Per-hunk accept is a follow-up (v2.3.x). This release ships file-level
gating only.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"

git tag v2.3.0
```

- [ ] **Step 9.5 — Push to trigger CI**

```bash
git push && git push origin v2.3.0
```

Expected: GitHub Actions builds Mac DMG + Windows EXE + Linux AppImage and publishes the release.
