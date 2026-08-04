import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveWorkspacePath } from "./workspacePaths";

describe("resolveWorkspacePath symlink containment", () => {
  let parent: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), "marven-wp-"));
    root = path.join(parent, "repo");
    outside = path.join(parent, "secret");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "s.txt"), "secret");
    fs.writeFileSync(path.join(root, "ok.txt"), "ok");
    // A symlink living inside the workspace that points to a directory outside it.
    fs.symlinkSync(outside, path.join(root, "link"));
  });

  afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

  it("allows a normal path inside the workspace", () => {
    expect(() => resolveWorkspacePath(root, "ok.txt")).not.toThrow();
  });

  it("rejects a path that escapes via an in-workspace symlink", () => {
    expect(() => resolveWorkspacePath(root, "link/s.txt")).toThrow(/outside workspace/i);
  });

  it("still rejects classic ../ traversal", () => {
    expect(() => resolveWorkspacePath(root, "../secret/s.txt")).toThrow(/outside workspace/i);
  });
});
