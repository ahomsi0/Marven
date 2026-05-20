type Resolver = (accept: boolean) => void;

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

export function registerApproval(callId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Clean up any prior registration for this callId
    const existing = pending.get(callId);
    if (existing) {
      clearTimeout(existing.timer);
      existing.resolve(false);
      pending.delete(callId);
    }
    const timer = setTimeout(() => {
      if (pending.has(callId)) {
        pending.delete(callId);
        resolve(false);
      }
    }, timeoutMs);
    pending.set(callId, { resolve, timer });
  });
}

export function resolveApproval(callId: string, accept: boolean): boolean {
  const entry = pending.get(callId);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(callId);
  entry.resolve(accept);
  return true;
}

export function hasPending(callId: string): boolean {
  return pending.has(callId);
}
