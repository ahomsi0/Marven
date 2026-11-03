# Marven In-App Browser — Design Spec
_2026-11-02_

## Overview

Grow the chat's browser panel (PR #6: one native view, back/forward/reload, address bar) into a real browser inside Marven: tabs, history, bookmarks, ad and tracker blocking, and downloads. It stays on Electron's bundled Chromium — no fork, no engine of our own. The panel keeps opening from the globe at the far right of the chat header, and gains a full-width view.

---

## Design Decisions

| Decision | Choice |
|---|---|
| Engine | Electron's Chromium (`WebContentsView`), one view per tab |
| Where state lives | Main process owns tabs, history, bookmarks, downloads and blocking; the renderer draws snapshots and sends commands |
| Placement | Side panel beside the chat, plus an expand toggle to full width (sidebar stays). Same tabs in both |
| Restart | Restore all tabs; only the active one loads, the rest load on first click |
| Search / home | Brave Search (`https://search.brave.com/search?q=`, home `https://search.brave.com/`) |
| Storage | JSON files in `userData/browser/` (not SQLite — `better-sqlite3` is built for the Next server's Node ABI, not Electron's) |
| Ad blocking | `@ghostery/adblocker` core engine with our own `webRequest` hook, EasyList + EasyPrivacy, network blocking only. Not `@ghostery/adblocker-electron`: on import it sets `ELECTRON_DISABLE_SECURITY_WARNINGS` for the whole app and registers a preload in every page |
| Downloads | Saved straight to the Downloads folder, no Save dialog, never auto-opened |

---

## Architecture

All browser logic moves from `electron/browserView.js` into `electron/browser/`. The renderer holds no browser state of its own.

```
click in UI ─▶ command (IPC) ─▶ main process acts ─▶ snapshot (IPC) ─▶ UI redraws
                                      │
                              tab views (pages) — never talk to the UI
```

### Main process — `electron/browser/`

| File | Job |
|---|---|
| `manager.js` | Owns the tab list; creates/closes/activates/reorders tabs; browser shortcuts; tab and popup caps; broadcasts the snapshot on every change (coalesced to one per animation frame / ~16ms) |
| `session.js` | The `persist:marven-browser` session: permission handlers, plain Chrome user agent, `will-download` → `downloads.js`, blocker attached with its lists loaded lazily |
| `library.js` | The four JSON stores, cleaned on load (written back only if cleaning changed them): tabs, history, bookmarks, per-site blocking; suggestions and clearing history |
| `viewHost.js` | Attaches only the active tab's view at the panel's bounds; shown/frozen state, freeze screenshots, and muting every view that isn't on screen |
| `tab.js` | One tab = one `WebContentsView`. Hardened `webPreferences`, http(s)-only navigation guards, `setWindowOpenHandler` → new tab after the current one; reports url, title, favicon, loading, canGoBack/Forward, error state, blocked count |
| `tabsModel.js` | Pure tab-list logic, no Electron import: next active tab after close, reorder, restore ordering, closed-tab stack (last 10). Unit-tested |
| `history.js`, `bookmarks.js`, `suggest.js`, `downloadNames.js`, `shortcuts.js`, `validate.js` | Pure helpers (history map, bookmark list, suggestion ranking, download names, shortcut mapping, argument checks). Unit-tested |
| `store.js` | Load/save `tabs.json`, `bookmarks.json`, `history.json`, `sites.json`. Debounced (~1s) atomic writes (temp file + rename), flush on quit; unreadable file → renamed to `.bak`, start empty |
| `blocker.js` | Ghostery engine from prebuilt ads+tracking lists, cached compiled engine in `userData/browser/adblock.bin`, refreshed weekly; per-site allowlist; per-tab blocked counter |
| `downloads.js` | `will-download` → unique path in Downloads (`name (1).ext`), progress/cancel/done/failed, Show in Finder (`shell.showItemInFolder`) |
| `favicons.js` | Fetch favicon URLs through the browser session (`session.fetch`), cap at 64 KB, return a `data:` URL for the UI |
| `ipc.js` | Registers every channel; accepts only from Marven's own window; validates every argument |

`electron/main.js` keeps one call to register the browser and one to attach it to the window, as today.

### Snapshot sent to the renderer

