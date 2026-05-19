# Feature #1: Pre-write diff preview with file-level accept/reject

**Date:** 2026-05-20
**Status:** Approved — ready for implementation planning

---

## Summary

An opt-in setting (`agentRequireWriteApproval`, default off) gates every `write_file` and `apply_patch` tool call behind a user-visible diff preview before any bytes land on disk. The agent loop computes a unified diff (before → after) and emits it in the `pending_approval` event. `ToolCallCard` renders the diff inline with Accept / Reject buttons. Approved writes proceed normally; rejected writes surface "Rejected by user." to the agent, which may re-plan.

Per-hunk accept is a follow-up feature. This pass ships file-level accept/reject only.

---

## Architecture

### Approach chosen

Gate inside `loop.ts`, mirroring the existing `isGitMutation` approval pattern exactly. The loop already owns all approval logic; extending it for write tools is the natural fit. A pure `simulateApplyPatch` helper handles dry-run computation for `apply_patch` without touching disk.

Alternatives rejected:
- **Gate at API route** — splits gating across two layers, breaks single responsibility.
- **Pre-execution hook in `tools.ts`** — tools.ts has no concept of approval state or streaming.

---

## Components and file changes

### 1. `lib/agent/applyPatch.ts` (new file)

Pure, side-effect-free helper. Exports:

```ts
export function simulateApplyPatch(
  content: string,
  edits: Array<{ search: string; replace: string }>
): string | null
```

Returns the resulting string after all edits, or `null` if any edit fails (search text not found or appears more than once). No file I/O. The same logic currently lives inline in `tools.ts`; this extraction lets the loop compute a dry-run result without touching disk, and also enables unit testing the patch algorithm in isolation.

### 2. `types/index.ts`

Add `WritePreview` interface:

```ts
export interface WritePreview {
  path: string;
  before: string;
  after: string;
  diff: string; // unified diff string from createPatch()
}
```

Extend `AgentEvent`:

```ts
// pending_approval gains an optional preview field
| { type: "pending_approval"; callId: string; tool: string; args: Record<string, unknown>; preview?: WritePreview }
```

Extend `ToolCallState`:

```ts
preview?: WritePreview;
```

### 3. `lib/agent/loop.ts`

- Accept `requireWriteApproval?: boolean` in `LoopOptions`.
- When the flag is on and the resolved tool is `write_file` or `apply_patch`:
  1. Ensure checkpoint is taken (already done for both tools).
  2. Compute `before` from the checkpoint store (or empty string for new files).
  3. Compute `after`:
     - `write_file`: `args.content as string` (unescape `\n`/`\t`/`\r` same as `tools.ts` does).
     - `apply_patch`: call `simulateApplyPatch(before, edits)`. If it returns `null`, skip the gate and let the tool fail naturally with its own error message.
  4. Call `createPatch(rel, before, after, "before", "after")` to produce a unified diff string.
  5. Yield `pending_approval` with `preview: { path: rel, before, after, diff }`.
  6. Await `registerApproval(callId, 60_000)`.
  7. If rejected: emit `tool_result` with "Rejected by user." and `continue` (skip execution), identical to git mutation rejection.
  8. If accepted: fall through to normal tool execution.

Import: `import { createPatch } from "diff"` (already a project dependency; used in `DiffPanel.tsx`).

### 4. `app/api/agent/stream/route.ts`

- Add `requireWriteApproval?: boolean` to `StreamRequestBody`.
- Forward it to `runAgentLoop` options.

### 5. `hooks/useAgentStream.ts`

- Add `requireWriteApproval?: boolean` to `UseAgentStreamOptions`.
- Include it in the POST body.
- When processing a `pending_approval` event that carries a `preview` field, copy `preview` onto the matching `ToolCallState`.

### 6. `app/components/marven/SettingsModal.tsx`

- Add a toggle row in **Settings → General** under an "Agent" section header:
  - Label: "Require approval before writing files"
  - Sub-label: "Show a diff and ask before write_file or apply_patch execute"
  - Default: off
