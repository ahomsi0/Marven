import type { ApprovalScope } from "@/types";

export interface ScopedAnswer {
  accept: boolean;
  scope: ApprovalScope;
}

type Resolver = (answer: ScopedAnswer) => void;

interface Pending {
  resolve: Resolver;
  timer: ReturnType<typeof setTimeout>;
}

// Store on globalThis so the same Map is shared even if Next.js re-imports
// this module (HMR, multiple route bundles, etc.). Without this the stream
// route and the approve route can end up with separate Map instances, causing
// hasPending() to always return false and silently dropping approvals.
const g = globalThis as typeof globalThis & { __marvenPending?: Map<string, Pending> };
if (!g.__marvenPending) g.__marvenPending = new Map();
const pending = g.__marvenPending;

/**
 * An approval that also says how far it reaches: "once", or "site" (this
 * site for the rest of the run, for browser actions). Rejected on timeout.
 */
export function registerScopedApproval(callId: string, timeoutMs: number): Promise<ScopedAnswer> {
  return new Promise((resolve) => {
    // Clean up any prior registration for this callId
    const existing = pending.get(callId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve({ accept: false, scope: "once" });
      pending.delete(callId);
    }
    const timer = setTimeout(() => {
      if (pending.has(callId)) {
        pending.delete(callId);
        resolve({ accept: false, scope: "once" });
      }
    }, timeoutMs);
    pending.set(callId, { resolve, timer });
  });
}

export function registerApproval(callId: string, timeoutMs: number): Promise<boolean> {
  return registerScopedApproval(callId, timeoutMs).then((answer) => answer.accept);
}

export function resolveApproval(callId: string, accept: boolean, scope: ApprovalScope = "once"): boolean {
  const entry = pending.get(callId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(callId);
  entry.resolve({ accept, scope });
  return true;
}

export function hasPending(callId: string): boolean {
  return pending.has(callId);
}
