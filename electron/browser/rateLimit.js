// A sliding-window counter: at most `max` hits per `windowMs` for each key.
// Used to stop a hostile page from flooding the browser with downloads or
// popups. `take` also says when to log, so a burst is reported only once.

/**
 * @param {{ max: number, windowMs: number, now?: () => number }} options
 */
function createRateLimiter({ max, windowMs, now = Date.now }) {
  const keys = new Map(); // key → { hits: number[], warned: boolean }

  function sweep(t) {
    for (const [key, entry] of keys) {
      const last = entry.hits[entry.hits.length - 1];
      if (last === undefined || t - last >= windowMs) keys.delete(key);
    }
  }

  /** @returns {{ ok: boolean, warn: boolean }} */
  function take(key) {
    const t = now();
    sweep(t);
    const entry = keys.get(key) ?? { hits: [], warned: false };
    entry.hits = entry.hits.filter((at) => t - at < windowMs);
    keys.set(key, entry);
    if (entry.hits.length >= max) {
      const warn = !entry.warned;
      entry.warned = true;
      return { ok: false, warn };
    }
    entry.hits.push(t);
    entry.warned = false;
    return { ok: true, warn: false };
  }

  return { take, size: () => keys.size };
}

module.exports = { createRateLimiter };
