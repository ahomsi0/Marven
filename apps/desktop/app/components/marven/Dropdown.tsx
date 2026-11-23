"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  appendTypeahead,
  computeMenuPlacement,
  initialActiveIndex,
  isTypeaheadKey,
  listboxKeyCommand,
  triggerOpenIntent,
  typeaheadIndex,
  TYPEAHEAD_TIMEOUT_MS,
  type MenuPlacement,
  type TypeaheadState,
} from "./dropdownLogic";

export interface DropdownOption<V extends string = string> {
  value: V;
  label: string;
  /** A second, fainter line under the label. */
  description?: string;
  disabled?: boolean;
  /** Tooltip for the option (e.g. a full path when the label is shortened). */
  title?: string;
  /** Extra classes for the label, e.g. a colour. Also used on the trigger when selected. */
  className?: string;
}

export interface DropdownProps<V extends string = string> {
  value: V;
  onChange: (value: V) => void;
  options: readonly DropdownOption<V>[];
  /** Put on the trigger button, so an existing `<label htmlFor>` keeps working. */
  id?: string;
  "aria-label"?: string;
  /** Id(s) of the visible label. The trigger's current value is read after it. */
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  disabled?: boolean;
  /** `sm` for dense rows and toolbars, `md` (default) for settings fields. */
  size?: "sm" | "md";
  /** Shown when `value` matches no option. */
  placeholder?: string;
  /** Layout classes for the trigger (width, margin, flex). */
  className?: string;
  title?: string;
}

const SIZES = {
  sm: {
    trigger: "gap-1.5 rounded-md px-2 py-1 text-[11px]",
    option: "px-2 py-1 text-[11px]",
    chevron: "h-3 w-3",
  },
  md: {
    trigger: "gap-2 rounded-md px-3 py-1.5 text-[12px]",
    option: "px-2.5 py-1.5 text-[12px]",
    chevron: "h-3.5 w-3.5",
  },
} as const;

/**
 * Marven's replacement for a native `<select>`: a button that opens a
 * listbox. The menu is rendered in a portal with fixed positioning so a
 * scrolling settings pane can't clip it, and it flips above the trigger or
 * shrinks when there isn't room below.
 */
