import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import crypto from "crypto";
import { buildScopedMemoryBlock } from "@/lib/memoryHelpers";

export type MemoryScope = "global" | "project" | "conversation";

export interface MemoryContext {
  workspaceRoot?: string | null;
  conversationId?: string | null;
}

const MEMORY_ROOT = join(homedir(), ".marven", "memory");
export const DEFAULT_MEMORY_PATH = join(MEMORY_ROOT, "global.md");

function projectMemoryPath(workspaceRoot: string): string {
  const hash = crypto.createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 16);
  return join(MEMORY_ROOT, "projects", `${hash}.md`);
}

function conversationMemoryPath(conversationId: string): string {
  return join(MEMORY_ROOT, "conversations", `${conversationId}.md`);
}

export function resolveMemoryPath(
  scope: MemoryScope = "global",
  context: MemoryContext = {},
): string {
  if (scope === "project") {
    if (!context.workspaceRoot) throw new Error("workspaceRoot is required for project memory");
    return projectMemoryPath(context.workspaceRoot);
  }
  if (scope === "conversation") {
    if (!context.conversationId) throw new Error("conversationId is required for conversation memory");
    return conversationMemoryPath(context.conversationId);
  }
  return DEFAULT_MEMORY_PATH;
}

export function parseMemoryEntries(content: string): string[] {
  return content
    .split(/\n\s*\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = entry.match(/^-\s*\[[^\]]+\]\s*([\s\S]*)$/);
      return m ? m[1].trim() : entry.replace(/^-\s*/, "").trim();
    })
    .filter(Boolean);
}

export function readMemory(path = DEFAULT_MEMORY_PATH): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

export function readScopedMemory(
  scope: MemoryScope = "global",
  context: MemoryContext = {},
): string {
  return readMemory(resolveMemoryPath(scope, context));
}

export function readScopedMemoryEntries(
  scope: MemoryScope = "global",
  context: MemoryContext = {},
): string[] {
  return parseMemoryEntries(readScopedMemory(scope, context));
}

export function writeMemory(content: string, path = DEFAULT_MEMORY_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

export function writeScopedMemory(
  content: string,
  scope: MemoryScope = "global",
  context: MemoryContext = {},
): void {
  writeMemory(content, resolveMemoryPath(scope, context));
}

export function appendMemory(content: string, path = DEFAULT_MEMORY_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const entry = `\n\n- [${new Date().toISOString()}] ${content}`;
  appendFileSync(path, entry, "utf8");
}

export function appendScopedMemory(
  content: string,
  scope: MemoryScope = "global",
  context: MemoryContext = {},
): void {
  appendMemory(content, resolveMemoryPath(scope, context));
}

export function clearMemory(path = DEFAULT_MEMORY_PATH): void {
  writeMemory("", path);
}

export function clearScopedMemory(
  scope: MemoryScope = "global",
  context: MemoryContext = {},
): void {
  clearMemory(resolveMemoryPath(scope, context));
}

export function readAllMemoryScopes(context: MemoryContext = {}): Record<MemoryScope, string[]> {
  return {
    global: readScopedMemoryEntries("global", context),
    project: context.workspaceRoot ? readScopedMemoryEntries("project", context) : [],
    conversation: context.conversationId ? readScopedMemoryEntries("conversation", context) : [],
  };
}

export { buildScopedMemoryBlock };
