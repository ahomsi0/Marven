# Wave 5 — Agent Power (Design)

**Date:** 2026-05-17
**Goal:** Make agent mode dramatically more capable: git awareness, visual diff review of agent changes, and live command output streaming.

---

## Architecture

Three isolated pieces, each with one clear boundary. None depends on the others — they could ship independently if needed.

### Piece 1 — Git tools

Six new agent tools in `lib/agent/tools.ts`, each shelling to `git` via `child_process.execFile` (safer than `exec` — no shell injection, no need to quote arguments).

| Tool | Kind | Args | Notes |
|---|---|---|---|
| `git_status` | read | none | Wraps `git status --porcelain=v1` |
| `git_diff` | read | `path?: string` | Wraps `git diff` (or `git diff <path>`) |
| `git_log` | read | none | Last 10 commits, oneline |
| `git_commit` | **mutation** | `message: string` | Stages all + commits |
| `git_branch` | **mutation** | `name: string`, `create?: boolean` | Create new or switch |
| `git_checkout` | **mutation** | `target: string` | Restore file or switch branch |

All tools `cwd` to the current `workspaceRoot`. If not in a git repo, return a clean error string instead of throwing.

### Piece 2 — Approval gating

A mutation tool, when invoked by the model, does NOT execute immediately. Instead the agent loop:

1. Emits a `pending_approval` SSE event with `callId`, `tool`, `args`
2. Pauses by awaiting a promise stored in a `pendingApprovals` Map keyed by `callId`
3. The user's UI renders Approve / Reject buttons inside that tool's card
4. Clicking Approve POSTs to `/api/agent/approve` with the `callId`
5. The endpoint resolves the gated promise; the loop executes the tool and continues
6. Reject resolves the promise with a "rejected by user" error string returned as the tool result

A timeout (60s default) auto-rejects if the user doesn't respond, so the loop never hangs forever.

The approval state lives in a per-session module-level Map. Since this is a single-user desktop app, there's no multi-tenancy concern.

### Piece 3 — Diff viewer (post-hoc with checkpoint)

A new `DiffPanel.tsx` component appears as a third toggleable column in `AgentWorkspace`, between the editor panel and the right edge. A second drag handle sits between editor and diff panel (the existing handle between agent and editor stays).

**Checkpoint flow:**

1. On agent run start, the loop creates a `checkpointFiles: Map<string, string>` keyed by absolute file path
2. Before any `write_file` or `git_checkout` tool executes, if that file hasn't been snapshotted yet, the loop reads its current content into the map (or marks it as "didn't exist" with a `null` sentinel)
3. The loop emits a `checkpoint` event when a new file is snapshotted, so the UI can show "tracking N files"
4. After the run, the DiffPanel reads each snapshotted file's current state and shows a unified diff vs the checkpoint
5. Each file gets a "Revert to checkpoint" button that writes the snapshot back (or deletes the file if the snapshot was `null`)

The `diff` npm package (~12KB, well-maintained) computes hunks. We render unified diffs (one column) for simplicity — side-by-side adds significant layout complexity and the panel is narrow.

Writes still hit disk immediately. The snapshot is the rollback safety net.

### Piece 4 — Live terminal streaming

`run_command` currently runs to completion then returns one big string. Wave 5 changes it to:

1. Spawn the child process with `child_process.spawn` (not `exec`)
2. Pipe stdout + stderr through line buffering
3. Yield each line as a `tool_progress` SSE event with `callId` and the chunk
4. When the process exits, emit the final `tool_result` event with the full accumulated output (as today)

The agent loop accumulates the same output internally so the model sees the complete result. The UI sees both: live progress during the run, plus the final snapshot in the tool card.

`useAgentStream` adds a new `liveTerminalOutput: string` state (cleared when a `tool_result` arrives). The existing terminal panel in `EditorPanel` displays this when set.

---

## File map

