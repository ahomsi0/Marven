import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { listWorkspaceTree } from "./workspaceTree";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "marven-tree-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("listWorkspaceTree", () => {
  it("lists root-level files", async () => {
    await fs.writeFile(path.join(tmp, "index.html"), "");
    await fs.writeFile(path.join(tmp, "style.css"), "");
    const tree = await listWorkspaceTree(tmp);
    expect(tree).toContain("index.html");
    expect(tree).toContain("style.css");
  });

  it("expands one level into directories", async () => {
    await fs.mkdir(path.join(tmp, "src"));
    await fs.writeFile(path.join(tmp, "src", "app.ts"), "");
    const tree = await listWorkspaceTree(tmp);
    expect(tree).toContain("src/");
    expect(tree).toContain("  app.ts");
  });

  it("ignores noisy directories like node_modules and .git", async () => {
    await fs.mkdir(path.join(tmp, "node_modules"));
    await fs.writeFile(path.join(tmp, "node_modules", "foo.js"), "");
    await fs.mkdir(path.join(tmp, ".git"));
    await fs.writeFile(path.join(tmp, "index.html"), "");
    const tree = await listWorkspaceTree(tmp);
    expect(tree).toContain("index.html");
    expect(tree).not.toContain("node_modules");
    expect(tree).not.toContain(".git");
  });

  it("caps the listing at maxEntries and marks truncation", async () => {
    for (let i = 0; i < 30; i++) {
      await fs.writeFile(path.join(tmp, `file${i}.txt`), "");
    }
    const tree = await listWorkspaceTree(tmp, 10);
    const fileLines = tree.split("\n").filter((l) => l.startsWith("file"));
    expect(fileLines.length).toBeLessThanOrEqual(10);
    expect(tree).toContain("…");
  });

  it("returns a fallback string for an unreadable workspace", async () => {
    const tree = await listWorkspaceTree(path.join(tmp, "does-not-exist"));
    expect(tree).toBe("(workspace root unreadable)");
  });

  it("sorts directories before files at each level", async () => {
    await fs.writeFile(path.join(tmp, "a.txt"), "");
    await fs.mkdir(path.join(tmp, "zdir"));
    const tree = await listWorkspaceTree(tmp);
    const lines = tree.split("\n");
    expect(lines[0]).toBe("zdir/");
    expect(lines.some((l) => l === "a.txt")).toBe(true);
    expect(lines.indexOf("zdir/")).toBeLessThan(lines.indexOf("a.txt"));
  });
});
