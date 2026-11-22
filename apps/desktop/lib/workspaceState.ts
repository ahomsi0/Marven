// Shared workspace-root state for the Next.js API routes. Lives in module
// scope so PATCH /api/workspace/files (which sets the active root) and any
// other route in the same Node process (currently just search) read the same
// value.
//
// Server-side only — do NOT import from React components. The state is held
// in the Node process, not the browser.
//
// Approved-roots registry: routes that accept a client-supplied root only
// honor roots that have been registered via setActiveWorkspaceRoot (the PATCH
// endpoint the renderer calls after a folder is picked in the native dialog).
// Without this, any caller could pass root=/ and turn every "sandboxed" file
// operation into an unrestricted absolute-path read/write. The registry lives
// on globalThis so dev-mode HMR / route-bundle splitting can't produce
// separate instances that disagree about what's approved (same rationale as
// lib/agent/approvals.ts).

import path from "path";

let activeWorkspaceRoot: string | null = null;

type WorkspaceRegistry = Set<string>;

const g = globalThis as typeof globalThis & {
  __marvenWorkspaceRoots?: WorkspaceRegistry;
};

function registry(): WorkspaceRegistry {
  if (!g.__marvenWorkspaceRoots) g.__marvenWorkspaceRoots = new Set();
  return g.__marvenWorkspaceRoots;
}

function normalizeRoot(root: string): string {
  return path.resolve(root.trim());
}

export function getActiveWorkspaceRoot(): string | null {
  return activeWorkspaceRoot;
}

/**
 * Register a root as approved without making it active. Used by flows that
 * legitimately create workspaces server-side (clone/create routes) and by
 * tests.
 */
export function approveWorkspaceRoot(root: string): void {
  const normalized = normalizeRoot(root);
  if (normalized) registry().add(normalized);
}

export function setActiveWorkspaceRoot(root: string | null): void {
  activeWorkspaceRoot = root ? normalizeRoot(root) : null;
  if (activeWorkspaceRoot) {
    // The PATCH endpoint is the only place the renderer legitimately announces
    // a workspace (after the user picked it in the native dialog), and it goes
    // through here — so registering on set keeps every flow working.
    registry().add(activeWorkspaceRoot);
  }
}

/** Whether `root` has been registered as an approved workspace this process. */
export function isApprovedWorkspaceRoot(root: string): boolean {
  return registry().has(normalizeRoot(root));
}

/**
 * Resolve the effective workspace root for a request.
 * - No candidate → the active root (may be null).
 * - Candidate supplied → honored only if approved; returns null when rejected
 *   so the caller can answer 403 instead of silently falling back.
 */
export function resolveRequestRoot(
  candidate: string | null | undefined,
): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed) return getActiveWorkspaceRoot();
  const normalized = normalizeRoot(trimmed);
  if (!registry().has(normalized)) return null;
  return normalized;
}

/** Thrown by route helpers when a client-supplied root wasn't approved. */
export class WorkspaceNotApprovedError extends Error {
  constructor() {
    super("Workspace not approved — open the folder via Open Folder first.");
    this.name = "WorkspaceNotApprovedError";
  }
}

/** HTTP status for common workspace-path errors (shared by several routes). */
export function workspaceErrorStatus(message: string): number {
  if (message === "Path outside workspace") return 400;
  if (message.startsWith("No workspace")) return 400;
  if (message.startsWith("Workspace not approved")) return 403;
  return 500;
}
