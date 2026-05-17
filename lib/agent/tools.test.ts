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
  it("exports 14 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(14);
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
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
