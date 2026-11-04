import { createElement, Fragment, type ReactNode } from "react";

// Page-derived text (a host, an element's name) dropped into a translated
// sentence can reorder the words around it when its direction differs from
// the sentence's, most visibly an Arabic page name in an English line or the
// reverse. These helpers keep the translated strings as they are and wrap just
// the inserted value in <bdi>: translate with `marked(values)` (placeholders
// that survive nesting into other strings), then `isolate` the result.

const OPEN = "";
const CLOSE = "";

/** Interpolation values that stand in for `values` until `isolate` fills them in. */
export function marked<K extends string>(values: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(values) as K[]) out[key] = `${OPEN}${key}${CLOSE}`;
  return out;
}

/**
 * The translated text with each placeholder replaced by its value in a <bdi>.
 * React renders the values as plain text, and only placeholders `marked`
 * produced are replaced: page text can't forge one, it never reaches the
 * sentence until here.
 */
export function isolate(text: string, values: Record<string, string>): ReactNode {
  const parts = text.split(new RegExp(`${OPEN}(\\w+)${CLOSE}`));
  return parts.map((part, i) =>
    i % 2 === 0 ? createElement(Fragment, { key: i }, part) : createElement("bdi", { key: i }, values[part] ?? ""),
  );
}
