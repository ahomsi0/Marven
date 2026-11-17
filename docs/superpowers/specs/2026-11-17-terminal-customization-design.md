# Terminal customization — design

**Date:** 2026-11-17
**Status:** Approved in brainstorming, awaiting spec review

## Goal

Let people style Marven's terminal the way they style their own: pick a
well-known color scheme and set the font, size, line height and cursor.

## Today

`app/components/marven/TerminalView.tsx` maps the app theme to one of three
hardcoded xterm themes (Dark, Midnight, Aurora). Each sets only background,
foreground, cursor, cursor accent and selection; the 16 ANSI colors fall back
to xterm's defaults. Font (`ui-monospace, SFMono-Regular, Menlo, Monaco,
monospace`), size (12px) and cursor (blinking block) are fixed.

## Scope

In:
- Built-in theme presets with full 16-color ANSI palettes.
- A "Match app theme" option (the default) that keeps today's mapping, now with
  full ANSI palettes.
- Font family, font size, line height, cursor style and cursor blink.
- A Terminal page in Settings, and a command palette entry that opens it.

Out (not in this version):
- Importing downloaded theme files (.itermcolors, Windows Terminal JSON, etc.).
- A custom color editor or user-saved themes.
- Separate theme picks for light and dark app themes.

## Presets

`match-app` resolves to one of Marven's three themes based on the app theme:

| App theme | Terminal theme |
|---|---|
| dark | Marven Dark |
| midnight | Marven Midnight |
| aurora | Marven Aurora |
| light | Marven Dark (the terminal stays dark, as today) |

The three Marven themes keep today's background, foreground, cursor and
selection values and gain a full ANSI palette that fits each one.

Selectable presets (12), each with its published palette:

| id | Name | Kind |
|---|---|---|
| `one-dark` | One Dark | dark |
| `dracula` | Dracula | dark |
| `nord` | Nord | dark |
| `catppuccin-mocha` | Catppuccin Mocha | dark |
| `catppuccin-latte` | Catppuccin Latte | light |
| `gruvbox-dark` | Gruvbox Dark | dark |
| `tokyo-night` | Tokyo Night | dark |
| `solarized-dark` | Solarized Dark | dark |
| `solarized-light` | Solarized Light | light |
| `monokai` | Monokai | dark |
| `github-dark` | GitHub Dark | dark |
| `rose-pine` | Rosé Pine | dark |

## Units

### `lib/terminal/themes.ts`

Holds only preset data and theme resolution.

```ts
export interface TerminalThemePreset {
  id: string;
  name: string;            // proper noun, not translated
  kind: "dark" | "light";
  colors: Required<Pick<ITheme,
    | "background" | "foreground" | "cursor" | "cursorAccent" | "selectionBackground"
    | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white"
    | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow"
    | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite">>;
}

export const MARVEN_THEMES: Record<"dark" | "midnight" | "aurora", TerminalThemePreset>;
export const TERMINAL_PRESETS: readonly TerminalThemePreset[];   // the 12 above, in table order
export type TerminalThemeSetting = "match-app" | string;          // preset id
export function resolveTerminalTheme(setting: TerminalThemeSetting, appTheme: Theme): TerminalThemePreset;
```

`resolveTerminalTheme` returns the matching preset. When the setting is
`match-app` or an unknown id, it maps the app theme using the table above.

### `lib/terminal/terminalSettings.ts`

Stores and validates the settings. It follows the localStorage helper pattern
in `lib/formatOnSave.ts`.

```ts
export interface TerminalSettings {
  theme: TerminalThemeSetting;                    // default "match-app"
  fontFamily: string;                             // default "" = Marven's default stack
  fontSize: number;                               // 10–20, default 12
  lineHeight: number;                             // 1.0–1.6, default 1.0
  cursorStyle: "block" | "bar" | "underline";     // default "block"
  cursorBlink: boolean;                           // default true
}

