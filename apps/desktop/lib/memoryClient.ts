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

/**
 * One remembered item. `id` is the entry's ISO timestamp (made unique within
 * the file when written); entries written without a timestamp get a
 * position-based id ("entry-3") that only stays valid until the file changes.
 */
export interface MemoryEntry {
  id: string;
  timestamp: string | null;
  text: string;
}

/** Ids accepted from callers (ISO timestamps, "entry-N", "<timestamp>~N"). */
export const MEMORY_ID_RE = /^[A-Za-z0-9:._~+-]{1,64}$/;
/** Longest text accepted for one entry. */
export const MAX_MEMORY_TEXT = 4000;

const MEMORY_ROOT = join(homedir(), ".marven", "memory");
export const DEFAULT_MEMORY_PATH = join(MEMORY_ROOT, "global.md");
const CONVERSATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function projectMemoryPath(workspaceRoot: string): string {
  const hash = crypto.createHash("sha1").update(workspaceRoot).digest("hex").slice(0, 16);
  return join(MEMORY_ROOT, "projects", `${hash}.md`);
}

function conversationMemoryPath(conversationId: string): string {
  if (!CONVERSATION_ID_RE.test(conversationId)) {
    throw new Error("Invalid conversationId");
  }
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

const ENTRY_RE = /^-\s*\[([^\]]+)\]\s*([\s\S]*)$/;

/**
 * Entries are separated by blank lines, so a blank line inside the text would
 * split it into two entries on the next read. Collapse those (and CRLFs).
 */
export function normalizeMemoryText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n\s*\n+/g, "\n").trim();
}

interface MemoryFile {
  leading: string;
  trailing: string;
  blocks: string[];
}

function splitMemoryFile(content: string): MemoryFile {
  const leading = content.match(/^\s*/)?.[0] ?? "";
  const rest = content.slice(leading.length);
  const trailing = rest.match(/\s*$/)?.[0] ?? "";
  const body = rest.slice(0, rest.length - trailing.length);
  const blocks = body ? body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean) : [];
  return { leading, trailing, blocks };
}

function joinMemoryFile(file: MemoryFile): string {
  if (file.blocks.length === 0) return "";
  return `${file.leading}${file.blocks.join("\n\n")}${file.trailing}`;
}

/** Entries with ids, one per block, in file order (blocks with no text are skipped). */
function entriesWithBlockIndex(blocks: string[]): Array<MemoryEntry & { block: number }> {
  const seen = new Map<string, number>();
  const out: Array<MemoryEntry & { block: number }> = [];
  blocks.forEach((block, i) => {
    const m = block.match(ENTRY_RE);
    const timestamp = m ? m[1].trim() : null;
    const text = (m ? m[2] : block.replace(/^-\s*/, "")).trim();
    let id: string;
    if (timestamp && MEMORY_ID_RE.test(timestamp)) {
      const n = seen.get(timestamp) ?? 0;
      seen.set(timestamp, n + 1);
      id = n === 0 ? timestamp : `${timestamp}~${n}`;
    } else {
      id = `entry-${i}`;
    }
    if (text) out.push({ id, timestamp, text, block: i });
  });
  return out;
}

export function parseMemoryFile(content: string): MemoryEntry[] {
  return entriesWithBlockIndex(splitMemoryFile(content).blocks).map(({ id, timestamp, text }) => ({
    id,
    timestamp,
    text,
  }));
}

export function listMemoryEntries(path = DEFAULT_MEMORY_PATH): MemoryEntry[] {
  return parseMemoryFile(readMemory(path));
}

function formatEntry(timestamp: string | null, text: string): string {
  return timestamp ? `- [${timestamp}] ${text}` : `- ${text}`;
}

/** Replace one entry's text, keeping its timestamp and the rest of the file. */
export function editMemoryEntry(id: string, text: string, path = DEFAULT_MEMORY_PATH): MemoryEntry | null {
  const clean = normalizeMemoryText(text);
  if (!clean) throw new Error("text is required");
  const file = splitMemoryFile(readMemory(path));
  const target = entriesWithBlockIndex(file.blocks).find((e) => e.id === id);
  if (!target) return null;
  file.blocks[target.block] = formatEntry(target.timestamp, clean);
  writeMemory(joinMemoryFile(file), path);
  return { id: target.id, timestamp: target.timestamp, text: clean };
}

/** Remove one entry; returns false when no entry has that id. */
export function deleteMemoryEntry(id: string, path = DEFAULT_MEMORY_PATH): boolean {
  const file = splitMemoryFile(readMemory(path));
  const target = entriesWithBlockIndex(file.blocks).find((e) => e.id === id);
  if (!target) return false;
  file.blocks.splice(target.block, 1);
  writeMemory(joinMemoryFile(file), path);
  return true;
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

/**
 * Add an entry and return it. The timestamp doubles as the entry's id, so it
 * is nudged forward a millisecond at a time if the file already has it.
 */
export function appendMemory(content: string, path = DEFAULT_MEMORY_PATH): MemoryEntry {
  mkdirSync(dirname(path), { recursive: true });
  const text = normalizeMemoryText(content);
  const taken = new Set(
    splitMemoryFile(readMemory(path)).blocks.map((b) => b.match(ENTRY_RE)?.[1]?.trim()).filter(Boolean),
  );
  let time = Date.now();
  let timestamp = new Date(time).toISOString();
  while (taken.has(timestamp)) {
    time += 1;
    timestamp = new Date(time).toISOString();
  }
  appendFileSync(path, `\n\n${formatEntry(timestamp, text)}`, "utf8");
  return { id: timestamp, timestamp, text };
}

export function appendScopedMemory(
  content: string,
  scope: MemoryScope = "global",
  context: MemoryContext = {},
): MemoryEntry {
  return appendMemory(content, resolveMemoryPath(scope, context));
}

export function listScopedMemoryEntries(
  scope: MemoryScope = "global",
  context: MemoryContext = {},
): MemoryEntry[] {
  return listMemoryEntries(resolveMemoryPath(scope, context));
}

export function editScopedMemoryEntry(
  id: string,
  text: string,
  scope: MemoryScope,
  context: MemoryContext = {},
): MemoryEntry | null {
  return editMemoryEntry(id, text, resolveMemoryPath(scope, context));
}

export function deleteScopedMemoryEntry(
  id: string,
  scope: MemoryScope,
  context: MemoryContext = {},
): boolean {
  return deleteMemoryEntry(id, resolveMemoryPath(scope, context));
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

export function readAllMemoryEntries(context: MemoryContext = {}): Record<MemoryScope, MemoryEntry[]> {
  return {
    global: listScopedMemoryEntries("global", context),
    project: context.workspaceRoot ? listScopedMemoryEntries("project", context) : [],
    conversation: context.conversationId ? listScopedMemoryEntries("conversation", context) : [],
  };
}

export function readAllMemoryScopes(context: MemoryContext = {}): Record<MemoryScope, string[]> {
  return {
    global: readScopedMemoryEntries("global", context),
    project: context.workspaceRoot ? readScopedMemoryEntries("project", context) : [],
    conversation: context.conversationId ? readScopedMemoryEntries("conversation", context) : [],
  };
}

export { buildScopedMemoryBlock };