export function Dropdown<V extends string = string>({
  value,
  onChange,
  options,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-describedby": ariaDescribedby,
  disabled = false,
  size = "md",
  placeholder,
  className = "",
  title,
}: DropdownProps<V>) {
  const autoId = useId();
  const buttonId = id ?? `dropdown-${autoId}`;
  const listId = `${buttonId}-list`;
  const optionId = (i: number) => `${buttonId}-opt-${i}`;
  const sz = SIZES[size];

  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const naturalSize = useRef<{ width: number; height: number } | null>(null);
  const typeahead = useRef<TypeaheadState>({ query: "", at: 0 });

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [placement, setPlacement] = useState<MenuPlacement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openMenu = useCallback(
    (intent: "selected" | "first" | "last", typed?: string) => {
      if (disabled || options.length === 0) return;
      let start = initialActiveIndex(options, selectedIndex, intent);
      typeahead.current = { query: "", at: 0 };
      if (typed) {
        typeahead.current = appendTypeahead(typeahead.current, typed, Date.now());
        const hit = typeaheadIndex(options, typeahead.current.query, selectedIndex);
        if (hit >= 0) start = hit;
      }
      naturalSize.current = null;
      setPlacement(null);
      setActive(start);
      setOpen(true);
    },
    [disabled, options, selectedIndex],
  );

  const closeMenu = useCallback((refocus: boolean) => {
    setOpen(false);
    setPlacement(null);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  const choose = useCallback(
    (index: number) => {
      const o = options[index];
      if (!o || o.disabled) return;
      closeMenu(true);
      if (o.value !== value) onChange(o.value);
    },
    [options, value, onChange, closeMenu],
  );

  // Measure the menu at its natural size, then place it next to the trigger.
  const place = useCallback(() => {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    if (!naturalSize.current) {
      const r = menu.getBoundingClientRect();
      naturalSize.current = { width: Math.ceil(r.width), height: Math.ceil(r.height) };
    }
    const a = button.getBoundingClientRect();
    setPlacement(
      computeMenuPlacement({
        anchor: { top: a.top, left: a.left, right: a.right, bottom: a.bottom, width: a.width },
        menu: naturalSize.current,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        rtl: getComputedStyle(button).direction === "rtl",
      }),
    );
  }, []);

  useLayoutEffect(() => {
    if (open && !placement) place();
  }, [open, placement, place]);

  // Once placed, move focus into the listbox so it receives the keys.
  useEffect(() => {
    if (open && placement && document.activeElement !== listRef.current) {
      listRef.current?.focus({ preventScroll: true });
    }
  }, [open, placement]);

  // Keep the active option in view.
  useEffect(() => {
    if (!open || !placement || active < 0) return;
    document.getElementById(`${buttonId}-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, placement, active, buttonId]);

  // Follow the trigger on scroll/resize; close on outside clicks and app blur.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      closeMenu(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      place();
    };
    const onBlur = () => closeMenu(false);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, place, closeMenu]);

  const onTriggerKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open || disabled) return;
    const intent = triggerOpenIntent(e.key);
    if (intent) {
      e.preventDefault();
      openMenu(intent);
      return;
    }
    if (isTypeaheadKey(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey })) {
      e.preventDefault();
      openMenu("selected", e.key);
    }
  };

  const onListKeyDown = (e: ReactKeyboardEvent<HTMLUListElement>) => {
    if (isTypeaheadKey(e.key, { ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey })) {
      e.preventDefault();
      typeahead.current = appendTypeahead(typeahead.current, e.key, Date.now());
      const hit = typeaheadIndex(options, typeahead.current.query, active);
      if (hit >= 0) setActive(hit);
      return;
    }
    const typing =
      typeahead.current.query.length > 0 && Date.now() - typeahead.current.at <= TYPEAHEAD_TIMEOUT_MS;
    if (e.key === " " && typing) {
      e.preventDefault();
      typeahead.current = appendTypeahead(typeahead.current, " ", Date.now());
      const hit = typeaheadIndex(options, typeahead.current.query, active);
      if (hit >= 0) setActive(hit);
      return;
    }
    const cmd = listboxKeyCommand(options, active, e.key, { typing });
    switch (cmd.type) {
      case "move":
        e.preventDefault();
        if (cmd.index >= 0) setActive(cmd.index);
        break;
      case "select":
        e.preventDefault();
        e.stopPropagation();
        choose(cmd.index);
        break;
      case "close":
        // Keep Escape from also closing the modal or panel around us.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        closeMenu(true);
        break;
      case "tab":
        // Hand focus back to the trigger and let Tab carry on from there.
        closeMenu(true);
        break;
    }
  };

  const menu =
    open && mounted
      ? createPortal(
          <div
            ref={menuRef}
            className="fixed z-[1000] flex flex-col overflow-hidden rounded-lg border border-[var(--m-border)] bg-[var(--m-surface-2)] shadow-2xl"
            style={
              placement
                ? { top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }
                : {
                    // Measuring pass: natural size, invisible.
                    top: 0,
                    left: 0,
                    visibility: "hidden",
                    width: "max-content",
                    minWidth: buttonRef.current?.offsetWidth,
                    maxWidth: "calc(100vw - 16px)",
                  }
            }
          >
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabelledby ? undefined : ariaLabel}
              aria-labelledby={ariaLabelledby ?? (ariaLabel ? undefined : buttonId)}
              aria-activedescendant={active >= 0 ? optionId(active) : undefined}
              onKeyDown={onListKeyDown}
              className="min-h-0 flex-1 overflow-y-auto p-1 outline-none"
            >
              {options.map((o, i) => {
                const isSelected = i === selectedIndex;
                const isActive = i === active;
                return (
                  <li
                    key={o.value}
                    id={optionId(i)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled || undefined}
                    title={o.title}
                    onMouseMove={() => {
                      if (!o.disabled && active !== i) setActive(i);
                    }}
                    // Keep focus in the listbox while clicking.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(i)}
                    className={`flex select-none items-start gap-2 rounded-md ${sz.option} ${
                      o.disabled
                        ? "cursor-not-allowed opacity-40"
                        : isActive
                          ? "cursor-pointer bg-[var(--m-surface-3)]"
                          : "cursor-pointer"
                    }`}
                  >
                    <span className="min-w-0 flex-1 text-start">
                      <span
                        className={`block truncate ${
                          o.className ?? (isSelected || isActive ? "text-[var(--m-text)]" : "text-[var(--m-text-muted)]")
                        } ${isSelected ? "font-medium" : ""}`}
                      >
                        {o.label}
                      </span>
                      {o.description && (
                        <span className="mt-0.5 block text-[0.92em] leading-snug text-[var(--m-text-faint)]">
                          {o.description}
                        </span>
                      )}
                    </span>
                    <CheckIcon className={`mt-[0.15em] h-3.5 w-3.5 shrink-0 text-[var(--m-accent)] ${isSelected ? "" : "invisible"}`} />
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        disabled={disabled}
        title={title ?? selected?.title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabelledby ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledby ? `${ariaLabelledby} ${buttonId}` : undefined}
        aria-describedby={ariaDescribedby}
        onClick={() => (open ? closeMenu(true) : openMenu("selected"))}
        onKeyDown={onTriggerKeyDown}
        className={`flex min-w-0 items-center border bg-[var(--m-surface-2)] text-start outline-none transition-colors ${sz.trigger} ${
          open
            ? "border-[var(--m-accent)]/60"
            : "border-[var(--m-border)] hover:border-[var(--m-text-faint)] focus-visible:border-[var(--m-accent)]/60"
        } focus-visible:ring-2 focus-visible:ring-[var(--m-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      >
        <span
          className={`min-w-0 flex-1 truncate ${
            selected ? (selected.className ?? "text-[var(--m-text)]") : "text-[var(--m-text-faint)]"
          }`}
        >
          {selected?.label ?? placeholder ?? " "}
        </span>
        <ChevronIcon
          className={`${sz.chevron} shrink-0 text-[var(--m-text-faint)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {menu}
    </>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
      <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
