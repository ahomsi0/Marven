import fs from "fs/promises";
import path from "path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "out",
  ".cache",
  ".turbo",
  "coverage",
  "target",
  "__pycache__",
  ".venv",
  "venv",
]);
const SKIP_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".mp3",
  ".mp4",
  ".wav",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".bin",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
]);
const SKIP_NAMES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
]);
const MAX_SIZE = 256 * 1024;

export interface WalkOptions {
  includeBinaryChecks?: boolean;
}

async function hasNullByte(filePath: string): Promise<boolean> {
  const fh = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(1024);
    const { bytesRead } = await fh.read(buf, 0, 1024, 0);
    for (let i = 0; i < bytesRead; i++) if (buf[i] === 0) return true;
    return false;
  } finally {
    await fh.close();
  }
}

export async function* walkWorkspace(
  root: string,
  _opts: WalkOptions = {},
): AsyncGenerator<string> {
  async function* visit(dir: string): AsyncGenerator<string> {
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        yield* visit(abs);
      } else if (ent.isFile()) {
        if (SKIP_NAMES.has(ent.name)) continue;
        if (ent.name.endsWith(".tsbuildinfo")) continue;
        const ext = path.extname(ent.name).toLowerCase();
        if (SKIP_EXTS.has(ext)) continue;
        const st = await fs.stat(abs).catch(() => null);
        if (!st || st.size > MAX_SIZE) continue;
        if (await hasNullByte(abs)) continue;
        yield abs;
      }
    }
  }
  yield* visit(root);
}
