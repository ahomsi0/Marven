import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { executeTool, TOOL_DEFINITIONS, formatWebSearchResult } from "./tools";
import * as memoryClient from "@/lib/memoryClient";
import fs from "fs/promises";
import os from "os";
import path from "path";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TOOL_DEFINITIONS", () => {
  it("exports 15 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(15);
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("apply_patch");
    expect(names).toContain("run_command");
    expect(names).toContain("search_files");
    expect(names).toContain("web_search");
    expect(names).toContain("fetch_url");
    expect(names).toContain("remember");
    expect(names).toContain("git_status");
    expect(names).toContain("git_diff");
    expect(names).toContain("git_log");
    expect(names).toContain("git_commit");
    expect(names).toContain("git_branch");
    expect(names).toContain("git_checkout");
  });
});

describe("executeTool – write_file + read_file", () => {
  it("writes then reads a file", async () => {
    await executeTool("write_file", { path: "hello.txt", content: "world" }, tmpDir);
    const result = await executeTool("read_file", { path: "hello.txt" }, tmpDir);
    expect(result).toBe("world");
  });
});

describe("executeTool – list_files", () => {
  it("lists files in workspace root", async () => {
    await fs.writeFile(path.join(tmpDir, "a.ts"), "");
    await fs.writeFile(path.join(tmpDir, "b.ts"), "");
    const result = await executeTool("list_files", {}, tmpDir);
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
  });
});

describe("executeTool – path escape guard", () => {
  it("rejects paths that escape workspace", async () => {
    await expect(
      executeTool("read_file", { path: "../../etc/passwd" }, tmpDir)
    ).rejects.toThrow("escapes the workspace");
  });
});

describe("executeTool – run_command blocks dangerous patterns", () => {
  it("blocks sudo", async () => {
    const result = await executeTool("run_command", { command: "sudo ls" }, tmpDir);
    expect(result).toMatch(/blocked/i);
  });

  it("blocks rm -rf /", async () => {
    const result = await executeTool("run_command", { command: "rm -rf /" }, tmpDir);
    expect(result).toMatch(/blocked/i);
  });

  it("runs safe commands", async () => {
    const result = await executeTool("run_command", { command: "echo hello" }, tmpDir);
    expect(result.trim()).toBe("hello");
  });
});

describe("executeTool – search_files", () => {
  it("finds matching content", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "export function hello() {}");
    const result = await executeTool("search_files", { query: "hello" }, tmpDir);
    expect(result).toContain("hello");
  });

  it("returns no-matches message when nothing found", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "nothing here");
    const result = await executeTool("search_files", { query: "zzznomatch" }, tmpDir);
    expect(result).toMatch(/no matches/i);
  });
});

describe("executeTool — remember", () => {
  it("returns 'Remembered.' and calls appendMemory", async () => {
    const spy = vi.spyOn(memoryClient, "appendMemory").mockImplementation(() => {});
    const result = await executeTool("remember", { content: "user prefers TypeScript" }, "/tmp");
    expect(result).toBe("Remembered.");
    expect(spy).toHaveBeenCalledWith("user prefers TypeScript");
    spy.mockRestore();
  });

  it("returns error string when appendMemory throws", async () => {
    vi.spyOn(memoryClient, "appendMemory").mockImplementation(() => {
      throw new Error("disk full");
    });
    const result = await executeTool("remember", { content: "test" }, "/tmp");
    expect(result).toContain("disk full");
    vi.restoreAllMocks();
  });
});

describe("formatWebSearchResult", () => {
  it("returns no results message when data is empty", () => {
    expect(formatWebSearchResult({})).toBe("No results found.");
  });

  it("includes AbstractText and AbstractURL", () => {
    const result = formatWebSearchResult({
      AbstractText: "Node.js is a JavaScript runtime",
      AbstractURL: "https://nodejs.org",
    });
    expect(result).toContain("Node.js is a JavaScript runtime");
    expect(result).toContain("https://nodejs.org");
  });

  it("includes up to 5 related topics", () => {
    const topics = Array.from({ length: 7 }, (_, i) => ({
      Text: `Topic ${i}`,
      FirstURL: `https://example.com/${i}`,
    }));
    const result = formatWebSearchResult({ RelatedTopics: topics });
    const matches = result.match(/- Topic \d/g) ?? [];
    expect(matches).toHaveLength(5);
  });

  it("skips topics that have a nested Topics array (category groups)", () => {
    const result = formatWebSearchResult({
      RelatedTopics: [
        { Topics: [{}] },
        { Text: "Good topic", FirstURL: "https://example.com" },
      ],
    });
    expect(result).toContain("Good topic");
    expect(result).not.toContain("Topics");
  });
});