```ts
interface BrowserSnapshot {
  tabs: Array<{
    id: string; url: string; title: string; favicon: string | null; // data: URL
    loading: boolean; canGoBack: boolean; canGoForward: boolean;
    blocked: number; blockingEnabled: boolean;
    error: null | { kind: "unreachable" | "certificate" | "crashed"; description: string };
  }>;
  activeId: string | null;
  downloads: Array<{ id: string; filename: string; state: "progressing" | "completed" | "cancelled" | "interrupted";
                     receivedBytes: number; totalBytes: number }>;
}
```

Bookmarks and history are not in the snapshot; the UI asks for them on demand (`suggest(query)`, `listBookmarks(query)`, `isBookmarked(url)`), so a large history never crosses IPC on every tab update.

### Commands (preload bridge `marvenElectron.browser`)

`show(bounds)`, `setBounds(bounds)`, `hide()`, `newTab(url?)`, `closeTab(id)`, `activateTab(id)`, `moveTab(id, toIndex)`, `reopenClosedTab()`, `navigate(id, url)`, `command(id, "back" | "forward" | "reload" | "stop")`, `toggleBookmark(url, title)`, `removeBookmark(id)`, `listBookmarks(query)`, `suggest(query)`, `setBlocking(host, enabled)`, `cancelDownload(id)`, `showDownload(id)`, `clearBrowsingData()`, `onSnapshot(cb)`.

### Renderer

- `lib/inAppBrowser.ts` — shared types and the bridge type, `normalizeBrowserInput` (exists), `hostOf`, `isWebUrl`. Ranking lives in the main process (`electron/browser/suggest.js`) so history never crosses IPC in bulk.
- `app/components/marven/browser/` — `BrowserPanel` (layout, bounds sync, overlay hiding, error states), `TabStrip`, `Toolbar`, `AddressBar` (with suggestions), `BookmarksMenu`, `DownloadsMenu`. Replaces `app/components/marven/BrowserPanel.tsx`.
- `ChatLayout.tsx` — owns `browserOpen` and `browserExpanded`; expanded = the browser takes the chat column's full width.

---

## UI

**Tab strip** (above the toolbar): favicon, title, × on hover; + opens a new tab on the home page; drag to reorder; tabs shrink as more open (min width ~80px, then scroll horizontally).

**Toolbar:** back, forward, reload/stop · address bar · downloads, bookmarks, expand, close. Inside the address bar: lock for https, a shield with the blocked count (click → toggle blocking for this site), a star (filled when bookmarked; click toggles).

**Suggestions:** up to 6 rows while typing — up to 5 from the main process (bookmarks first, then history), then "Search Brave for …". Arrow keys move, Enter opens the highlighted row (or the typed text if none is highlighted), Escape closes.

**Bookmarks menu:** search box, newest first, click to open, remove button. No folders, no bookmarks bar.

**Downloads menu:** each file with a progress bar, Cancel, and Show in Finder when complete. The toolbar icon shows a progress ring while anything is downloading. Session-only list.

**Expand:** toggles side panel ↔ full width (covers the chat area, sidebar stays). Escape or the button goes back.

**Shortcuts:** Cmd+T, Cmd+W, Cmd+Shift+T, Cmd+L, Cmd+R, Cmd+1–9, Cmd+[ / Cmd+]. Handled in the main process from `before-input-event`: on the page's own view while the page has focus, and on Marven's window while focus is inside the panel (the renderer reports panel focus over IPC). `preventDefault` there also stops the default menu's Cmd+W / Cmd+R.

**Overlays** (Settings, Language, search palette) keep hiding the native view, as in PR #6.

**Menus over the page:** the suggestions, bookmarks and downloads menus open over the page area, but the native view draws above the DOM. While one is open the main process captures the page (`capturePage`), hides the view, and the panel shows the screenshot in its place.

**Closing the last tab** leaves one new tab on the home page.

**Sound:** only the tab on screen plays audio. Every other tab's page is muted, so closing the panel, opening an overlay or switching tabs silences it, and showing a tab unmutes it. (A menu open over the page doesn't mute it.)

