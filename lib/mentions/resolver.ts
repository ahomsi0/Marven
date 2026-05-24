import { promises as fs } from "fs";
import path from "path";
import type { Mention, ResolvedMention } from "./types";
import { searchCodebase } from "@/lib/index/search";

export interface ResolveOptions {
  workspaceRoot: string;
  /** Default 50000. */
  totalBudgetChars?: number;
}

const FILE_MAX_BYTES = 32 * 1024;
const FILE_HEAD_BYTES = 24 * 1024;
const FILE_TAIL_BYTES = 4 * 1024;
const FOLDER_BUDGET = 16 * 1024;
const FOLDER_PREVIEW_LINES = 50;
const WEB_MAX_CHARS = 8 * 1024;
const DEFAULT_TOTAL_BUDGET = 50_000;
const TRUNC_MARK = "\n\n[…truncated…]\n\n";
const BUDGET_MARK = "\n[…truncated to fit context budget…]";

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp",
  cs: "csharp", php: "php", swift: "swift", kt: "kotlin",
  sh: "bash", bash: "bash", zsh: "bash", yaml: "yaml", yml: "yaml",
  json: "json", md: "markdown", html: "html", css: "css", scss: "scss",
  sql: "sql", toml: "toml", xml: "xml",
};

function langFor(p: string): string {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return LANG_BY_EXT[ext] ?? "";
}

function safeJoin(root: string, rel: string): string {
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path "${rel}" escapes the workspace`);
  }
  return resolved;
}

/** Crude binary sniff: a buffer is binary if it contains a NUL byte in the
 *  first 8KB or if more than 30% of bytes are non-printable. */
function looksBinary(buf: Buffer): boolean {
  const slice = buf.slice(0, Math.min(buf.length, 8192));
  let nonPrintable = 0;
  for (let i = 0; i < slice.length; i++) {
    const b = slice[i];
    if (b === 0) return true;
    // tab, lf, cr are printable; 9, 10, 13. Others <32 are control.
    if (b < 9 || (b > 13 && b < 32)) nonPrintable++;
  }
  return slice.length > 0 && nonPrintable / slice.length > 0.3;
}

async function resolveFile(
  rel: string,
  workspaceRoot: string,
): Promise<{ body: string; truncated: boolean; ok: boolean; error?: string }> {
  let abs: string;
  try {
    abs = safeJoin(workspaceRoot, rel);
  } catch (err) {
    return { body: "", truncated: false, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(abs);
  } catch (err) {
    return { body: "", truncated: false, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (looksBinary(buf)) {
    return { body: "", truncated: false, ok: false, error: "binary file" };
  }
  let content = buf.toString("utf8");
  let truncated = false;
  if (buf.length > FILE_MAX_BYTES) {
    const head = buf.slice(0, FILE_HEAD_BYTES).toString("utf8");
    const tail = buf.slice(buf.length - FILE_TAIL_BYTES).toString("utf8");
    content = head + TRUNC_MARK + tail;
    truncated = true;
  }
  const lang = langFor(rel);
  const body = `### File: ${rel}\n\`\`\`${lang}\n${content}\n\`\`\``;
  return { body, truncated, ok: true };
}