export const TERMINAL_SETTINGS_EVENT = "marven:terminal-settings";
export const DEFAULT_TERMINAL_SETTINGS: TerminalSettings;
export function getTerminalSettings(): TerminalSettings;
export function setTerminalSettings(patch: Partial<TerminalSettings>): TerminalSettings;
export function resetTerminalSettings(): TerminalSettings;
export function terminalFontStack(fontFamily: string): string;
export function useTerminalSettings(): TerminalSettings;
```

- **Storage.** All settings are saved together as one JSON value under the
  `marven-terminal-settings` localStorage key.
- **Reading.** `getTerminalSettings()` parses that value and validates each
  field. A missing or invalid field gets its default. A theme id that is not a
  preset becomes `match-app`. Numbers are clamped to their ranges, and line
  height is rounded to one decimal. If the JSON is corrupt, every field gets
  its default. Reading never throws.
- **Writing.** `setTerminalSettings()` merges the patch, validates the result,
  saves it, and dispatches `TERMINAL_SETTINGS_EVENT` on `window`.
- **Fonts.** `terminalFontStack()` returns the chosen font, quoted when the
  name contains spaces, followed by the default stack. A font that isn't
  installed therefore falls back to the default.
- **Hook.** `useTerminalSettings()` reads the settings on mount. It updates
  when `TERMINAL_SETTINGS_EVENT` fires, and on the `storage` event for this
  key, so a change made in one Marven window reaches the others.

### `TerminalView.tsx` changes

- The constructor uses the current settings instead of fixed values.
- A single effect watches `settings` and the `theme` prop and updates the
  running xterm in place: `options.theme`, `fontFamily`, `fontSize`,
  `lineHeight`, `cursorStyle` and `cursorBlink`. The shell keeps running.
- **Re-fit after font changes.** When the font family, size or line height
  changes, the terminal re-fits on the next animation frame and again after
  `document.fonts.ready` resolves.
- **Wrapper background.** The wrapper's background comes from the resolved
  theme's background, so light presets have no dark edge.
- **Removed code.** `DARK_THEME`, `MIDNIGHT_THEME`, `AURORA_THEME` and
  `xtermTheme` are deleted. `resolveTerminalTheme` replaces them.

This one component draws both the editor's bottom terminal and the standalone
Terminal view, so both pick up every change.

### `app/components/marven/TerminalSettingsPage.tsx` (new)

This page goes in its own file because `SettingsModal.tsx` is already 3,285
lines. Sections, top to bottom:

1. **Preview.** A fixed, non-interactive sample: a prompt with a git branch, an
   `ls` with directories and a file, an error, a warning, and the cursor. It is
   drawn with the selected theme's ANSI colors and the current font, size, line
   height and cursor style. It stays left-to-right even in Arabic.
2. **Theme.** A grid of cards. "Match app theme" comes first, then the 12
   presets. Each card shows a small sample in that theme's colors and the
   theme's name. The selected card is outlined in the accent color. Clicking a
   card applies it immediately; there is no Save button.
3. **Font and cursor.**
   - **Font** menu: Default (SF Mono / Menlo), JetBrains Mono, Fira Code,
     Cascadia Code, Source Code Pro, and Custom…. Custom… shows a text field
     for any installed font name.
   - **Size** slider, 10–20 px.
   - **Line height** slider, 1.0–1.6 in steps of 0.1.
   - **Cursor** segmented control: Block, Bar or Underline.
   - **Blink** toggle.
   - **Reset to defaults** button.

Styling uses the existing `var(--m-*)` tokens and follows the other Settings
pages.

### Wiring

- **Settings nav.** Add `"terminal"` to `SETTINGS_PAGES` in
  `lib/settingsNav.ts`, after `"keyboard"`. `SettingsModal` adds the nav entry
  and renders `<TerminalSettingsPage />` for it.
- **Command palette.** Add "Terminal: Change theme…" to the agent palette
  commands. It opens Settings on the `terminal` page through
  `openSettingsPage`.
- **Strings.** Add every new UI string to `lib/i18n/settings.en.ts` and
  `lib/i18n/settings.ar.ts`, and the palette label to `en.ts` and `ar.ts`.

## Defaults and compatibility

The defaults reproduce today's terminal: match-app, the default font stack,
12px, line height 1.0, and a blinking block cursor. People who never open the
page see no change except the full ANSI palette in the Marven themes. Nothing
needs migrating, because no terminal settings are stored today.

## Testing

- **`lib/terminal/themes.test.ts`**:
  - Every preset and Marven theme defines all 21 color keys, and each is a
    valid hex or `rgba()` color.
  - Preset ids are unique.
  - `resolveTerminalTheme("match-app", t)` returns the right Marven theme for
    each app theme, including light → dark.
  - A preset id returns that preset for any app theme.
  - An unknown id behaves like `match-app`.
- **`lib/terminal/terminalSettings.test.ts`**:
  - Defaults are returned when nothing is stored.
  - Corrupt JSON falls back to defaults.
  - An unknown theme falls back to `match-app`.
  - Out-of-range font size and line height are clamped.
  - An invalid cursor style falls back to the default.
  - `setTerminalSettings` merges, saves and dispatches the event.
  - `resetTerminalSettings` restores the defaults.
  - `terminalFontStack` quotes names that contain spaces and appends the
    default stack.
- **Existing i18n test** keeps `en` and `ar` keys in parity.
- **Hands-on check in the browser preview.** xterm draws without a shell
  there, so the check covers:
  - switching themes, fonts, size, line height and cursor while a terminal is
    open, and confirming it updates without reopening;
  - the grid staying sized correctly after a font change;
  - "Match app theme" following an app theme switch.

  Behavior against real shell output is checked in the Electron app.
