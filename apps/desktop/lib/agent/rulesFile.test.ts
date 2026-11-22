import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { formatRulesBlock, loadWorkspaceRules } from "./rulesFile";

describe("loadWorkspaceRules", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-rules-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns null when no rules file exists", async () => {
    expect(await loadWorkspaceRules(dir)).toBeNull();
    expect(formatRulesBlock(await loadWorkspaceRules(dir))).toBe("");
  });

  it("loads MARVEN.md from the workspace root", async () => {
    await fs.writeFile(path.join(dir, "MARVEN.md"), "# Rules\n\nAlways run tests.\n", "utf8");
    const rules = await loadWorkspaceRules(dir);
    expect(rules?.source).toBe("MARVEN.md");
    expect(rules?.content).toContain("Always run tests.");
    const block = formatRulesBlock(rules);
    expect(block).toContain("### Project instructions (MARVEN.md)");
    expect(block).toContain("Always run tests.");
  });

  it("falls back to .marven/rules.md when MARVEN.md is missing", async () => {
    await fs.mkdir(path.join(dir, ".marven"), { recursive: true });
    await fs.writeFile(
      path.join(dir, ".marven", "rules.md"),
      "Use pnpm, never npm.",
      "utf8",
    );
    const rules = await loadWorkspaceRules(dir);
    expect(rules?.source).toBe(".marven/rules.md");
    expect(rules?.content).toContain("Use pnpm");
  });

  it("prefers MARVEN.md over .marven/rules.md", async () => {
    await fs.writeFile(path.join(dir, "MARVEN.md"), "root rules", "utf8");
    await fs.mkdir(path.join(dir, ".marven"), { recursive: true });
    await fs.writeFile(path.join(dir, ".marven", "rules.md"), "nested rules", "utf8");
    const rules = await loadWorkspaceRules(dir);
    expect(rules?.source).toBe("MARVEN.md");
    expect(rules?.content).toBe("root rules");
  });

  it("caps content at 16KB", async () => {
    await fs.writeFile(path.join(dir, "MARVEN.md"), "x".repeat(40_000), "utf8");
    const rules = await loadWorkspaceRules(dir);
    expect(rules?.content.length).toBeLessThanOrEqual(16 * 1024);
  });

  it("ignores an empty rules file", async () => {
    await fs.writeFile(path.join(dir, "MARVEN.md"), "   \n  ", "utf8");
    expect(await loadWorkspaceRules(dir)).toBeNull();
  });

  describe("symlink containment", () => {
    let outside: string;
    beforeEach(async () => {
      outside = await fs.mkdtemp(path.join(os.tmpdir(), "marven-rules-outside-"));
      await fs.writeFile(path.join(outside, "secret"), "TOP-SECRET-KEY", "utf8");
    });
    afterEach(async () => {
      await fs.rm(outside, { recursive: true, force: true });
    });

    it("ignores MARVEN.md symlinked to a file outside the workspace", async () => {
      await fs.symlink(path.join(outside, "secret"), path.join(dir, "MARVEN.md"));
      expect(await loadWorkspaceRules(dir)).toBeNull();
    });

    it("falls through to the next candidate when the first escapes", async () => {
      await fs.symlink(path.join(outside, "secret"), path.join(dir, "MARVEN.md"));
      await fs.mkdir(path.join(dir, ".marven"));
      await fs.writeFile(path.join(dir, ".marven", "rules.md"), "safe rules", "utf8");
      const rules = await loadWorkspaceRules(dir);
      expect(rules?.source).toBe(".marven/rules.md");
      expect(rules?.content).toBe("safe rules");
    });

    it("still loads a symlink that points inside the workspace", async () => {
      await fs.mkdir(path.join(dir, "docs"));
      await fs.writeFile(path.join(dir, "docs", "rules.md"), "inside rules", "utf8");
      await fs.symlink(path.join(dir, "docs", "rules.md"), path.join(dir, "MARVEN.md"));
      const rules = await loadWorkspaceRules(dir);
      expect(rules?.content).toBe("inside rules");
    });

    it("ignores a .marven directory symlinked outside the workspace", async () => {
      await fs.writeFile(path.join(outside, "rules.md"), "TOP-SECRET-KEY", "utf8");
      await fs.symlink(outside, path.join(dir, ".marven"));
      expect(await loadWorkspaceRules(dir)).toBeNull();
    });
  });
});
