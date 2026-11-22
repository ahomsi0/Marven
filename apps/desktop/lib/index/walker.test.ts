import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { walkWorkspace } from "./walker";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-walk-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function collect(root: string): Promise<string[]> {
  const out: string[] = [];
  for await (const p of walkWorkspace(root)) out.push(path.relative(root, p));
  return out.sort();
}

describe("walkWorkspace", () => {
  it("yields normal text files", async () => {
    await fs.writeFile(path.join(dir, "a.ts"), "x");
    await fs.mkdir(path.join(dir, "sub"));
    await fs.writeFile(path.join(dir, "sub", "b.ts"), "y");
    expect(await collect(dir)).toEqual(["a.ts", path.join("sub", "b.ts")]);
  });
  it("skips ignored directories", async () => {
    await fs.mkdir(path.join(dir, "node_modules"));
    await fs.writeFile(path.join(dir, "node_modules", "x.ts"), "x");
    await fs.mkdir(path.join(dir, ".git"));
    await fs.writeFile(path.join(dir, ".git", "HEAD"), "x");
    await fs.writeFile(path.join(dir, "ok.ts"), "x");
    expect(await collect(dir)).toEqual(["ok.ts"]);
  });
  it("skips binary extensions and lockfiles", async () => {
    await fs.writeFile(path.join(dir, "logo.png"), Buffer.from([0x89, 0x50]));
    await fs.writeFile(path.join(dir, "package-lock.json"), "{}");
    await fs.writeFile(path.join(dir, "real.ts"), "x");
    expect(await collect(dir)).toEqual(["real.ts"]);
  });
  it("skips files over 256KB", async () => {
    await fs.writeFile(path.join(dir, "big.txt"), Buffer.alloc(300_000, 65));
    await fs.writeFile(path.join(dir, "small.txt"), "ok");
    expect(await collect(dir)).toEqual(["small.txt"]);
  });
  it("skips files with NUL bytes in first 1024 bytes", async () => {
    const buf = Buffer.alloc(64, 65);
    buf[10] = 0;
    await fs.writeFile(path.join(dir, "binary.dat"), buf);
    await fs.writeFile(path.join(dir, "text.txt"), "hello");
    expect(await collect(dir)).toEqual(["text.txt"]);
  });
});
