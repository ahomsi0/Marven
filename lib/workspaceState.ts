// Shared workspace-root state for the Next.js API routes. Lives in module
// scope so PATCH /api/workspace/files (which sets the active root) and any
// other route in the same Node process (currently just search) read the same
// value.
//
// Server-side only — do NOT import from React components. The state is held
// in the Node process, not the browser.

let activeWorkspaceRoot: string | null = null;

export function getActiveWorkspaceRoot(): string | null {
  return activeWorkspaceRoot;
}

export function setActiveWorkspaceRoot(root: string | null): void {
  activeWorkspaceRoot = root;
}