- Read/write via `localStorage` key `"agentRequireWriteApproval"`.
- Export `getRequireWriteApproval(): boolean` and `setRequireWriteApproval(v: boolean): void` helper functions (same pattern as `getFormatOnSave` / `setFormatOnSave`).

### 7. `app/components/marven/AgentPanel.tsx`

- Read `requireWriteApproval` from the helper and pass it to `useAgentStream`.
- Listen for `storage` events on `"agentRequireWriteApproval"` to pick up changes while the panel is mounted.

### 8. `app/components/marven/ToolCallCard.tsx`

- When `toolCall.status === "awaiting_approval"` and `toolCall.preview` is set, render a diff block **above** the existing Accept/Reject buttons.
- Rendering rules for the diff:
  - Split the `diff` string by `\n`.
  - Lines starting with `+` (but not `+++`): green text (`text-green-400/80`).
  - Lines starting with `-` (but not `---`): red text (`text-red-400/80`).
  - Lines starting with `@@`: faint/accent text (`text-[var(--m-text-faint)]`).
  - All other lines: muted text (`text-[var(--m-text-muted)]`).
  - Wrapped in a scrollable `<pre>` capped at `max-h-[300px]` with `overflow-y-auto`.
- The diff block collapses by default on large diffs (> 60 lines) with a "Show all" toggle.

---

## Data flow

```
[user toggles setting in SettingsModal]
  → localStorage["agentRequireWriteApproval"] = true
  → AgentPanel re-reads → passes requireWriteApproval=true to useAgentStream

POST /api/agent/stream  { …, requireWriteApproval: true }
  → runAgentLoop({ …, requireWriteApproval: true })

agent yields tool_call { tool: "write_file", callId, args }
  → loop checkpoints the file (reads before content)
  → loop computes after content + unified diff
  → loop yields pending_approval { callId, tool, args, preview: { path, before, after, diff } }
  → loop awaits registerApproval(callId, 60_000)   ← BLOCKED HERE

useAgentStream receives pending_approval event
  → sets ToolCallState { status: "awaiting_approval", preview }
  → React re-renders ToolCallCard with diff + buttons

user clicks Accept / Reject
  → POST /api/agent/approve { callId, accept }
  → resolveApproval(callId, accept)
  → loop unblocks

If accepted  → tool executes normally
If rejected  → loop yields tool_result "Rejected by user." and continues
```

---

## Error and edge cases

| Scenario | Handling |
|---|---|
| `write_file` creating a new file | `before` = `""` (file doesn't exist yet). Diff shows all lines as additions (`+`). Gate still applies. |
| `apply_patch` with invalid search | `simulateApplyPatch` returns `null` → skip the gate, tool executes and fails with its own clear error message. |
| User rejects | Loop emits `tool_result "Rejected by user."` — identical to git mutation rejection. Agent may re-plan. |
| Approval timeout (60s) | `registerApproval` auto-resolves `false` → same as reject. Countdown already shown in `ToolCallCard`. |
| `requireWriteApproval` = false (default) | Code path is entirely bypassed — no performance impact. |
| Binary / very large files | Checkpoint store records `"<too large to snapshot>"` for files > 1 MB. Loop checks for this sentinel and skips the gate; tool executes without a diff preview. |

---

## Tests

### `lib/agent/applyPatch.test.ts` (new)

Unit tests for `simulateApplyPatch`:
- Basic single-edit replacement
- Multi-edit in order
- Search text not found → returns `null`
- Ambiguous search (appears twice) → returns `null`
- Empty `replace` (deletion)
- New-file case (empty `content`)

### `lib/agent/loop.test.ts` (extend)

- `requireWriteApproval: false` → no `pending_approval` emitted for `write_file`
- `requireWriteApproval: true` → `pending_approval` with `preview` emitted before tool executes
- Rejection flow → `tool_result "Rejected by user."` emitted, tool not executed
- Acceptance flow → tool executes normally after approval

---

## Version bump

Ships as **v2.3.0** — first batch of new features post-2.2.0.
