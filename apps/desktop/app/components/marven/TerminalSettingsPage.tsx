"use client";

// Settings → Terminal. Theme gallery, font and cursor controls, and a static
// preview drawn with the selected theme's ANSI colors. Every change saves at
// once and reaches open terminals through terminalSettings' change event.

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { Dropdown } from "./Dropdown";
import { useTheme } from "@/lib/theme";
import {
  MATCH_APP,
  TERMINAL_PRESETS,
  marvenThemeFor,
  resolveTerminalTheme,
  type TerminalColors,
} from "@/lib/terminal/themes";
import {
  CURSOR_STYLES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  resetTerminalSettings,
  setTerminalSettings,
  terminalFontStack,
  useTerminalSettings,
  type TerminalCursorStyle,
  type TerminalSettings,
} from "@/lib/terminal/terminalSettings";

const FONT_CHOICES = ["JetBrains Mono", "Fira Code", "Cascadia Code", "Source Code Pro"] as const;
const CUSTOM = "__custom__";

// Literal keys (as const) so the typed t() from lib/i18n accepts them.
const CURSOR_LABEL_KEY = {
  block: "settings.terminal.cursorBlock",
  bar: "settings.terminal.cursorBar",
  underline: "settings.terminal.cursorUnderline",
} as const satisfies Record<TerminalCursorStyle, string>;

function Cursor({ colors, style }: { colors: TerminalColors; style: TerminalCursorStyle }) {
  if (style === "bar") {
    return <span style={{ display: "inline-block", width: 2, height: "1.1em", verticalAlign: "text-bottom", background: colors.cursor }} />;
  }
  if (style === "underline") {
    return <span style={{ display: "inline-block", width: "0.6em", borderBottom: `2px solid ${colors.cursor}` }}>&nbsp;</span>;
  }
  return <span style={{ background: colors.cursor, color: colors.cursorAccent }}>&nbsp;</span>;
}

/** Full preview: prompt, ls, an error and a warning in the theme's ANSI colors. */
function TerminalSample({ colors, settings }: { colors: TerminalColors; settings: TerminalSettings }) {
  return (
    <div
      dir="ltr"
      aria-hidden
      className="overflow-hidden rounded-lg border border-[var(--m-border-subtle)] px-3.5 py-3"
      style={{
        background: colors.background,
        color: colors.foreground,
        fontFamily: terminalFontStack(settings.fontFamily),
        fontSize: settings.fontSize,
        // xterm's cells are a little taller than CSS line boxes at the same value; +0.2 keeps the preview's spacing close to the real terminal.
        lineHeight: settings.lineHeight + 0.2,
        whiteSpace: "pre",
      }}
    >
      <div>
        <span style={{ color: colors.green }}>~/marven</span> <span style={{ color: colors.magenta }}>git:(main)</span> $ ls
      </div>
      <div>
        <span style={{ color: colors.blue }}>app</span>  <span style={{ color: colors.blue }}>lib</span>  <span style={{ color: colors.cyan }}>scripts</span>  package.json  <span style={{ color: colors.brightBlack }}>.env.local</span>
      </div>
      <div>
        <span style={{ color: colors.red }}>✗ 1 test failed</span>  <span style={{ color: colors.yellow }}>⚠ 2 warnings</span>
      </div>
      <div>
        <span style={{ color: colors.green }}>~/marven</span> $ <Cursor colors={colors} style={settings.cursorStyle} />
      </div>
    </div>
  );
}

/** Small swatch for a theme card. */
function MiniSample({ colors }: { colors: TerminalColors }) {
  return (
    <div
      dir="ltr"
      aria-hidden
      className="h-[58px] px-2.5 py-2 font-mono text-[11px] leading-[1.5]"
      style={{ background: colors.background, color: colors.foreground, whiteSpace: "pre" }}
    >
      <div><span style={{ color: colors.green }}>~</span> $ ls</div>
      <div>
        <span style={{ color: colors.blue }}>src</span> <span style={{ color: colors.magenta }}>pkg</span> <span style={{ color: colors.red }}>err</span> <span style={{ color: colors.yellow }}>warn</span>
      </div>
    </div>
  );
}

