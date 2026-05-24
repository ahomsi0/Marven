// lib/completion/telemetry.ts — session-only accept/dismiss counters for
// inline completions. No PII, no persistence across reloads.

export interface InlineCompletionStats {
  accepts: number;
  dismisses: number;
  /** Total characters inserted via accepts. */
  chars: number;
  /** accepts / (accepts + dismisses); 0 when no events yet. */
  rate: number;
}

const KEY = "marven:inline-completion-stats";

interface RawStats {
  accepts: number;
  dismisses: number;
  chars: number;
}

function getStore(): Storage | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

function readRaw(): RawStats {
  const store = getStore();
  if (!store) return { accepts: 0, dismisses: 0, chars: 0 };
  try {
    const raw = store.getItem(KEY);
    if (!raw) return { accepts: 0, dismisses: 0, chars: 0 };
    const parsed = JSON.parse(raw) as Partial<RawStats>;
    return {
      accepts: typeof parsed.accepts === "number" ? parsed.accepts : 0,
      dismisses: typeof parsed.dismisses === "number" ? parsed.dismisses : 0,
      chars: typeof parsed.chars === "number" ? parsed.chars : 0,
    };
  } catch {
    return { accepts: 0, dismisses: 0, chars: 0 };
  }
}

function writeRaw(r: RawStats): void {
  const store = getStore();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify(r));
  } catch {
    /* quota or disabled — silent */
  }
}

export function recordAccept(chars: number): void {
  const r = readRaw();
  r.accepts += 1;
  r.chars += Math.max(0, Math.floor(chars));
  writeRaw(r);
}

export function recordDismiss(): void {
  const r = readRaw();
  r.dismisses += 1;
  writeRaw(r);
}

export function readStats(): InlineCompletionStats {
  const r = readRaw();
  const total = r.accepts + r.dismisses;
  return {
    accepts: r.accepts,
    dismisses: r.dismisses,
    chars: r.chars,
    rate: total === 0 ? 0 : r.accepts / total,
  };
}

export function resetStats(): void {
  writeRaw({ accepts: 0, dismisses: 0, chars: 0 });
}