| File | Action | Reason |
|---|---|---|
| `lib/agent/git.ts` | Create | `runGit(args, cwd)` helper with error normalization |
| `lib/agent/tools.ts` | Modify | 6 git tool defs + cases; `run_command` streams |
| `lib/agent/loop.ts` | Modify | Checkpoint, approval gating, progress forwarding |
| `lib/agent/approvals.ts` | Create | Module-level pending approvals Map |
| `app/api/agent/stream/route.ts` | Modify | Forward new SSE events |
| `app/api/agent/approve/route.ts` | Create | POST endpoint to approve/reject |
| `app/components/marven/DiffPanel.tsx` | Create | Diff renderer + per-file revert |
| `app/components/marven/AgentWorkspace.tsx` | Modify | Third panel, second drag handle, toggle button |
| `app/components/marven/ToolCallCard.tsx` | Modify | Approve/Reject UI + live progress display |
| `hooks/useAgentStream.ts` | Modify | New events, `approve(callId, accept)` function |
| `types/index.ts` | Modify | Extend `AgentEvent`, add `PendingApproval` type |
| `package.json` | Modify | Add `diff` dependency |

---

## Type extensions

```ts
// types/index.ts
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
  before: string | null;  // null = file didn't exist at checkpoint
  after: string | null;   // null = file was deleted
}
```

---

## API contracts

### `POST /api/agent/approve`

```json
{ "callId": "string", "accept": true }
```

Resolves the gated promise on the server. Returns `{ ok: true }`. Returns 404 if `callId` isn't pending.

### SSE event shapes

Already documented in the `AgentEvent` union above. Events are emitted in the same SSE format as today (`event: <type>\ndata: <json>\n\n`).

---

## Testing

| Module | Tests |
|---|---|
| `lib/agent/git.ts` | Mocked `execFile`: success path, non-zero exit, ENOENT (no git), not in repo |
| `lib/agent/approvals.ts` | Register → resolve, register → reject, timeout |
| `lib/agent/loop.ts` | Checkpoint records file content; mutation pauses on emit |
| `DiffPanel.tsx` | Renders correct hunks for a known before/after; revert button calls handler with right path |
| `useAgentStream.ts` | Accumulates `tool_progress` chunks; resets on `tool_result` |

Approval-flow integration test: dispatch a fake `git_commit` call, verify the loop blocks until a fetch to `/api/agent/approve` lands.

---

## Risks / Edge Cases

- **Workspace is not a git repo.** Git tools must return a clean message, not crash the agent loop. Detect via `git rev-parse --git-dir` once at the start of a tool call, or just normalize the `execFile` exit code.
- **Checkpoint memory.** A large workspace with many writes could balloon memory. Mitigation: cap checkpoint to 1MB per file; bigger files get a sentinel `<too large to snapshot>` and no revert button.
- **Approval timeout during long thought.** 60s is the cap; if user is AFK the tool is auto-rejected. Tool result reads "rejected by user (timeout)". Loop continues; model can react.
- **Live terminal flood.** Some commands emit thousands of lines (e.g. `find /`). Cap displayed live output at 500 lines (head-discard); the full output still goes to the model in the final result (already truncated at 8000 chars elsewhere).
- **Drag handle conflict.** Two drag handles need separate state. Each is local to its handle component; no global drag manager needed.

---

## Out of scope

- Side-by-side diff view (unified only)
- Stage selection / partial commits (the agent commits all tracked changes)
- Multi-line stash management
- Rebase / merge tools (too dangerous, separate decision later)
- Approval audit log

---

## Self-review

- **Placeholders:** none — every section is concrete
- **Internal consistency:** type definitions match the events emitted by the loop; tool list matches the approval rules
- **Scope:** focused on three cohesive features; each could ship alone
- **Ambiguity:** Diff format pinned to unified. Approval timeout pinned to 60s. Live output cap pinned to 500 lines.
