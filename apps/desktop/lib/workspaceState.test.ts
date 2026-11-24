import { describe, it, expect, beforeEach, vi } from "vitest";

// In dev, Next.js can load this module more than once (per route bundle / after
// a hot reload). Every copy must agree on the active root, or a PATCH from one
// route is invisible to the GET served by another and the file tree comes back
// empty.
async function freshCopy() {
  vi.resetModules();
  return import("./workspaceState");
}

describe("workspaceState", () => {
  beforeEach(async () => {
    (await freshCopy()).setActiveWorkspaceRoot(null);
  });

  it("shares the active root between separately loaded copies of the module", async () => {
    const a = await freshCopy();
    a.setActiveWorkspaceRoot("/tmp/project-a");
    const b = await freshCopy();
    expect(b.getActiveWorkspaceRoot()).toBe("/tmp/project-a");
  });

  it("shares clearing the active root too", async () => {
    const a = await freshCopy();
    a.setActiveWorkspaceRoot("/tmp/project-a");
    const b = await freshCopy();
    b.setActiveWorkspaceRoot(null);
    expect(a.getActiveWorkspaceRoot()).toBeNull();
  });

  it("approving a root does not make it active", async () => {
    const a = await freshCopy();
    a.setActiveWorkspaceRoot("/tmp/project-a");
    a.approveWorkspaceRoot("/tmp/project-b");
    expect(a.getActiveWorkspaceRoot()).toBe("/tmp/project-a");
    expect(a.isApprovedWorkspaceRoot("/tmp/project-b")).toBe(true);
  });
});
