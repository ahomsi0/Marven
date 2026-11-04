// lib/agent/browserBridge.ts
//
// Browser tool calls in flight. The loop registers a call and emits a
// browser_action event; the renderer runs it in the main process and POSTs
// the result to /api/agent/browser-result, which resolves it here. Kept on
// globalThis for the same reason as approvals.ts: the stream route and the
// result route must share one Map even when Next.js re-imports this module.

import type { BrowserActionKind, BrowserApprovalPreview, BrowserResult, ImageAttachment } from "@/types";

interface PendingCall {
  runId: string;
  resolve: (result: BrowserResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const g = globalThis as typeof globalThis & { __marvenBrowserCalls?: Map<string, PendingCall> };
if (!g.__marvenBrowserCalls) g.__marvenBrowserCalls = new Map();
const calls = g.__marvenBrowserCalls;

/** A backstop only: the main process enforces the real per-action limits, and a paused run may wait long. */
export const BROWSER_CALL_TIMEOUT_MS = 30 * 60_000;

export function registerBrowserCall(callId: string, runId: string, timeoutMs = BROWSER_CALL_TIMEOUT_MS): Promise<BrowserResult> {
  return new Promise((resolve) => {
    const existing = calls.get(callId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve({ kind: "error", text: "Replaced by a newer call." });
    }
    const timer = setTimeout(() => {
      if (calls.get(callId)?.resolve === resolve) {
        calls.delete(callId);
        resolve({ kind: "error", text: "The browser didn't answer in time." });
      }
    }, timeoutMs);
    calls.set(callId, { runId, resolve, timer });
  });
}

export function resolveBrowserCall(callId: string, result: BrowserResult): boolean {
  const entry = calls.get(callId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  calls.delete(callId);
  entry.resolve(result);
  return true;
}

export function hasBrowserCall(callId: string): boolean {
  return calls.has(callId);
}

/** Ends every call of a run (Stop, or the stream's consumer went away). */
export function cancelBrowserCalls(runId: string): void {
  for (const [callId, entry] of calls) {
    if (entry.runId !== runId) continue;
    clearTimeout(entry.timer);
    calls.delete(callId);
    entry.resolve({ kind: "error", text: "Stopped." });
  }
}

// ── Checking what the renderer sent back ────────────────────────────────────

const MAX_TEXT = 20_000;
const MAX_ERROR = 2_000;
const MAX_LABEL = 80;
const MAX_FIELDS = 30;
const MAX_IMAGE = 5_000_000;
const ACTION_KINDS = new Set<BrowserActionKind>(["open", "history", "read", "screenshot", "tabs", "wait", "scroll", "click", "type", "press", "select"]);
const IMAGE_PREFIX: Record<string, ImageAttachment["mimeType"]> = {
  "data:image/jpeg;base64,": "image/jpeg",
  "data:image/png;base64,": "image/png",
};

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanImage(raw: unknown): ImageAttachment | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const base64 = (raw as { base64?: unknown }).base64;
  if (typeof base64 !== "string" || base64.length > MAX_IMAGE) return undefined;
  const prefix = Object.keys(IMAGE_PREFIX).find((p) => base64.startsWith(p));
  if (!prefix || !/^[A-Za-z0-9+/=]*$/.test(base64.slice(prefix.length))) return undefined;
  const mimeType = IMAGE_PREFIX[prefix];
  return { base64, mimeType, name: mimeType === "image/png" ? "screenshot.png" : "screenshot.jpg" };
}

function cleanApproval(raw: unknown): BrowserApprovalPreview | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.kind !== "site" && a.kind !== "submit") return null;
  const host = str(a.host, 253);
  if (!host || !ACTION_KINDS.has(a.action as BrowserActionKind)) return null;
  const approval: BrowserApprovalPreview = { kind: a.kind, host, action: a.action as BrowserActionKind, target: str(a.target, MAX_LABEL) };
  if (Array.isArray(a.fields)) {
    approval.fields = a.fields.slice(0, MAX_FIELDS).map((f) => ({
      name: str((f as Record<string, unknown>)?.name, MAX_LABEL),
      value: str((f as Record<string, unknown>)?.value, MAX_LABEL),
    }));
  }
  return approval;
}

/** The result as the loop may use it, or null if it isn't one. */
export function cleanBrowserResult(raw: unknown): BrowserResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "ok") {
    const image = cleanImage(r.image);
    return image ? { kind: "ok", text: str(r.text, MAX_TEXT), image } : { kind: "ok", text: str(r.text, MAX_TEXT) };
  }
  if (r.kind === "error") return { kind: "error", text: str(r.text, MAX_ERROR) };
  if (r.kind === "needs_approval") {
    const approval = cleanApproval(r.approval);
    return approval ? { kind: "needs_approval", approval } : null;
  }
  return null;
}
