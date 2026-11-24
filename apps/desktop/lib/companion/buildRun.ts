// Pure helpers for Mini Me's "Build it here": which Agent approvals Mini Me may
// answer itself, what to show while the Agent works, and the URL it printed.
// No Node `path` here: this runs in the renderer, on macOS and Windows alike.

import type { AgentEvent } from "@/types";

const WIN_ABSOLUTE = /^[A-Za-z]:[\\/]/;

interface SplitPath {
  /** "" for POSIX, "c:" (lowercased) for a Windows drive. */
  drive: string;
  segments: string[];
}

/** Absolute path → drive + resolved segments (".." can't climb above the root). */
function resolveSegments(abs: string, windows: boolean): SplitPath {
  const unified = abs.replace(/\\/g, "/");
  const drive = windows ? unified.slice(0, 2).toLowerCase() : "";
  const rest = windows ? unified.slice(2) : unified;
  const segments: string[] = [];
  for (const part of rest.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(windows ? part.toLowerCase() : part);
  }
  return { drive, segments };
}

/**
 * True when `target` (relative to `root`, or absolute) lands strictly inside
 * `root`. Backslashes count as separators everywhere, so `..\..\x` is caught
 * even on macOS; Windows paths compare case-insensitively. Anything unclear
 * (empty, `~`, NUL, a relative root) is false. Symlinks are not followed: the
 * server's own path check is the boundary for those.
 */
export function isInsideRoot(target: string, root: string): boolean {
  if (typeof target !== "string" || typeof root !== "string") return false;
  const t = target.trim();
  if (!t || t.startsWith("~") || t.includes("\0") || root.includes("\0")) return false;

  const windows = WIN_ABSOLUTE.test(root);
  if (!windows && !root.startsWith("/")) return false;

  let abs: string;
  if (windows) {
    if (WIN_ABSOLUTE.test(t)) abs = t;
    else if (/^[\\/]/.test(t) || /^[A-Za-z]:/.test(t)) return false; // drive-relative: ambiguous
    else abs = `${root}/${t}`;
  } else {
    if (/^[A-Za-z]:/.test(t)) return false;
    abs = t.startsWith("/") ? t : `${root}/${t}`;
  }

  const r = resolveSegments(root, windows);
  const p = resolveSegments(abs, windows);
  if (r.drive !== p.drive) return false;
  if (p.segments.length <= r.segments.length) return false;
  return r.segments.every((seg, i) => p.segments[i] === seg);
}

const WRITE_TOOLS = new Set(["write_file", "apply_patch"]);

/**
 * Mini Me answers an approval itself only for a file write or patch whose
 * target is inside the project it just created. The target must be known:
 * `args.path` must be a string that the server's preview names too.
 */
export function shouldAutoApprove(event: AgentEvent, root: string): boolean {
  if (event.type !== "pending_approval") return false;
  if (!WRITE_TOOLS.has(event.tool) || event.browser) return false;
  const target = event.args?.path;
  if (typeof target !== "string" || !event.preview || event.preview.path !== target) return false;
  return isInsideRoot(target, root);
}

export interface ProgressLabel {
  key: string;
  params?: Record<string, string>;
}

const LOOKING_TOOLS = new Set(["list_files", "read_file", "search_files", "search_codebase", "git_status", "git_diff", "git_log"]);
const LOOKUP_TOOLS = new Set(["web_search", "fetch_url"]);
const GIT_CHANGE_TOOLS = new Set(["git_commit", "git_branch", "git_checkout"]);
const COMMAND_MAX = 40;

function baseName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function shorten(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
}

/** The i18n key (and values) for the line shown while a tool runs; null for non-tool events. */
export function progressLabel(event: AgentEvent): ProgressLabel | null {
  if (event.type !== "tool_call") return null;
  const { tool, args } = event;
  if (tool === "write_file" || tool === "apply_patch") {
    const file = typeof args?.path === "string" ? baseName(args.path) : "";
    if (!file) return { key: "companion.build.step.writingSomething" };
    return { key: tool === "write_file" ? "companion.build.step.writing" : "companion.build.step.editing", params: { file } };
  }
  if (tool === "run_command") {
    const command = typeof args?.command === "string" ? shorten(args.command, COMMAND_MAX) : "";
    return command ? { key: "companion.build.step.running", params: { command } } : { key: "companion.build.step.working" };
  }
  if (LOOKING_TOOLS.has(tool)) return { key: "companion.build.step.looking" };
  if (LOOKUP_TOOLS.has(tool)) return { key: "companion.build.step.lookingUp" };
  if (GIT_CHANGE_TOOLS.has(tool)) return { key: "companion.build.step.git" };
  if (tool === "remember") return { key: "companion.build.step.noting" };
  return { key: "companion.build.step.working" };
}

export type ApprovalKind = "command" | "fetch" | "git" | "memory" | "mcp" | "write" | "other";

/** What an approval the user must answer is about, for the bubble's card. */
export function approvalSummary(event: Extract<AgentEvent, { type: "pending_approval" }>): { kind: ApprovalKind; detail: string } {
  const { tool, args, preview } = event;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (tool === "run_command") return { kind: "command", detail: str(args?.command) };
  if (tool === "fetch_url") {
    const fromPreview = preview?.path.startsWith("fetch:") ? preview.path.slice(6) : "";
    let host = fromPreview;
    if (!host) {
      try {
        host = new URL(str(args?.url)).hostname;
      } catch {
        host = str(args?.url);
      }
    }
    return { kind: "fetch", detail: host };
  }
  if (tool.startsWith("git_")) {
    const what = str(args?.message) || str(args?.target) || str(args?.name);
    const verb = `git ${tool.slice(4)}`;
    return { kind: "git", detail: what ? `${verb}: ${what}` : verb };
  }
  if (tool === "remember") return { kind: "memory", detail: str(args?.content) };
  if (preview?.path.startsWith("mcp:")) return { kind: "mcp", detail: preview.path.slice(4) };
  if (WRITE_TOOLS.has(tool)) return { kind: "write", detail: str(args?.path) || preview?.path || "" };
  return { kind: "other", detail: tool };
}

const LOOPBACK_HOST = /^(localhost|[a-z0-9-]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** The local address after the Agent's "Live URL:" marker, or null. Only http(s) on this machine. */
export function extractLiveUrl(text: string): string | null {
  const m = /Live URL:[\s*_`<]*(https?:\/\/[^\s<>"'`)\]]+)/i.exec(text ?? "");
  if (!m) return null;
  const raw = m[1].replace(/[.,;:!?*_]+$/, "");
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!LOOPBACK_HOST.test(url.hostname)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** The Agent's closing message as plain text for the bubble (no markdown marks). */
export function plainSummary(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*|__/g, "")
    .replace(/`/g, "")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
