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
});
