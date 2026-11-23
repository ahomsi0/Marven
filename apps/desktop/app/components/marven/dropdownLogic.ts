/**
 * Pure helpers behind <Dropdown>: keyboard navigation, type-ahead and menu
 * placement. Kept free of React and the DOM so they can be unit tested.
 */

export interface NavOption {
  label: string;
  disabled?: boolean;
}

/** Index of the first (or last) enabled option, or -1 when none is enabled. */
export function edgeIndex(options: readonly NavOption[], edge: "first" | "last"): number {
  if (edge === "first") {
    for (let i = 0; i < options.length; i++) if (!options[i].disabled) return i;
  } else {
    for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) return i;
  }
  return -1;
}

/**
 * The next enabled option from `from` in direction `step`, skipping disabled
 * ones. Like a native select it stops at the ends rather than wrapping. With
 * no current option (`from` < 0) it lands on the first or last enabled one.
 */
export function stepIndex(options: readonly NavOption[], from: number, step: 1 | -1): number {
  if (from < 0 || from >= options.length) return edgeIndex(options, step === 1 ? "first" : "last");
  for (let i = from + step; i >= 0 && i < options.length; i += step) {
    if (!options[i].disabled) return i;
  }
  return from;
}

/** Where the active option should start when the menu opens. */
export function initialActiveIndex(
  options: readonly NavOption[],
  selectedIndex: number,
  intent: "selected" | "first" | "last" = "selected",
): number {
  if (intent === "first") return edgeIndex(options, "first");
  if (intent === "last") return edgeIndex(options, "last");
  if (selectedIndex >= 0 && selectedIndex < options.length && !options[selectedIndex].disabled) return selectedIndex;
  return edgeIndex(options, "first");
}

/** How long type-ahead keeps collecting keystrokes into one query. */
export const TYPEAHEAD_TIMEOUT_MS = 500;

export interface TypeaheadState {
  query: string;
  at: number;
}

/** Adds a typed character to the type-ahead query, starting over after a pause. */
export function appendTypeahead(
  state: TypeaheadState,
  char: string,
  now: number,
  timeout = TYPEAHEAD_TIMEOUT_MS,
): TypeaheadState {
  const fresh = now - state.at > timeout;
  return { query: (fresh ? "" : state.query) + char.toLowerCase(), at: now };
}

/** True for a key that should feed type-ahead (one printable character). */
export function isTypeaheadKey(key: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}): boolean {
  return key.length === 1 && key !== " " && !mods.ctrl && !mods.meta && !mods.alt;
}

/**
 * The option a type-ahead query points at, or -1.
 *
 * Typing the same letter repeatedly ("b", "bb", "bbb") cycles through the
 * options that start with it, beginning after `from`. Any other query looks
 * for the first label starting with it, beginning at `from` itself so that
 * typing more of the current option's name keeps it.
 */
export function typeaheadIndex(options: readonly NavOption[], query: string, from: number): number {
  if (!query || options.length === 0) return -1;
  const q = query.toLowerCase();
  const repeated = q.length > 1 && [...q].every((c) => c === q[0]);
  const needle = repeated ? q[0] : q;
  const n = options.length;
  const start = from < 0 ? 0 : repeated || q.length === 1 ? from + 1 : from;
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    const o = options[i];
    if (!o.disabled && o.label.trim().toLowerCase().startsWith(needle)) return i;
  }
  return -1;
}

export type ListboxCommand =
  | { type: "move"; index: number }
  | { type: "select"; index: number }
  | { type: "close" }
  | { type: "tab" }
  | { type: "none" };

/** What a key press inside the open listbox does. Type-ahead is handled separately. */
export function listboxKeyCommand(
  options: readonly NavOption[],
  active: number,
  key: string,
  opts: { typing?: boolean; pageSize?: number } = {},
): ListboxCommand {
  const pageSize = opts.pageSize ?? 10;
  switch (key) {
    case "ArrowDown":
      return { type: "move", index: stepIndex(options, active, 1) };
    case "ArrowUp":
      return { type: "move", index: stepIndex(options, active, -1) };
    case "Home":
      return { type: "move", index: edgeIndex(options, "first") };
    case "End":
      return { type: "move", index: edgeIndex(options, "last") };
    case "PageDown": {
      let i = active;
      for (let k = 0; k < pageSize; k++) i = stepIndex(options, i, 1);
      return { type: "move", index: i };
    }
    case "PageUp": {
      let i = active;
      for (let k = 0; k < pageSize; k++) i = stepIndex(options, i, -1);
      return { type: "move", index: i };
    }
    case "Enter":
      return active >= 0 && !options[active]?.disabled ? { type: "select", index: active } : { type: "close" };
    case " ":
      // While a type-ahead query is in progress a space is part of it.
      if (opts.typing) return { type: "none" };
      return active >= 0 && !options[active]?.disabled ? { type: "select", index: active } : { type: "close" };
    case "Escape":
      return { type: "close" };
    case "Tab":
      return { type: "tab" };
    default:
      return { type: "none" };
  }
}

/** Which keys on the closed trigger button open the menu, and where it starts. */
export function triggerOpenIntent(key: string): "selected" | "first" | "last" | null {
  switch (key) {
    case "ArrowDown":
    case "Enter":
    case " ":
      return "selected";
    case "ArrowUp":
      return "selected";
    case "Home":
      return "first";
    case "End":
      return "last";
    default:
      return null;
  }
}

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
}

export interface MenuPlacement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  side: "below" | "above";
}

/**
 * Places the menu next to its trigger in viewport (position: fixed)
 * coordinates. It opens below unless there's more room above, its height is
 * capped to the room on that side, and it's shifted horizontally so it stays
 * inside the viewport. In RTL it lines up with the trigger's right edge.
 */
export function computeMenuPlacement(args: {
  anchor: Rect;
  /** The menu's natural size before any clamping. */
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  rtl?: boolean;
  /** Space kept clear of the viewport edges. */
  margin?: number;
  /** Space between the trigger and the menu. */
  gap?: number;
  /** Tallest the menu may get even when there's room. */
  maxHeight?: number;
}): MenuPlacement {
  const { anchor, menu, viewport, rtl = false, margin = 8, gap = 4, maxHeight = 320 } = args;

  const width = Math.max(0, Math.min(Math.max(menu.width, anchor.width), viewport.width - margin * 2));
  let left = rtl ? anchor.right - width : anchor.left;
  left = Math.min(left, viewport.width - margin - width);
  left = Math.max(left, margin);

  const wanted = Math.min(menu.height, maxHeight);
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin);
  const above = Math.max(0, anchor.top - gap - margin);
  const side: "below" | "above" = wanted <= below || below >= above ? "below" : "above";
  const room = Math.min(side === "below" ? below : above, maxHeight);
  const height = Math.min(wanted, room);
  const top = side === "below" ? anchor.bottom + gap : anchor.top - gap - height;

  return { top, left, width, maxHeight: room, side };
}