**Open in your browser** (PR #6's toolbar button) is dropped — no room at the 360px minimum width.

**RTL:** the tab strip and toolbar follow the app direction; the address bar stays LTR; back/forward icons mirror.

**Clear browsing data:** a button in Settings → General clears history, cookies, cache and storage of the browser partition (not bookmarks).

---

## Data

All files live in `userData/browser/`.

| File | Shape | Rules |
|---|---|---|
| `tabs.json` | `{ tabs: [{ url, title }], activeIndex }` | Saved ~1s after a change and on quit; tab ids are regenerated each launch |
| `bookmarks.json` | `[{ id, url, title, addedAt }]` | Title ≤ 300 chars; one bookmark per URL |
| `history.json` | `{ [url]: { title, visits, lastVisit } }` | Only http(s) main-frame navigations; ≤ 5,000 entries (oldest `lastVisit` dropped); entries older than 90 days pruned on load |
| `sites.json` | `{ blockingDisabled: string[] }` | Hostnames |
| `adblock.bin` | Ghostery's serialized engine | Rebuilt if older than 7 days or unreadable |

Restored tabs are created without a view; the view is created and loaded the first time a tab becomes active.

**Suggestion ranking** (`rankSuggestions`, `electron/browser/suggest.js`, at most 5 rows): match query (case-insensitive) against URL and title; bookmarks rank above history; within history, score = `visits × recency` where recency decays by half every 7 days; ties broken by shorter URL.

---

## Security

The page is untrusted web content. Unchanged from PR #6, for every tab:

- one shared partition `persist:marven-browser`, separate from Marven's UI session
- `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true`, no preload
- only http(s) on navigate, redirect and window-open
- every permission request and check denied (including HTML fullscreen and clipboard reads), with one exception: `clipboard-sanitized-write`, so a page's "Copy" buttons work

New:

- **IPC validation:** tab ids must exist; URLs pass `isWebUrl`; bounds are finite non-negative numbers; strings are length-capped; unknown commands are ignored.
- **Favicons:** fetched by the main process through the browser session, size-capped, passed as `data:` URLs — the app CSP is not loosened.
- **Downloads:** filename = `path.basename` of the suggested name with path separators and leading dots stripped; final path is verified to sit directly inside the Downloads folder; files are never opened automatically. Verify during implementation that Chromium sets the macOS quarantine attribute on completed downloads.
- **Certificate errors:** no bypass.

---

## Error Handling

When a tab is in an error state the native view is hidden and the panel shows a message with an action:

| Case | Detected by | Message | Action |
|---|---|---|---|
| Can't load (offline, DNS, refused) | `did-fail-load` on the main frame (ignoring `ERR_ABORTED`) | "Can't reach this site" | Retry |
| Bad certificate | `did-fail-load` with a certificate error code | "This connection isn't secure" | none (Back) |
| Page crashed | `render-process-gone` | "This page crashed" | Reload |

The error clears on the next successful navigation. Other failures:

- filter lists can't be fetched → browse unblocked, retry next launch
- a store write fails → keep state in memory, `console.error`
- a store file is unreadable → move to `.bak`, start empty

---

## Testing

**Unit (vitest):**
- `tabsModel` — activate after close (right neighbour, else left), reorder, restore order, closed-tab stack limit
- `store` — atomic write, recovery from a corrupt file, history cap and 90-day prune (temp directory)
- `rankSuggestions` — bookmarks first, recency decay, limit 5
- download naming — sanitising, `(1)` numbering
- IPC validators — rejects bad ids, URLs, bounds, oversized strings

**Real Electron app** (CDP scripts on `--remote-debugging-port` + main-process `--inspect`):
- open, switch, close, reorder tabs; Cmd+T/W/Shift+T
- tabs restored after a restart, only the active one loaded
- bookmark a page; history appears in suggestions
- blocked count > 0 on a page with ads; toggling the site off reloads with 0
- a small download lands in a test Downloads folder (`MARVEN_DOWNLOADS_DIR` override used only by the test run)
- expand toggle — view bounds match the full-width viewport
- error states for an unreachable host and a bad certificate (`https://expired.badssl.com/`)
- Arabic / RTL layout

Plus `npm run typecheck` and the existing suite.

---

## Out of Scope

Bookmark folders and a bookmarks bar, a history page, private windows, discarding idle tabs, HTML fullscreen, extensions, sync, and letting Marven's agent drive the browser (a separate design).