export function TerminalSettingsPage() {
  const { t } = useT();
  const { theme: appTheme } = useTheme();
  const settings = useTerminalSettings();
  const colors = resolveTerminalTheme(settings.theme, appTheme).colors;

  const isPresetFont = settings.fontFamily === "" || (FONT_CHOICES as readonly string[]).includes(settings.fontFamily);
  const [customOpen, setCustomOpen] = useState(!isPresetFont);
  const [customDraft, setCustomDraft] = useState(isPresetFont ? "" : settings.fontFamily);

  const customInputRef = useRef<HTMLInputElement>(null);

  // The stored font changed (e.g. from another window): bring the menu in step,
  // unless the user is typing in the custom field right now.
  useEffect(() => {
    if (document.activeElement === customInputRef.current) return;
    const preset = settings.fontFamily === "" || (FONT_CHOICES as readonly string[]).includes(settings.fontFamily);
    setCustomOpen(!preset);
    setCustomDraft(preset ? "" : settings.fontFamily);
  }, [settings.fontFamily]);

  const fontSelectValue = customOpen ? CUSTOM : settings.fontFamily;

  const cards: Array<{ id: string; name: string; colors: TerminalColors }> = [
    { id: MATCH_APP, name: t("settings.terminal.matchApp"), colors: marvenThemeFor(appTheme).colors },
    ...TERMINAL_PRESETS.map((p) => ({ id: p.id, name: p.name, colors: p.colors })),
  ];

  const commitCustomFont = () => {
    const name = customDraft.trim();
    if (!name) setCustomOpen(false);
    if (name !== settings.fontFamily) setTerminalSettings({ fontFamily: name });
  };

  return (
    <div className="space-y-6">
      {/* Preview */}
      <section>
        <p className="mb-2 text-[12px] font-medium text-[var(--m-text-muted)]">{t("settings.terminal.preview")}</p>
        <TerminalSample colors={colors} settings={settings} />
      </section>

      {/* Theme gallery */}
      <section>
        <p className="mb-2 text-[12px] font-medium text-[var(--m-text-muted)]">{t("settings.terminal.theme")}</p>
        <div role="radiogroup" aria-label={t("settings.terminal.theme")} className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5">
          {cards.map((card) => {
            const selected = settings.theme === card.id;
            return (
              <button
                key={card.id}
                type="button"
                role="radio"
                aria-label={card.name}
                aria-checked={selected}
                onClick={() => setTerminalSettings({ theme: card.id })}
                className={`overflow-hidden rounded-lg text-start transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--m-text-muted)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--m-bg)] ${
                  selected
                    ? "ring-2 ring-[var(--m-accent)]"
                    : "ring-1 ring-[var(--m-border-subtle)] hover:ring-[var(--m-border)]"
                }`}
              >
                <MiniSample colors={card.colors} />
                <div className="truncate border-t border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-2.5 py-1.5 text-[12px] text-[var(--m-text-muted)]">
                  {card.name}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Font and cursor */}
      <section className="space-y-3">
        <p className="text-[12px] font-medium text-[var(--m-text-muted)]">{t("settings.terminal.fontAndCursor")}</p>

        <div className="flex items-start gap-3">
          <label id="terminal-font-label" htmlFor="terminal-font" className="w-28 shrink-0 pt-1.5 text-[13px] text-[var(--m-text-muted)]">
            {t("settings.terminal.font")}
          </label>
          <div className="min-w-0 flex-1 space-y-2">
            <Dropdown
              id="terminal-font"
              aria-labelledby="terminal-font-label"
              value={fontSelectValue}
              onChange={(v) => {
                if (v === CUSTOM) {
                  setCustomDraft(settings.fontFamily);
                  setCustomOpen(true);
                  requestAnimationFrame(() => customInputRef.current?.focus());
                  return;
                }
                setCustomOpen(false);
                setTerminalSettings({ fontFamily: v });
              }}
              options={[
                { value: "", label: t("settings.terminal.fontDefault") },
                ...FONT_CHOICES.map((f) => ({ value: f, label: f })),
                { value: CUSTOM, label: t("settings.terminal.fontCustom") },
              ]}
              className="w-full"
            />
            {customOpen && (
              <div>
                <input
                  ref={customInputRef}
                  dir="ltr"
                  type="text"
                  value={customDraft}
                  onChange={(e) => setCustomDraft(e.target.value)}
                  onBlur={commitCustomFont}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitCustomFont();
                  }}
                  placeholder={t("settings.terminal.fontCustomPlaceholder")}
                  className="w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-2.5 py-1.5 font-mono text-[13px] text-[var(--m-text)] outline-none focus:border-[var(--m-accent)]/50"
                />
                <p className="mt-1 text-[11px] text-[var(--m-text-faint)]">{t("settings.terminal.fontCustomHint")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="terminal-size" className="w-28 shrink-0 text-[13px] text-[var(--m-text-muted)]">
            {t("settings.terminal.size")}
          </label>
          <input
            id="terminal-size"
            type="range"
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={settings.fontSize}
            onChange={(e) => setTerminalSettings({ fontSize: Number(e.target.value) })}
            className="flex-1 accent-[var(--m-accent)]"
          />
          <span className="w-12 text-end font-mono text-[12px] text-[var(--m-text)]">{settings.fontSize}px</span>
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="terminal-line-height" className="w-28 shrink-0 text-[13px] text-[var(--m-text-muted)]">
            {t("settings.terminal.lineHeight")}
          </label>
          <input
            id="terminal-line-height"
            type="range"
            min={LINE_HEIGHT_MIN}
            max={LINE_HEIGHT_MAX}
            step={0.1}
            value={settings.lineHeight}
            onChange={(e) => setTerminalSettings({ lineHeight: Number(e.target.value) })}
            className="flex-1 accent-[var(--m-accent)]"
          />
          <span className="w-12 text-end font-mono text-[12px] text-[var(--m-text)]">{settings.lineHeight.toFixed(1)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="w-28 shrink-0 text-[13px] text-[var(--m-text-muted)]">{t("settings.terminal.cursor")}</span>
          <div role="radiogroup" aria-label={t("settings.terminal.cursor")} className="flex rounded-md border border-[var(--m-border)] p-0.5">
            {CURSOR_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                role="radio"
                aria-checked={settings.cursorStyle === style}
                onClick={() => setTerminalSettings({ cursorStyle: style })}
                className={`rounded px-3 py-1 text-[12px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--m-accent)] ${
                  settings.cursorStyle === style
                    ? "bg-[var(--m-surface-3)] text-[var(--m-text)]"
                    : "text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
                }`}
              >
                {t(CURSOR_LABEL_KEY[style])}
              </button>
            ))}
          </div>
          <label className="ms-2 flex items-center gap-2 text-[13px] text-[var(--m-text-muted)]">
            <input
              type="checkbox"
              checked={settings.cursorBlink}
              onChange={(e) => setTerminalSettings({ cursorBlink: e.target.checked })}
              className="accent-[var(--m-accent)]"
            />
            {t("settings.terminal.blink")}
          </label>
        </div>
      </section>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            resetTerminalSettings();
            setCustomOpen(false);
            setCustomDraft("");
          }}
          className="rounded-md border border-[var(--m-border)] px-3 py-1.5 text-[12px] text-[var(--m-text-muted)] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--m-accent)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
        >
          {t("settings.terminal.reset")}
        </button>
      </div>
    </div>
  );
}
