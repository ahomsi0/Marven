// Checkpoint store: "before" snapshots of files the agent is about to modify,
// keyed by absolute path. Backed by globalThis so every route bundle shares the
// same Map even if Next.js re-imports this module (HMR, route splitting) —
// same rationale as lib/agent/approvals.ts. Without that, checkpoints recorded
// by the stream route would be invisible to the revert/checkpoints routes.

interface CheckpointEntry {
  before: string | null;
  workspaceRoot: string;
}

const g = globalThis as typeof globalThis & {
  __marvenCheckpoints?: Map<string, CheckpointEntry>;
};
if (!g.__marvenCheckpoints) g.__marvenCheckpoints = new Map();
const checkpoints = g.__marvenCheckpoints;

export const CHECKPOINT_TOO_LARGE = "<too large to snapshot>";

export function recordCheckpoint(
  path: string,
  before: string | null,
  workspaceRoot?: string,
): void {
  if (!checkpoints.has(path)) {
    checkpoints.set(path, { before, workspaceRoot: workspaceRoot ?? "" });
  }
}

export function getCheckpoint(path: string): string | null | undefined {
  return checkpoints.get(path)?.before;
}

/**
 * Remove checkpoints whose paths live under `workspaceRoot`. Used at the start
 * of an agent run so a new run can't wipe another concurrent run's baselines
 * (different root) while still resetting stale state for its own tree.
 */
export function clearCheckpoints(workspaceRoot?: string): void {
  if (!workspaceRoot) {
    checkpoints.clear();
    return;
  }
  const prefix = workspaceRoot.endsWith("/")
    ? workspaceRoot
    : workspaceRoot + "/";
  for (const path of checkpoints.keys()) {
    if (path === workspaceRoot || path.startsWith(prefix)) {
      checkpoints.delete(path);
    }
  }
}

export function listCheckpoints(): string[] {
  return Array.from(checkpoints.keys());
}

/** The workspace root a checkpoint was recorded under ("" when unknown). */
export function getCheckpointWorkspaceRoot(path: string): string {
  return checkpoints.get(path)?.workspaceRoot ?? "";
}