describe("executeTool – apply_patch", () => {
  it("applies a single search/replace edit", async () => {
    const filename = "hello.ts";
    await fs.writeFile(path.join(tmpDir, filename), "const greeting = 'hi';\n", "utf-8");
    const out = await executeTool(
      "apply_patch",
      { path: filename, edits: [{ search: "'hi'", replace: "'hello'" }] },
      tmpDir,
    );
    expect(out).toContain("apply_patch ok");
    const final = await fs.readFile(path.join(tmpDir, filename), "utf-8");
    expect(final).toBe("const greeting = 'hello';\n");
  });

  it("applies multiple edits in order", async () => {
    await fs.writeFile(path.join(tmpDir, "f.ts"), "let a = 1;\nlet b = 2;\n", "utf-8");
    const out = await executeTool(
      "apply_patch",
      {
        path: "f.ts",
        edits: [
          { search: "let a = 1;", replace: "let a = 10;" },
          { search: "let b = 2;", replace: "let b = 20;" },
        ],
      },
      tmpDir,
    );
    expect(out).toContain("2 edit(s) applied");
    const final = await fs.readFile(path.join(tmpDir, "f.ts"), "utf-8");
    expect(final).toBe("let a = 10;\nlet b = 20;\n");
  });

  it("deletes when replace is empty", async () => {
    await fs.writeFile(path.join(tmpDir, "f.ts"), "keep\nremove me\nkeep again\n", "utf-8");
    const out = await executeTool(
      "apply_patch",
      { path: "f.ts", edits: [{ search: "remove me\n", replace: "" }] },
      tmpDir,
    );
    expect(out).toContain("apply_patch ok");
    const final = await fs.readFile(path.join(tmpDir, "f.ts"), "utf-8");
    expect(final).toBe("keep\nkeep again\n");
  });

  it("fails clearly when search text is not found", async () => {
    await fs.writeFile(path.join(tmpDir, "f.ts"), "actual\n", "utf-8");
    const out = await executeTool(
      "apply_patch",
      { path: "f.ts", edits: [{ search: "missing", replace: "x" }] },
      tmpDir,
    );
    expect(out).toContain("not found");
    // File should NOT have been modified
    const final = await fs.readFile(path.join(tmpDir, "f.ts"), "utf-8");
    expect(final).toBe("actual\n");
  });

  it("fails clearly when search text appears multiple times", async () => {
    await fs.writeFile(path.join(tmpDir, "f.ts"), "foo\nfoo\n", "utf-8");
    const out = await executeTool(
      "apply_patch",
      { path: "f.ts", edits: [{ search: "foo", replace: "bar" }] },
      tmpDir,
    );
    expect(out).toContain("multiple times");
    const final = await fs.readFile(path.join(tmpDir, "f.ts"), "utf-8");
    expect(final).toBe("foo\nfoo\n");
  });

  it("does not partially apply when a later edit fails", async () => {
    await fs.writeFile(path.join(tmpDir, "f.ts"), "ok\nalso ok\n", "utf-8");
    const out = await executeTool(
      "apply_patch",
      {
        path: "f.ts",
        edits: [
          { search: "ok", replace: "fine" },           // unique only on the first line ("also ok" contains "ok")
          { search: "missing", replace: "x" },          // would fail if reached
        ],
      },
      tmpDir,
    );
    // First edit fails (multiple matches) — file must be untouched.
    expect(out).toMatch(/multiple times|not found/);
    const final = await fs.readFile(path.join(tmpDir, "f.ts"), "utf-8");
    expect(final).toBe("ok\nalso ok\n");
  });

  it("unescapes literal \\n in search/replace", async () => {
    await fs.writeFile(path.join(tmpDir, "f.ts"), "line1\nline2\n", "utf-8");
    const out = await executeTool(
      "apply_patch",
      { path: "f.ts", edits: [{ search: "line1\\nline2", replace: "newline1\\nnewline2" }] },
      tmpDir,
    );
    expect(out).toContain("apply_patch ok");
    const final = await fs.readFile(path.join(tmpDir, "f.ts"), "utf-8");
    expect(final).toBe("newline1\nnewline2\n");
  });

  it("rejects empty search", async () => {
    await fs.writeFile(path.join(tmpDir, "f.ts"), "x\n", "utf-8");
    const out = await executeTool(
      "apply_patch",
      { path: "f.ts", edits: [{ search: "", replace: "y" }] },
      tmpDir,
    );
    expect(out).toContain("empty");
  });

  it("rejects non-array edits", async () => {
    const out = await executeTool(
      "apply_patch",
      { path: "f.ts", edits: "not an array" },
      tmpDir,
    );
    expect(out).toContain("non-empty array");
  });
});
