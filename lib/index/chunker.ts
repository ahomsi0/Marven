import type { Chunk } from "@/types";

export interface ChunkOptions {
  linesPerChunk?: number;
  overlapLines?: number;
  maxChars?: number;
}

export function chunkFile(path: string, content: string, opts: ChunkOptions = {}): Chunk[] {
  const linesPerChunk = opts.linesPerChunk ?? 60;
  const overlapLines = Math.max(0, Math.min(opts.overlapLines ?? 10, linesPerChunk - 1));
  const maxChars = opts.maxChars ?? 8000;
  const step = linesPerChunk - overlapLines;

  const lines = content.split("\n");
  if (lines.length === 0 || content.trim() === "") return [];
  const out: Chunk[] = [];
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(start + linesPerChunk, lines.length);
    const text = lines.slice(start, end).join("\n");
    if (text.length > maxChars) {
      if (end === lines.length) break;
      continue;
    }
    if (text.trim().length === 0) {
      if (end === lines.length) break;
      continue;
    }
    out.push({ path, startLine: start, endLine: end - 1, text });
    if (end === lines.length) break;
  }
  return out;
}
