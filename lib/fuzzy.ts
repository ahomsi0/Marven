// Fuzzy matching for the command palette (and anything else that filters a
// short list as you type). A query matches when its characters appear in the
// text in order — "nwtab" matches "New tab" — and the score rewards matches
// that start words, run consecutively, or sit near the front.

export interface FuzzyMatch {
  score: number;
  /** Indices into `text` of each matched character, ascending. */
  indices: number[];
}

const BONUS_FIRST_CHAR = 10;
const BONUS_WORD_START = 8;
const BONUS_CAMEL = 6;
const BONUS_CONSECUTIVE = 6;
const PENALTY_GAP = 1;
const PENALTY_LEADING = 0.5;
const MAX_LEADING_PENALTY = 6;

const SEPARATOR = /[\s\-_./\\:·•,(]/;

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true;
  return SEPARATOR.test(text[i - 1]);
}

function isCamelStart(text: string, i: number): boolean {
  if (i === 0) return false;
  const prev = text[i - 1];
  const cur = text[i];
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur !== cur.toLowerCase();
}

function charBonus(text: string, i: number): number {
  if (i === 0) return BONUS_FIRST_CHAR;
  if (isWordStart(text, i)) return BONUS_WORD_START;
  if (isCamelStart(text, i)) return BONUS_CAMEL;
  return 0;
}

/**
 * Match `query` against `text` as a case-insensitive subsequence. Whitespace in
 * the query is ignored. Returns null when it doesn't match; an empty query
 * matches everything with score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const n = t.length;
  const m = q.length;
  if (m > n) return null;

  // Quick reject: is it a subsequence at all?
  for (let i = 0, j = 0; ; i++) {
    if (j === m) break;
    if (i === n) return null;
    if (t[i] === q[j]) j++;
  }

  // dp[j][i]: best score with q[j] matched at t[i]; prev[j][i]: where q[j-1] matched.
  const NEG = -Infinity;
  const dp: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(NEG));
  const prev: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(-1));

  for (let i = 0; i < n; i++) {
    if (t[i] !== q[0]) continue;
    dp[0][i] = 1 + charBonus(text, i) - Math.min(i * PENALTY_LEADING, MAX_LEADING_PENALTY);
  }

  for (let j = 1; j < m; j++) {
    for (let i = j; i < n; i++) {
      if (t[i] !== q[j]) continue;
      const own = 1 + charBonus(text, i);
      let best = NEG;
      let bestK = -1;
      for (let k = j - 1; k < i; k++) {
        const before = dp[j - 1][k];
        if (before === NEG) continue;
        const link = k === i - 1 ? BONUS_CONSECUTIVE : -PENALTY_GAP * Math.min(i - k - 1, 10);
        const s = before + link;
        if (s > best) {
          best = s;
          bestK = k;
        }
      }
      if (bestK === -1) continue;
      dp[j][i] = best + own;
      prev[j][i] = bestK;
    }
  }

  let end = -1;
  let score = NEG;
  for (let i = 0; i < n; i++) {
    if (dp[m - 1][i] > score) {
      score = dp[m - 1][i];
      end = i;
    }
  }
  if (end === -1) return null;

  const indices = new Array<number>(m);
  for (let j = m - 1, i = end; j >= 0; j--) {
    indices[j] = i;
    i = prev[j][i];
  }
  // Slight preference for shorter texts when everything else is equal.
  return { score: score - n * 0.01, indices };
}

export interface RankedItem<T> {
  item: T;
  match: FuzzyMatch;
}

/**
 * Filter and sort `items` by how well `query` matches `getText(item)`. Items
 * that only match one of their `getKeywords` are kept below label matches and
 * carry no highlight indices. Ties keep the original order.
 */
export function fuzzyRank<T>(
  query: string,
  items: readonly T[],
  getText: (item: T) => string,
  getKeywords?: (item: T) => readonly string[] | undefined,
): RankedItem<T>[] {
  if (!query.trim()) return items.map((item) => ({ item, match: { score: 0, indices: [] } }));
  const ranked: (RankedItem<T> & { order: number })[] = [];
  items.forEach((item, order) => {
    const direct = fuzzyMatch(query, getText(item));
    if (direct) {
      ranked.push({ item, match: direct, order });
      return;
    }
    for (const kw of getKeywords?.(item) ?? []) {
      const viaKeyword = fuzzyMatch(query, kw);
      if (viaKeyword) {
        ranked.push({ item, match: { score: viaKeyword.score - 5, indices: [] }, order });
        return;
      }
    }
  });
  ranked.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
  return ranked.map(({ item, match }) => ({ item, match }));
}

/** Collapse sorted indices into [start, end) runs, for highlighting. */
export function matchRanges(indices: readonly number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const i of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}