async function resolveFolder(
  rel: string,
  workspaceRoot: string,
): Promise<{ body: string; truncated: boolean; ok: boolean; error?: string }> {
  let abs: string;
  try {
    abs = safeJoin(workspaceRoot, rel);
  } catch (err) {
    return { body: "", truncated: false, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  let entries;
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (err) {
    return { body: "", truncated: false, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [`### Folder: ${rel}`, ""];
  let used = lines.join("\n").length;
  let truncated = false;
  let budgetReached = false;

  for (const ent of entries) {
    if (ent.isDirectory()) continue;
    if (!ent.isFile()) continue;

    if (budgetReached) {
      lines.push(`- ${ent.name}  (not previewed — folder budget reached)`);
      truncated = true;
      continue;
    }

    const childAbs = path.join(abs, ent.name);
    let buf: Buffer;
    try {
      buf = await fs.readFile(childAbs);
    } catch {
      lines.push(`- ${ent.name}  (unreadable, skipped)`);
      continue;
    }
    if (looksBinary(buf)) {
      lines.push(`- ${ent.name}  (binary, skipped)`);
      continue;
    }
    const preview = buf.toString("utf8").split("\n").slice(0, FOLDER_PREVIEW_LINES).join("\n");
    const lang = langFor(ent.name);
    const block = `- ${ent.name}\n  \`\`\`${lang}\n${preview}\n  \`\`\``;
    if (used + block.length + 1 > FOLDER_BUDGET) {
      lines.push(`- ${ent.name}  (not previewed — folder budget reached)`);
      truncated = true;
      budgetReached = true;
      continue;
    }
    lines.push(block);
    used += block.length + 1;
  }

  return { body: lines.join("\n"), truncated, ok: true };
}

async function resolveCodebaseMention(
  query: string,
  limit: number | undefined,
  workspaceRoot: string,
): Promise<{ body: string; truncated: boolean; ok: boolean; error?: string }> {
  if (!query.trim()) {
    return { body: "", truncated: false, ok: false, error: "Search query required" };
  }
  let results;
  try {
    results = await searchCodebase({ workspaceRoot, query, limit });
  } catch (err) {
    return { body: "", truncated: false, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const header = `### Codebase search: "${query}"`;
  if (!results.length) {
    return { body: `${header}\n\n(no matches)`, truncated: false, ok: true };
  }
  const parts: string[] = [header, ""];
  results.forEach((r, i) => {
    const lang = langFor(r.path);
    parts.push(`[${i + 1}] ${r.path}:${r.startLine}-${r.endLine} (distance ${r.distance.toFixed(2)})`);
    parts.push(`\`\`\`${lang}\n${r.text}\n\`\`\``);
    parts.push("");
  });
  return { body: parts.join("\n").trimEnd(), truncated: false, ok: true };
}

async function resolveWeb(
  url: string,
): Promise<{ body: string; truncated: boolean; ok: boolean; error?: string }> {
  if (!/^https?:\/\//i.test(url)) {
    return { body: "", truncated: false, ok: false, error: "Invalid URL" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    return { body: "", truncated: false, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  clearTimeout(timer);
  if (!res.ok) {
    return { body: "", truncated: false, ok: false, error: `HTTP ${res.status}` };
  }
  const raw = await res.text();
  const text = raw
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let truncated = false;
  let final = text;
  if (final.length > WEB_MAX_CHARS) {
    final = final.slice(0, WEB_MAX_CHARS);
    truncated = true;
  }
  return { body: `### Web: ${url}\n\n${final}`, truncated, ok: true };
}

export async function resolveMentions(
  mentions: Mention[],
  opts: ResolveOptions,
): Promise<ResolvedMention[]> {
  const workspaceRoot = opts.workspaceRoot;
  const totalBudget = opts.totalBudgetChars ?? DEFAULT_TOTAL_BUDGET;

  const resolved: ResolvedMention[] = [];
  for (const m of mentions) {
    let r: { body: string; truncated: boolean; ok: boolean; error?: string };
    if (m.kind === "file") {
      r = await resolveFile(m.path, workspaceRoot);
    } else if (m.kind === "folder") {
      r = await resolveFolder(m.path, workspaceRoot);
    } else if (m.kind === "codebase") {
      r = await resolveCodebaseMention(m.query, m.limit, workspaceRoot);
    } else {
      r = await resolveWeb(m.url);
    }
    resolved.push({ mention: m, ...r });
  }

  // ── Apply total-budget enforcement ──────────────────────────────────────
  const totalLen = resolved.reduce((sum, r) => sum + r.body.length, 0);
  if (totalLen > totalBudget) {
    // Proportionally truncate each body. Items with empty bodies stay empty.
    const ratio = totalBudget / totalLen;
    for (const r of resolved) {
      if (!r.body) continue;
      const target = Math.max(0, Math.floor(r.body.length * ratio) - BUDGET_MARK.length);
      if (target < r.body.length) {
        r.body = r.body.slice(0, target) + BUDGET_MARK;
        r.truncated = true;
      }
    }
  }

  return resolved;
}
