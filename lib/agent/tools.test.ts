import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeTool, TOOL_DEFINITIONS } from "./tools";
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
  it("exports 5 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(5);
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("run_command");
    expect(names).toContain("search_files");
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
    expect(result).toBe("hello");
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
