import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  assertRealpathInsideWorkspace,
  resolveSymlinksLeniently,
  resolveWorkspacePath,
} from "./workspacePaths";
import { executeTool } from "./agent/tools";

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

describe("dangling and nested symlinks", () => {
  let parent: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), "marven-wp-dangling-"));
    root = path.join(parent, "ws");
    outside = path.join(parent, "home");
    fs.mkdirSync(root);
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(path.join(root, "src", "real.txt"), "real");
    // ws/evil -> home/.zshenv, which does NOT exist (dangling, absolute)
    fs.symlinkSync(path.join(outside, ".zshenv"), path.join(root, "evil"));
    // ws/evil-rel -> ../home/.profile (dangling, relative)
    fs.symlinkSync(path.join("..", "home", ".profile"), path.join(root, "evil-rel"));
    // ws/hop -> ws/evil (chain ending in a dangling link outside)
    fs.symlinkSync("evil", path.join(root, "hop"));
    // ws/alias -> ws/src (symlink that stays inside)
    fs.symlinkSync("src", path.join(root, "alias"));
    // ws/new-inside -> ws/src/not-yet.txt (dangling, but inside)
    fs.symlinkSync(path.join("src", "not-yet.txt"), path.join(root, "new-inside"));
    // ws/outdir -> home (existing dir outside) for nested new paths
    fs.symlinkSync(outside, path.join(root, "outdir"));
  });

  afterEach(() => fs.rmSync(parent, { recursive: true, force: true }));

  it("resolves a dangling symlink to its target instead of its parent", () => {
    expect(resolveSymlinksLeniently(path.join(root, "evil"))).toBe(
      path.join(fs.realpathSync(outside), ".zshenv"),
    );
  });

  it("rejects a dangling symlink pointing outside (absolute and relative targets)", () => {
    expect(() => assertRealpathInsideWorkspace(root, path.join(root, "evil"))).toThrow(/outside workspace/i);
    expect(() => assertRealpathInsideWorkspace(root, path.join(root, "evil-rel"))).toThrow(/outside workspace/i);
    expect(() => resolveWorkspacePath(root, "evil")).toThrow(/outside workspace/i);
  });

  it("rejects a chain of links that ends outside", () => {
    expect(() => resolveWorkspacePath(root, "hop")).toThrow(/outside workspace/i);
  });

  it("rejects a not-yet-existing file under a symlinked directory outside", () => {
    expect(() => resolveWorkspacePath(root, "outdir/new/file.txt")).toThrow(/outside workspace/i);
  });

  it("allows symlinks that stay inside, existing or dangling", () => {
    expect(() => resolveWorkspacePath(root, "alias/real.txt")).not.toThrow();
    expect(() => resolveWorkspacePath(root, "new-inside")).not.toThrow();
  });

  it("allows normal files and not-yet-created paths", () => {
    expect(() => resolveWorkspacePath(root, "src/real.txt")).not.toThrow();
    expect(() => resolveWorkspacePath(root, "src/deep/new/file.ts")).not.toThrow();
  });

  it("detects symlink loops", () => {
    fs.symlinkSync("loop-b", path.join(root, "loop-a"));
    fs.symlinkSync("loop-a", path.join(root, "loop-b"));
    expect(() => resolveWorkspacePath(root, "loop-a")).toThrow();
  });

  it("write_file refuses to write through a dangling symlink to outside", async () => {
    const out = await executeTool("write_file", { path: "evil", content: "export PWNED=1\n" }, root).catch(
      (e: Error) => `threw: ${e.message}`,
    );
    expect(out).toMatch(/outside workspace|escapes/i);
    expect(fs.existsSync(path.join(outside, ".zshenv"))).toBe(false);
  });

  it("write_file still writes normal files and through inside symlinks", async () => {
    await executeTool("write_file", { path: "src/new.txt", content: "hi" }, root);
    expect(fs.readFileSync(path.join(root, "src", "new.txt"), "utf8")).toBe("hi");
    await executeTool("write_file", { path: "new-inside", content: "via link" }, root);
    expect(fs.readFileSync(path.join(root, "src", "not-yet.txt"), "utf8")).toBe("via link");
  });
});
