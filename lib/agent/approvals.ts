type Resolver = (accept: boolean) => void;

interface Pending {
  resolve: Resolver;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Pending>();

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
