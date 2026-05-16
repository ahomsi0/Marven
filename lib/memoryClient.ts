import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";

export const DEFAULT_MEMORY_PATH = join(homedir(), ".marven", "memory.md");

export function readMemory(path = DEFAULT_MEMORY_PATH): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

export function writeMemory(content: string, path = DEFAULT_MEMORY_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function appendMemory(content: string, path = DEFAULT_MEMORY_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const entry = `\n\n- [${new Date().toISOString()}] ${content}`;
  appendFileSync(path, entry, "utf8");
}

export function clearMemory(path = DEFAULT_MEMORY_PATH): void {
  writeMemory("", path);
}
