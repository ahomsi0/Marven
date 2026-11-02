# In-App Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the chat's browser panel into a real browser inside Marven — tabs, history, bookmarks, ad and tracker blocking, downloads, and a full-width view.

**Architecture:** The Electron main process owns everything (`electron/browser/`): one `WebContentsView` per tab, JSON stores in `userData/browser/`, a Ghostery filter engine on the browser session, and a download manager. The renderer draws a snapshot the main process pushes over IPC and sends commands back; it holds no browser state of its own. Pure logic (tab list, history, bookmarks, ranking, naming, validation, shortcuts) lives in Electron-free modules with vitest tests.

**Tech Stack:** Electron 41 (`WebContentsView`, `session`, `webRequest`, `DownloadItem`), `@ghostery/adblocker` 2.20.3 (core engine, MPL-2.0), Next.js 15 / React 19 client components, Tailwind, i18next, vitest.

**Spec:** [docs/superpowers/specs/2026-11-02-in-app-browser-design.md](../specs/2026-11-02-in-app-browser-design.md)

---

## Before you start

- Work on a new branch stacked on `feat/in-app-browser` (PR #6): `git checkout -b feat/browser-tabs`.
- Electron main-process files are CommonJS (`require` / `module.exports`), 2-space indent, single quotes. Renderer files are TypeScript with double quotes. Match that.
- Tests for `electron/browser/*.js` are TypeScript files next to them (`electron/browser/x.test.ts`) importing the CJS module; vitest's default include already picks them up. Run one file with `npx vitest run electron/browser/x.test.ts`.
- `lib/storage.test.ts` has 2 failures on this machine that predate this work (they fail on a clean checkout too). Ignore them; everything else must stay green.
- Theme tokens are CSS variables: `--m-bg`, `--m-surface`, `--m-surface-2`, `--m-surface-3`, `--m-border`, `--m-border-subtle`, `--m-text`, `--m-text-muted`, `--m-text-faint`, `--m-accent`, `--m-local` (green). Use logical Tailwind classes (`ms-`, `me-`, `start-`, `end-`, `border-s`) so RTL works.
- Do **not** use `@ghostery/adblocker-electron`. On import it sets `process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'` for the whole app and registers a preload in every page. We use the core `@ghostery/adblocker` engine and our own `webRequest` hook instead.

## File map

| File | Status | Responsibility |
|---|---|---|
| `electron/browser/validate.js` | create | `isWebUrl`, `cleanBounds`, `cleanText`, `isId`, `isHost`, `hostOf` |
| `electron/browser/tabsModel.js` | create | Pure tab list: add, close, activate, move, reopen, update, save/restore |
| `electron/browser/history.js` | create | Pure history map: record visit, update title, prune, sanitize |
| `electron/browser/bookmarks.js` | create | Pure bookmark list: toggle, remove, search, sanitize |
| `electron/browser/suggest.js` | create | `rankSuggestions` for the address bar |
| `electron/browser/downloadNames.js` | create | `sanitizeFilename`, `uniqueName` |
| `electron/browser/shortcuts.js` | create | `shortcutAction(input, platform)` |
| `electron/browser/store.js` | create | JSON file store: atomic, debounced, corrupt-file recovery |
| `electron/browser/blocker.js` | create | Ghostery engine load/cache + `webRequest` blocking with per-site allowlist |
| `electron/browser/downloads.js` | create | `will-download` → Downloads folder, progress, cancel, show |
| `electron/browser/favicons.js` | create | Fetch favicon through the browser session → `data:` URL |
| `electron/browser/tab.js` | create | `Tab` class wrapping one lazy `WebContentsView` |
| `electron/browser/manager.js` | create | Owns tabs, stores, blocker, downloads; bounds; snapshot; shortcuts |
| `electron/browser/ipc.js` | create | IPC channels with sender check + validation |
| `electron/browserView.js` | delete | Replaced by `electron/browser/` |
| `electron/main.js` | modify | Create manager, register IPC, attach window, flush on quit |
| `electron/preload.js` | modify | New `browser` bridge |
| `lib/inAppBrowser.ts` | modify | Shared types + bridge type; keep `normalizeBrowserInput` |
| `app/components/marven/BrowserPanel.tsx` | delete | Replaced by `browser/BrowserPanel.tsx` |
| `app/components/marven/browser/*.tsx|ts` | create | `BrowserPanel`, `TabStrip`, `Toolbar`, `AddressBar`, `BookmarksMenu`, `DownloadsMenu`, `ErrorState`, `useBrowserSnapshot`, `useDismiss` |
| `app/components/marven/ChatLayout.tsx` | modify | `browserExpanded`, new import path |
| `app/components/marven/SettingsModal.tsx` | modify | "Browsing data" block in General |
| `lib/i18n/en.ts`, `lib/i18n/ar.ts` | modify | `browser.*` strings |
| `lib/i18n/settings.en.ts`, `lib/i18n/settings.ar.ts` | modify | `settings.general.browsingData*` strings |
| `package.json` | modify | `@ghostery/adblocker` dependency |

---

### Task 1: Branch, Brave default, dependency

**Files:**
- Modify: `package.json`, `package-lock.json`
- Already modified (uncommitted from the previous session): `lib/inAppBrowser.ts` (`SEARCH_URL` → Brave), `app/components/marven/BrowserPanel.tsx` (`HOME_URL` → Brave)

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/browser-tabs
```

- [ ] **Step 2: Commit the Brave switch on its own**

```bash
git add lib/inAppBrowser.ts app/components/marven/BrowserPanel.tsx
git commit -m "Use Brave Search for the in-app browser's search and home page"
```

- [ ] **Step 3: Install the filter engine (exact version)**

```bash
npm install --save-exact @ghostery/adblocker@2.20.3
```

Expected: `package.json` gains `"@ghostery/adblocker": "2.20.3"` under `dependencies` (it must be in `dependencies`, not `devDependencies`, so electron-builder ships it).

- [ ] **Step 4: Confirm it loads in plain Node**

```bash
node -e "const g=require('@ghostery/adblocker'); console.log(typeof g.FiltersEngine.fromLists, typeof g.Request.fromRawDetails, g.adsAndTrackingLists.length)"
```

Expected: `function function 5` (the list count may differ by a little; it must be > 0).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add the Ghostery filter engine for the in-app browser"
```

---

### Task 2: Input validation

**Files:**
- Create: `electron/browser/validate.js`
- Test: `electron/browser/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { isWebUrl, cleanBounds, cleanText, isId, isHost, hostOf } from "./validate.js";

describe("validate", () => {
  it("accepts only http(s) URLs", () => {
    expect(isWebUrl("https://example.com/")).toBe(true);
    expect(isWebUrl("http://localhost:3000")).toBe(true);
    for (const bad of ["file:///etc/hosts", "javascript:alert(1)", "chrome://settings", "not a url", "", 42, null]) {
      expect(isWebUrl(bad)).toBe(false);
    }
    expect(isWebUrl("https://x.com/" + "a".repeat(9000))).toBe(false);
  });

  it("cleans bounds or rejects them", () => {
    expect(cleanBounds({ x: 1.6, y: -3, width: 200.2, height: 100 })).toEqual({ x: 2, y: 0, width: 200, height: 100 });
    expect(cleanBounds({ x: 1, y: 2, width: NaN, height: 4 })).toBeNull();
    expect(cleanBounds(null)).toBeNull();
    expect(cleanBounds("0,0,1,1")).toBeNull();
  });

  it("caps text and drops non-strings", () => {
    expect(cleanText("abcdef", 3)).toBe("abc");
    expect(cleanText(undefined, 3)).toBe("");
    expect(cleanText({}, 3)).toBe("");
  });

  it("recognises ids and hosts", () => {
    expect(isId("6f1c2d3e-aaaa-4bbb-8ccc-000000000000")).toBe(true);
    expect(isId("d12")).toBe(true);
    expect(isId("../etc")).toBe(false);
    expect(isId("")).toBe(false);
    expect(isHost("www.example.com")).toBe(true);
    expect(isHost("[::1]")).toBe(true);
    expect(isHost("a b")).toBe(false);
    expect(isHost("")).toBe(false);
  });

  it("extracts the hostname", () => {
    expect(hostOf("https://www.example.com:8080/a")).toBe("www.example.com");
    expect(hostOf("garbage")).toBe("");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/browser/validate.test.ts`
Expected: FAIL — `Failed to resolve import "./validate.js"`.

- [ ] **Step 3: Implement**

```js
// Argument checks for everything that crosses into the in-app browser from
// the renderer (IPC) or from saved files. Nothing here imports Electron.

const MAX_URL_LENGTH = 8192;

function isWebUrl(value) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const n = (v) => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : NaN);
  const bounds = { x: n(b.x), y: n(b.y), width: n(b.width), height: n(b.height) };
  return Object.values(bounds).some(Number.isNaN) ? null : bounds;
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function isId(value) {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/i.test(value);
}

function isHost(value) {
  return typeof value === 'string' && /^[a-z0-9.\-:[\]]{1,253}$/i.test(value);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

module.exports = { isWebUrl, cleanBounds, cleanText, isId, isHost, hostOf };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/browser/validate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/browser/validate.js electron/browser/validate.test.ts
git commit -m "Add input validation for the in-app browser"
```

---

### Task 3: Tab list model

**Files:**
- Create: `electron/browser/tabsModel.js`
- Test: `electron/browser/tabsModel.test.ts`

State shape: `{ tabs: [{ id, url, title }], activeId: string | null, closed: [{ url, title, index }] }`. Saved shape (`tabs.json`): `{ tabs: [{ url, title }], activeIndex: number }` — ids are regenerated on every launch.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  emptyState, addTab, closeTab, activateTab, moveTab, reopenClosed, updateTab, toSaved, fromSaved, CLOSED_LIMIT,
} from "./tabsModel.js";

const tab = (id: string) => ({ id, url: `https://${id}.com/`, title: id });
const ids = (s: { tabs: { id: string }[] }) => s.tabs.map((t) => t.id);

describe("tabsModel", () => {
  it("adds at the end by default and activates", () => {
    let s = addTab(emptyState(), tab("a"));
    s = addTab(s, tab("b"));
    expect(ids(s)).toEqual(["a", "b"]);
    expect(s.activeId).toBe("b");
  });

  it("adds after a given tab, optionally in the background", () => {
    let s = addTab(addTab(emptyState(), tab("a")), tab("b"));
    s = addTab(s, tab("c"), { afterId: "a", activate: false });
    expect(ids(s)).toEqual(["a", "c", "b"]);
    expect(s.activeId).toBe("b");
  });

  it("activates the first tab even when added in the background", () => {
    const s = addTab(emptyState(), tab("a"), { activate: false });
    expect(s.activeId).toBe("a");
  });

  it("closing the active tab activates its right neighbour, else the left", () => {
    let s = ["a", "b", "c"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = activateTab(s, "b");
    s = closeTab(s, "b");
    expect(ids(s)).toEqual(["a", "c"]);
    expect(s.activeId).toBe("c");
    s = closeTab(s, "c");
    expect(s.activeId).toBe("a");
    s = closeTab(s, "a");
    expect(s.activeId).toBeNull();
  });

  it("closing a background tab keeps the active one", () => {
    let s = ["a", "b"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = closeTab(s, "a");
    expect(s.activeId).toBe("b");
  });

  it("remembers closed tabs, newest first, up to the limit", () => {
    let s = emptyState();
    for (let i = 0; i < CLOSED_LIMIT + 3; i++) s = closeTab(addTab(s, tab(`t${i}`)), `t${i}`);
    expect(s.closed).toHaveLength(CLOSED_LIMIT);
    expect(s.closed[0].url).toBe(`https://t${CLOSED_LIMIT + 2}.com/`);
  });

  it("reopens the last closed tab at its old position", () => {
    let s = ["a", "b", "c"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = closeTab(s, "b");
    s = reopenClosed(s, () => "b2");
    expect(ids(s)).toEqual(["a", "b2", "c"]);
    expect(s.activeId).toBe("b2");
    expect(s.tabs[1].url).toBe("https://b.com/");
    expect(s.closed).toHaveLength(0);
    expect(reopenClosed(s, () => "x")).toBe(s);
  });

  it("moves a tab and clamps the target index", () => {
    let s = ["a", "b", "c"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = moveTab(s, "a", 2);
    expect(ids(s)).toEqual(["b", "c", "a"]);
    s = moveTab(s, "a", -5);
    expect(ids(s)).toEqual(["a", "b", "c"]);
    expect(moveTab(s, "zzz", 1)).toBe(s);
  });

  it("updates a tab's url and title", () => {
    const s = updateTab(addTab(emptyState(), tab("a")), "a", { url: "https://new.com/", title: "New" });
    expect(s.tabs[0]).toEqual({ id: "a", url: "https://new.com/", title: "New" });
  });

  it("ignores unknown ids", () => {
    const s = addTab(emptyState(), tab("a"));
    expect(activateTab(s, "nope")).toBe(s);
    expect(closeTab(s, "nope")).toBe(s);
    expect(updateTab(s, "nope", { title: "x" })).toBe(s);
  });

  it("round-trips through the saved shape with fresh ids", () => {
    let s = ["a", "b", "c"].reduce((acc, id) => addTab(acc, tab(id)), emptyState());
    s = activateTab(s, "b");
    const saved = toSaved(s);
    expect(saved).toEqual({
      tabs: [
        { url: "https://a.com/", title: "a" },
        { url: "https://b.com/", title: "b" },
        { url: "https://c.com/", title: "c" },
      ],
      activeIndex: 1,
    });
    let n = 0;
    const restored = fromSaved(saved, () => `id${n++}`);
    expect(ids(restored)).toEqual(["id0", "id1", "id2"]);
    expect(restored.activeId).toBe("id1");
    expect(restored.closed).toEqual([]);
  });

  it("drops bad saved entries and survives garbage", () => {
    let n = 0;
    const restored = fromSaved(
      { tabs: [{ url: "file:///etc/hosts", title: "x" }, { url: "https://ok.com/", title: 5 }, null], activeIndex: 7 },
      () => `id${n++}`,
    );
    expect(restored.tabs).toEqual([{ id: "id0", url: "https://ok.com/", title: "" }]);
    expect(restored.activeId).toBe("id0");
    expect(fromSaved("garbage", () => "x")).toEqual(emptyState());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/browser/tabsModel.test.ts`
Expected: FAIL — cannot resolve `./tabsModel.js`.

- [ ] **Step 3: Implement**

```js
// The in-app browser's tab list as plain immutable data. The manager keeps
// one of these and swaps it on every change; the native views live elsewhere.

const { isWebUrl, cleanText } = require('./validate');

const CLOSED_LIMIT = 10;
const TITLE_LIMIT = 300;

function emptyState() {
  return { tabs: [], activeId: null, closed: [] };
}

function addTab(state, tab, { afterId = null, activate = true } = {}) {
  const tabs = [...state.tabs];
  const at = afterId ? tabs.findIndex((t) => t.id === afterId) : -1;
  if (at === -1) tabs.push(tab);
  else tabs.splice(at + 1, 0, tab);
  const activeId = activate || !state.activeId ? tab.id : state.activeId;
  return { ...state, tabs, activeId };
}

function closeTab(state, id) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;
  const closing = state.tabs[index];
  const tabs = state.tabs.filter((t) => t.id !== id);
  let { activeId } = state;
  if (activeId === id) activeId = (tabs[index] ?? tabs[index - 1] ?? null)?.id ?? null;
  const closed = [{ url: closing.url, title: closing.title, index }, ...state.closed].slice(0, CLOSED_LIMIT);
  return { tabs, activeId, closed };
}

function activateTab(state, id) {
  if (state.activeId === id || !state.tabs.some((t) => t.id === id)) return state;
  return { ...state, activeId: id };
}

function moveTab(state, id, toIndex) {
  const from = state.tabs.findIndex((t) => t.id === id);
  if (from === -1) return state;
  const to = Math.max(0, Math.min(state.tabs.length - 1, toIndex));
  if (to === from) return state;
  const tabs = [...state.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { ...state, tabs };
}

function reopenClosed(state, makeId) {
  if (state.closed.length === 0) return state;
  const [entry, ...closed] = state.closed;
  const tab = { id: makeId(), url: entry.url, title: entry.title };
  const tabs = [...state.tabs];
  tabs.splice(Math.min(entry.index, tabs.length), 0, tab);
  return { tabs, activeId: tab.id, closed };
}

function updateTab(state, id, patch) {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) return state;
  const tabs = [...state.tabs];
  tabs[index] = { ...tabs[index], ...patch };
  return { ...state, tabs };
}

function toSaved(state) {
  return {
    tabs: state.tabs.map(({ url, title }) => ({ url, title })),
    activeIndex: Math.max(0, state.tabs.findIndex((t) => t.id === state.activeId)),
  };
}

function fromSaved(saved, makeId) {
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.tabs)) return emptyState();
  const savedActive = saved.tabs[saved.activeIndex];
  let activeId = null;
  const tabs = [];
  for (const entry of saved.tabs) {
    if (!entry || !isWebUrl(entry.url)) continue;
    const tab = { id: makeId(), url: entry.url, title: cleanText(entry.title, TITLE_LIMIT) };
    if (entry === savedActive) activeId = tab.id;
    tabs.push(tab);
  }
  return { tabs, activeId: activeId ?? tabs[0]?.id ?? null, closed: [] };
}

module.exports = {
  CLOSED_LIMIT, emptyState, addTab, closeTab, activateTab, moveTab, reopenClosed, updateTab, toSaved, fromSaved,
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/browser/tabsModel.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/browser/tabsModel.js electron/browser/tabsModel.test.ts
git commit -m "Add the in-app browser's tab list model"
```

---

### Task 4: History and bookmarks

**Files:**
- Create: `electron/browser/history.js`, `electron/browser/bookmarks.js`
- Test: `electron/browser/history.test.ts`, `electron/browser/bookmarks.test.ts`

History shape: `{ [url]: { title, visits, lastVisit } }`. Bookmarks shape: `[{ id, url, title, addedAt }]`.

- [ ] **Step 1: Write the failing history test**

```ts
import { describe, it, expect } from "vitest";
import { recordVisit, updateTitle, prune, sanitizeHistory, MAX_ENTRIES, MAX_AGE_MS } from "./history.js";

const DAY = 86_400_000;

describe("history", () => {
  it("records visits and counts repeats", () => {
    let h = recordVisit({}, "https://a.com/", "A", 1000);
    h = recordVisit(h, "https://a.com/", "", 2000);
    expect(h["https://a.com/"]).toEqual({ title: "A", visits: 2, lastVisit: 2000 });
  });

  it("ignores non-web URLs", () => {
    const h = recordVisit({}, "about:blank", "x", 1);
    expect(h).toEqual({});
  });

  it("updates the title of a known URL only", () => {
    const h = recordVisit({}, "https://a.com/", "", 1);
    expect(updateTitle(h, "https://a.com/", "Real")["https://a.com/"].title).toBe("Real");
    expect(updateTitle(h, "https://other.com/", "x")).toBe(h);
  });

  it("drops entries older than 90 days", () => {
    const now = 200 * DAY;
    const h = { "https://old.com/": { title: "", visits: 1, lastVisit: now - MAX_AGE_MS - 1 }, "https://new.com/": { title: "", visits: 1, lastVisit: now - DAY } };
    expect(Object.keys(prune(h, now))).toEqual(["https://new.com/"]);
  });

  it("keeps only the most recent entries", () => {
    const h: Record<string, { title: string; visits: number; lastVisit: number }> = {};
    for (let i = 0; i < MAX_ENTRIES + 10; i++) h[`https://s${i}.com/`] = { title: "", visits: 1, lastVisit: 1_000_000 + i };
    const pruned = prune(h, 1_000_000 + MAX_ENTRIES + 10);
    expect(Object.keys(pruned)).toHaveLength(MAX_ENTRIES);
    expect(pruned["https://s0.com/"]).toBeUndefined();
    expect(pruned[`https://s${MAX_ENTRIES + 9}.com/`]).toBeDefined();
  });

  it("sanitizes whatever was on disk", () => {
    expect(sanitizeHistory(null)).toEqual({});
    expect(sanitizeHistory([1, 2])).toEqual({});
    expect(
      sanitizeHistory({
        "https://ok.com/": { title: "Ok", visits: 3, lastVisit: 5 },
        "javascript:x": { title: "", visits: 1, lastVisit: 1 },
        "https://bad.com/": { title: "x", visits: "lots", lastVisit: 1 },
      }),
    ).toEqual({ "https://ok.com/": { title: "Ok", visits: 3, lastVisit: 5 } });
  });
});
```

- [ ] **Step 2: Write the failing bookmarks test**

```ts
import { describe, it, expect } from "vitest";
import { toggleBookmark, removeBookmark, searchBookmarks, sanitizeBookmarks } from "./bookmarks.js";

describe("bookmarks", () => {
  it("adds, then removes on a second toggle", () => {
    const added = toggleBookmark([], "https://a.com/", "A", 10, () => "b1");
    expect(added).toEqual({ list: [{ id: "b1", url: "https://a.com/", title: "A", addedAt: 10 }], bookmarked: true });
    const removed = toggleBookmark(added.list, "https://a.com/", "A", 20, () => "b2");
    expect(removed).toEqual({ list: [], bookmarked: false });
  });

  it("caps titles and refuses non-web URLs", () => {
    const { list } = toggleBookmark([], "https://a.com/", "x".repeat(500), 1, () => "b1");
    expect(list[0].title).toHaveLength(300);
    expect(toggleBookmark([], "file:///x", "x", 1, () => "b1")).toEqual({ list: [], bookmarked: false });
  });

  it("removes by id", () => {
    const list = [{ id: "b1", url: "https://a.com/", title: "A", addedAt: 1 }];
    expect(removeBookmark(list, "b1")).toEqual([]);
    expect(removeBookmark(list, "nope")).toBe(list);
  });

  it("searches title and URL, newest first", () => {
    const list = [
      { id: "1", url: "https://github.com/", title: "GitHub", addedAt: 1 },
      { id: "2", url: "https://docs.python.org/", title: "Python docs", addedAt: 3 },
      { id: "3", url: "https://gitlab.com/", title: "GitLab", addedAt: 2 },
    ];
    expect(searchBookmarks(list, "").map((b) => b.id)).toEqual(["2", "3", "1"]);
    expect(searchBookmarks(list, "GIT").map((b) => b.id)).toEqual(["3", "1"]);
    expect(searchBookmarks(list, "python").map((b) => b.id)).toEqual(["2"]);
  });

  it("sanitizes whatever was on disk", () => {
    expect(sanitizeBookmarks({})).toEqual([]);
    expect(
      sanitizeBookmarks([
        { id: "1", url: "https://ok.com/", title: "Ok", addedAt: 1 },
        { id: "2", url: "javascript:x", title: "", addedAt: 1 },
        { id: "../x", url: "https://bad-id.com/", title: "", addedAt: 1 },
        { id: "3", url: "https://ok.com/", title: "dupe", addedAt: 2 },
      ]),
    ).toEqual([{ id: "1", url: "https://ok.com/", title: "Ok", addedAt: 1 }]);
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run electron/browser/history.test.ts electron/browser/bookmarks.test.ts`
Expected: FAIL — cannot resolve `./history.js` / `./bookmarks.js`.

- [ ] **Step 4: Implement `electron/browser/history.js`**

```js
// Browsing history as a plain map keyed by URL. Kept small: at most
// MAX_ENTRIES URLs, none older than MAX_AGE_MS.

const { isWebUrl, cleanText } = require('./validate');

const MAX_ENTRIES = 5000;
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const TITLE_LIMIT = 300;

function recordVisit(history, url, title, now) {
  if (!isWebUrl(url)) return history;
  const prev = history[url];
  return {
    ...history,
    [url]: {
      title: cleanText(title, TITLE_LIMIT) || prev?.title || '',
      visits: (prev?.visits ?? 0) + 1,
      lastVisit: now,
    },
  };
}

function updateTitle(history, url, title) {
  const prev = history[url];
  if (!prev || !title || prev.title === title) return history;
  return { ...history, [url]: { ...prev, title: cleanText(title, TITLE_LIMIT) } };
}

function prune(history, now) {
  const kept = Object.entries(history)
    .filter(([, entry]) => entry.lastVisit >= now - MAX_AGE_MS)
    .sort((a, b) => b[1].lastVisit - a[1].lastVisit)
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept);
}

function sanitizeHistory(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [url, entry] of Object.entries(raw)) {
    if (!isWebUrl(url) || !entry || typeof entry !== 'object') continue;
    if (!Number.isFinite(entry.visits) || !Number.isFinite(entry.lastVisit)) continue;
    out[url] = { title: cleanText(entry.title, TITLE_LIMIT), visits: entry.visits, lastVisit: entry.lastVisit };
  }
  return out;
}

module.exports = { MAX_ENTRIES, MAX_AGE_MS, recordVisit, updateTitle, prune, sanitizeHistory };
```

- [ ] **Step 5: Implement `electron/browser/bookmarks.js`**

```js
// Bookmarks as a plain list, one per URL.

const { isWebUrl, cleanText, isId } = require('./validate');

const TITLE_LIMIT = 300;

function toggleBookmark(list, url, title, now, makeId) {
  if (!isWebUrl(url)) return { list, bookmarked: false };
  if (list.some((b) => b.url === url)) return { list: list.filter((b) => b.url !== url), bookmarked: false };
  const bookmark = { id: makeId(), url, title: cleanText(title, TITLE_LIMIT), addedAt: now };
  return { list: [...list, bookmark], bookmarked: true };
}

function removeBookmark(list, id) {
  return list.some((b) => b.id === id) ? list.filter((b) => b.id !== id) : list;
}

function searchBookmarks(list, query) {
  const q = query.trim().toLowerCase();
  return list
    .filter((b) => !q || b.url.toLowerCase().includes(q) || b.title.toLowerCase().includes(q))
    .sort((a, b) => b.addedAt - a.addedAt);
}

function sanitizeBookmarks(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const b of raw) {
    if (!b || !isId(b.id) || !isWebUrl(b.url) || !Number.isFinite(b.addedAt) || seen.has(b.url)) continue;
    seen.add(b.url);
    out.push({ id: b.id, url: b.url, title: cleanText(b.title, TITLE_LIMIT), addedAt: b.addedAt });
  }
  return out;
}

module.exports = { toggleBookmark, removeBookmark, searchBookmarks, sanitizeBookmarks };
```

- [ ] **Step 6: Run both to verify they pass**

Run: `npx vitest run electron/browser/history.test.ts electron/browser/bookmarks.test.ts`
Expected: PASS (6 + 5 tests).

- [ ] **Step 7: Commit**

```bash
git add electron/browser/history.js electron/browser/history.test.ts electron/browser/bookmarks.js electron/browser/bookmarks.test.ts
git commit -m "Add history and bookmark models for the in-app browser"
```

---

### Task 5: Address-bar suggestion ranking

**Files:**
- Create: `electron/browser/suggest.js`
- Test: `electron/browser/suggest.test.ts`

Ranking runs in the main process (history never crosses IPC in bulk). It returns at most 5 rows; the address bar appends a "Search Brave for …" row, for 6 in total.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { rankSuggestions, HALF_LIFE_MS } from "./suggest.js";

const NOW = 1_000 * HALF_LIFE_MS;

describe("rankSuggestions", () => {
  it("returns nothing for an empty query", () => {
    expect(rankSuggestions({ query: "  ", bookmarks: [], history: {}, now: NOW })).toEqual([]);
  });

  it("puts bookmarks before history and does not repeat a URL", () => {
    const rows = rankSuggestions({
      query: "git",
      bookmarks: [{ id: "1", url: "https://github.com/", title: "GitHub", addedAt: 1 }],
      history: {
        "https://github.com/": { title: "GitHub", visits: 50, lastVisit: NOW },
        "https://gitlab.com/": { title: "GitLab", visits: 1, lastVisit: NOW },
      },
      now: NOW,
    });
    expect(rows).toEqual([
      { kind: "bookmark", url: "https://github.com/", title: "GitHub" },
      { kind: "history", url: "https://gitlab.com/", title: "GitLab" },
    ]);
  });

  it("weighs visits by recency, halving every 7 days", () => {
    const rows = rankSuggestions({
      query: "news",
      bookmarks: [],
      history: {
        "https://old-news.com/": { title: "", visits: 10, lastVisit: NOW - 4 * HALF_LIFE_MS }, // 10 / 16 = 0.625
        "https://fresh-news.com/": { title: "", visits: 1, lastVisit: NOW }, // 1
      },
      now: NOW,
    });
    expect(rows.map((r) => r.url)).toEqual(["https://fresh-news.com/", "https://old-news.com/"]);
  });

  it("matches the title too, case-insensitively, and breaks ties by shorter URL", () => {
    const rows = rankSuggestions({
      query: "PYTHON",
      bookmarks: [],
      history: {
        "https://docs.example.org/3/library/": { title: "Python docs", visits: 1, lastVisit: NOW },
        "https://py.org/": { title: "Python", visits: 1, lastVisit: NOW },
      },
      now: NOW,
    });
    expect(rows.map((r) => r.url)).toEqual(["https://py.org/", "https://docs.example.org/3/library/"]);
  });

  it("returns at most 5 rows", () => {
    const history: Record<string, { title: string; visits: number; lastVisit: number }> = {};
    for (let i = 0; i < 20; i++) history[`https://site${i}.com/`] = { title: "site", visits: i, lastVisit: NOW };
    expect(rankSuggestions({ query: "site", bookmarks: [], history, now: NOW })).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/browser/suggest.test.ts`
Expected: FAIL — cannot resolve `./suggest.js`.

- [ ] **Step 3: Implement**

```js
// Address-bar suggestions: matching bookmarks (newest first), then matching
// history ranked by visits weighted by recency.

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 5;

function matches(q, url, title) {
  return url.toLowerCase().includes(q) || title.toLowerCase().includes(q);
}

function rankSuggestions({ query, bookmarks, history, now, limit = LIMIT }) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const seen = new Set();

  const marks = bookmarks
    .filter((b) => matches(q, b.url, b.title))
    .sort((a, b) => b.addedAt - a.addedAt || a.url.length - b.url.length);
  for (const b of marks) {
    if (out.length >= limit) return out;
    seen.add(b.url);
    out.push({ kind: 'bookmark', url: b.url, title: b.title });
  }

  const visited = Object.entries(history)
    .filter(([url, h]) => !seen.has(url) && matches(q, url, h.title))
    .map(([url, h]) => ({ url, title: h.title, score: h.visits * Math.pow(0.5, (now - h.lastVisit) / HALF_LIFE_MS) }))
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length);
  for (const h of visited) {
    if (out.length >= limit) break;
    out.push({ kind: 'history', url: h.url, title: h.title });
  }
  return out;
}

module.exports = { HALF_LIFE_MS, rankSuggestions };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/browser/suggest.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/browser/suggest.js electron/browser/suggest.test.ts
git commit -m "Rank address-bar suggestions from bookmarks and history"
```

---

### Task 6: Download names and shortcuts

**Files:**
- Create: `electron/browser/downloadNames.js`, `electron/browser/shortcuts.js`
- Test: `electron/browser/downloadNames.test.ts`, `electron/browser/shortcuts.test.ts`

- [ ] **Step 1: Write the failing download-names test**

```ts
import { describe, it, expect } from "vitest";
import { sanitizeFilename, uniqueName } from "./downloadNames.js";

describe("sanitizeFilename", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
  });

  it("strips folders, leading dots and unsafe characters", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\evil.exe")).toBe("evil.exe");
    expect(sanitizeFilename("..hidden")).toBe("hidden");
    expect(sanitizeFilename('a<b>:c"|?*.txt')).toBe("a_b__c____.txt");
  });

  it("falls back to 'download' and caps the length", () => {
    expect(sanitizeFilename("")).toBe("download");
    expect(sanitizeFilename("...")).toBe("download");
    expect(sanitizeFilename(undefined)).toBe("download");
    expect(sanitizeFilename("x".repeat(300) + ".zip").length).toBe(200);
  });
});

describe("uniqueName", () => {
  it("returns the name when free, else numbers it before the extension", () => {
    const taken = new Set(["a.pdf", "a (1).pdf", "notes"]);
    const exists = (n: string) => taken.has(n);
    expect(uniqueName("b.pdf", exists)).toBe("b.pdf");
    expect(uniqueName("a.pdf", exists)).toBe("a (2).pdf");
    expect(uniqueName("notes", exists)).toBe("notes (1)");
  });
});
```

- [ ] **Step 2: Write the failing shortcuts test**

```ts
import { describe, it, expect } from "vitest";
import { shortcutAction } from "./shortcuts.js";

const key = (k: string, extra: Record<string, boolean> = {}) => ({ type: "keyDown", key: k, meta: true, control: false, shift: false, alt: false, ...extra });

describe("shortcutAction", () => {
  it("maps Cmd shortcuts on macOS", () => {
    expect(shortcutAction(key("t"), "darwin")).toEqual({ action: "new-tab" });
    expect(shortcutAction(key("w"), "darwin")).toEqual({ action: "close-tab" });
    expect(shortcutAction(key("T", { shift: true }), "darwin")).toEqual({ action: "reopen-tab" });
    expect(shortcutAction(key("l"), "darwin")).toEqual({ action: "focus-address" });
    expect(shortcutAction(key("r"), "darwin")).toEqual({ action: "reload" });
    expect(shortcutAction(key("["), "darwin")).toEqual({ action: "back" });
    expect(shortcutAction(key("]"), "darwin")).toEqual({ action: "forward" });
    expect(shortcutAction(key("3"), "darwin")).toEqual({ action: "select-tab", index: 2 });
    expect(shortcutAction(key("9"), "darwin")).toEqual({ action: "select-tab", index: -1 });
  });

  it("uses Ctrl elsewhere", () => {
    expect(shortcutAction(key("t"), "win32")).toBeNull();
    expect(shortcutAction(key("t", { meta: false, control: true }), "win32")).toEqual({ action: "new-tab" });
  });

  it("ignores key-ups, Alt combos, other keys and junk", () => {
    expect(shortcutAction({ ...key("t"), type: "keyUp" }, "darwin")).toBeNull();
    expect(shortcutAction(key("t", { alt: true }), "darwin")).toBeNull();
    expect(shortcutAction(key("c"), "darwin")).toBeNull();
    expect(shortcutAction(key("w", { shift: true }), "darwin")).toBeNull();
    expect(shortcutAction(null, "darwin")).toBeNull();
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run electron/browser/downloadNames.test.ts electron/browser/shortcuts.test.ts`
Expected: FAIL — cannot resolve the modules.

- [ ] **Step 4: Implement `electron/browser/downloadNames.js`**

```js
// File names for downloads: whatever the site suggests is reduced to a bare,
// safe name, and numbered if the Downloads folder already has one.

const path = require('node:path');

const NAME_LIMIT = 200;

function sanitizeFilename(name) {
  let base = String(name ?? '').split(/[\\/]/).pop();
  base = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  if (!base) base = 'download';
  if (base.length <= NAME_LIMIT) return base;
  const ext = path.extname(base).slice(0, 20);
  return base.slice(0, NAME_LIMIT - ext.length) + ext;
}

function uniqueName(name, exists) {
  if (!exists(name)) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

module.exports = { sanitizeFilename, uniqueName };
```

- [ ] **Step 5: Implement `electron/browser/shortcuts.js`**

```js
// Browser keyboard shortcuts, from an Electron `before-input-event` input.
// Cmd on macOS, Ctrl elsewhere.

function shortcutAction(input, platform = process.platform) {
  if (!input || input.type !== 'keyDown' || typeof input.key !== 'string') return null;
  const mod = platform === 'darwin' ? input.meta : input.control;
  if (!mod || input.alt) return null;
  const key = input.key.toLowerCase();
  if (input.shift) return key === 't' ? { action: 'reopen-tab' } : null;
  switch (key) {
    case 't': return { action: 'new-tab' };
    case 'w': return { action: 'close-tab' };
    case 'l': return { action: 'focus-address' };
    case 'r': return { action: 'reload' };
    case '[': return { action: 'back' };
    case ']': return { action: 'forward' };
    default: break;
  }
  if (/^[1-9]$/.test(key)) return { action: 'select-tab', index: key === '9' ? -1 : Number(key) - 1 };
  return null;
}

module.exports = { shortcutAction };
```

- [ ] **Step 6: Run both to verify they pass**

Run: `npx vitest run electron/browser/downloadNames.test.ts electron/browser/shortcuts.test.ts`
Expected: PASS (4 + 3 tests).

- [ ] **Step 7: Commit**

```bash
git add electron/browser/downloadNames.js electron/browser/downloadNames.test.ts electron/browser/shortcuts.js electron/browser/shortcuts.test.ts
git commit -m "Add download naming and keyboard shortcuts for the in-app browser"
```

---

### Task 7: JSON store

**Files:**
- Create: `electron/browser/store.js`
- Test: `electron/browser/store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJsonStore } from "./store.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "marven-browser-store-"));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createJsonStore", () => {
  it("starts from the fallback when the file is missing", () => {
    const store = createJsonStore(path.join(dir, "a.json"), { n: 0 });
    expect(store.get()).toEqual({ n: 0 });
  });

  it("writes once after the delay, batching changes", () => {
    const file = path.join(dir, "sub", "a.json");
    const store = createJsonStore(file, { n: 0 }, { delayMs: 1000 });
    store.set({ n: 1 });
    store.set({ n: 2 });
    expect(fs.existsSync(file)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ n: 2 });
    expect(fs.readdirSync(path.dirname(file))).toEqual(["a.json"]); // no temp file left behind
  });

  it("flush writes immediately, and only when something changed", () => {
    const file = path.join(dir, "a.json");
    const store = createJsonStore(file, { n: 0 });
    store.flush();
    expect(fs.existsSync(file)).toBe(false);
    store.set({ n: 5 });
    store.flush();
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ n: 5 });
  });

  it("loads what was saved", () => {
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, JSON.stringify({ n: 9 }));
    expect(createJsonStore(file, { n: 0 }).get()).toEqual({ n: 9 });
  });

  it("moves an unreadable file aside and starts fresh", () => {
    const file = path.join(dir, "a.json");
    fs.writeFileSync(file, "{not json");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = createJsonStore(file, { n: 0 });
    expect(store.get()).toEqual({ n: 0 });
    expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("{not json");
    expect(fs.existsSync(file)).toBe(false);
    errors.mockRestore();
  });

  it("keeps working in memory when a write fails", () => {
    const file = path.join(dir, "a.json");
    const store = createJsonStore(file, { n: 0 });
    fs.mkdirSync(file); // a directory appears where the file should go → rename fails
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    store.set({ n: 1 });
    expect(() => store.flush()).not.toThrow();
    expect(store.get()).toEqual({ n: 1 });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/browser/store.test.ts`
Expected: FAIL — cannot resolve `./store.js`.

- [ ] **Step 3: Implement**

```js
// A JSON file kept in memory and written back after a short delay. Writes go
// to a temp file that is renamed over the real one, so a crash mid-write
// never leaves a half-written file. An unreadable file is moved to `.bak`.

const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    console.error('[browser] unreadable file, starting fresh:', file, err.message);
    try { fs.renameSync(file, `${file}.bak`); } catch { /* best effort */ }
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function createJsonStore(file, fallback, { delayMs = 1000 } = {}) {
  let value = readJson(file, fallback);
  let dirty = false;
  let timer = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    try {
      writeJsonAtomic(file, value);
    } catch (err) {
      console.error('[browser] could not save', file, err.message);
    }
  }

  return {
    get: () => value,
    set(next) {
      value = next;
      dirty = true;
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}

module.exports = { createJsonStore };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/browser/store.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add electron/browser/store.js electron/browser/store.test.ts
git commit -m "Add an atomic JSON store for the in-app browser"
```

---

### Task 8: Ad and tracker blocker

**Files:**
- Create: `electron/browser/blocker.js`
- Test: `electron/browser/blocker.test.ts`

Uses the core engine with `loadCosmeticFilters: false`, so no script is ever injected into pages. The compiled engine is cached in `adblock.bin` and rebuilt weekly; if the lists can't be fetched, a stale cache is used, and with no cache at all, browsing is unblocked.

- [ ] **Step 1: Write the failing test** (pure parts only: cache freshness, and the request decision with a tiny real engine)

```ts
import { describe, it, expect } from "vitest";
import { FiltersEngine } from "@ghostery/adblocker";
import { isCacheFresh, decide, CACHE_MAX_AGE_MS } from "./blocker.js";

describe("blocker", () => {
  it("treats the cache as fresh for a week", () => {
    expect(isCacheFresh(1000, 1000 + CACHE_MAX_AGE_MS - 1)).toBe(true);
    expect(isCacheFresh(1000, 1000 + CACHE_MAX_AGE_MS)).toBe(false);
  });

  const engine = FiltersEngine.parse("||ads.example.net^\n||tracker.example.org^$third-party", {
    loadCosmeticFilters: false,
    loadNetworkFilters: true,
  });
  const details = (url: string, resourceType = "script") => ({ id: 1, url, resourceType, referrer: "", webContentsId: 7 });

  it("blocks matching third-party requests", () => {
    expect(decide(engine, details("https://ads.example.net/a.js"), "https://news.com/", false)).toEqual({ cancel: true });
    expect(decide(engine, details("https://tracker.example.org/p.gif", "image"), "https://news.com/", false)).toEqual({ cancel: true });
  });

  it("lets everything else through", () => {
    expect(decide(engine, details("https://cdn.news.com/app.js"), "https://news.com/", false)).toBeNull();
    expect(decide(engine, details("https://ads.example.net/", "mainFrame"), "https://news.com/", false)).toBeNull();
    expect(decide(null, details("https://ads.example.net/a.js"), "https://news.com/", false)).toBeNull();
  });

  it("never blocks on a site the user turned blocking off for", () => {
    expect(decide(engine, details("https://ads.example.net/a.js"), "https://news.com/", true)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run electron/browser/blocker.test.ts`
Expected: FAIL — cannot resolve `./blocker.js`.

- [ ] **Step 3: Implement**

```js
// Ad and tracker blocking for the browser session: network requests only,
// matched against EasyList/EasyPrivacy (Ghostery's engine). No cosmetic
// filtering — that needs a script in every page, which we never inject.

const fs = require('node:fs');
const path = require('node:path');
const { FiltersEngine, Request, adsAndTrackingLists } = require('@ghostery/adblocker');
const { hostOf } = require('./validate');

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ENGINE_CONFIG = { loadCosmeticFilters: false, loadNetworkFilters: true };

function isCacheFresh(mtimeMs, now) {
  return now - mtimeMs < CACHE_MAX_AGE_MS;
}

/** Electron webRequest response for one request, or null to let it through. */
function decide(engine, details, pageUrl, disabledHere) {
  if (!engine || disabledHere || details.resourceType === 'mainFrame') return null;
  const request = Request.fromRawDetails({
    requestId: String(details.id),
    url: details.url,
    sourceUrl: pageUrl || details.referrer || '',
    type: details.resourceType || 'other',
    tabId: details.webContentsId,
  });
  const { match, redirect } = engine.match(request);
  if (redirect) return { redirectURL: redirect.dataUrl };
  if (match) return { cancel: true };
  return null;
}

function createBlocker({ dir, isDisabledFor, onBlocked }) {
  const cacheFile = path.join(dir, 'adblock.bin');
  let engine = null;

  function readCache() {
    return FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(cacheFile)));
  }

  async function load() {
    try {
      if (isCacheFresh(fs.statSync(cacheFile).mtimeMs, Date.now())) {
        engine = readCache();
        return;
      }
    } catch { /* no cache, or it's from another engine version */ }
    try {
      const fresh = await FiltersEngine.fromLists(fetch, adsAndTrackingLists, ENGINE_CONFIG);
      engine = fresh;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cacheFile, Buffer.from(fresh.serialize()));
    } catch (err) {
      console.error('[browser] filter lists unavailable, browsing unblocked for now:', err.message);
      try { engine = readCache(); } catch { /* nothing cached */ }
    }
  }

  function attach(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const wc = details.webContents;
      const pageUrl = wc && !wc.isDestroyed() ? wc.getURL() : details.referrer;
      const response = decide(engine, details, pageUrl, isDisabledFor(hostOf(pageUrl)));
      if (response) onBlocked(details.webContentsId);
      callback(response ?? {});
    });
  }

  return { load, attach };
}

module.exports = { CACHE_MAX_AGE_MS, isCacheFresh, decide, createBlocker };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run electron/browser/blocker.test.ts`
Expected: PASS (4 tests). If `FiltersEngine.parse` rejects the config argument shape, check `node_modules/@ghostery/adblocker/dist/commonjs/engine/engine.d.ts` for `parse(filters, options?: Partial<Config>)` — the second argument is the same `Config` used by `fromLists`.

- [ ] **Step 5: Commit**

```bash
git add electron/browser/blocker.js electron/browser/blocker.test.ts
git commit -m "Block ads and trackers in the in-app browser"
```

---

### Task 9: Downloads and favicons

**Files:**
- Create: `electron/browser/downloads.js`, `electron/browser/favicons.js`

These wrap Electron objects; their pure parts (`sanitizeFilename`, `uniqueName`) are already tested. They're exercised in the Electron run (Task 16).

- [ ] **Step 1: Implement `electron/browser/downloads.js`**

```js
// Downloads go straight to the Downloads folder under a cleaned, unique name,
// and are never opened automatically. The list lasts for the session.
// MARVEN_DOWNLOADS_DIR overrides the folder — used only by the test run.

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');
const { sanitizeFilename, uniqueName } = require('./downloadNames');

function createDownloads({ onChange }) {
  const entries = new Map();
  let seq = 0;

  function folder() {
    return path.resolve(process.env.MARVEN_DOWNLOADS_DIR || app.getPath('downloads'));
  }

  function handle(_event, item) {
    const dir = folder();
    const name = uniqueName(sanitizeFilename(item.getFilename()), (n) => fs.existsSync(path.join(dir, n)));
    const target = path.join(dir, name);
    if (path.dirname(target) !== dir) {
      item.cancel();
      return;
    }
    item.setSavePath(target);

    const entry = { id: `d${++seq}`, filename: name, path: target, state: 'progressing', receivedBytes: 0, totalBytes: item.getTotalBytes(), item };
    entries.set(entry.id, entry);
    onChange();

    item.on('updated', (_e, state) => {
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      onChange();
    });
    item.once('done', (_e, state) => {
      entry.state = state;
      entry.receivedBytes = item.getReceivedBytes();
      entry.item = null;
      onChange();
    });
  }

  function list() {
    return [...entries.values()].map(({ id, filename, state, receivedBytes, totalBytes }) => ({ id, filename, state, receivedBytes, totalBytes }));
  }

  function cancel(id) {
    entries.get(id)?.item?.cancel();
  }

  function show(id) {
    const entry = entries.get(id);
    if (entry?.state === 'completed') shell.showItemInFolder(entry.path);
  }

  return { handle, list, cancel, show };
}

module.exports = { createDownloads };
```

- [ ] **Step 2: Implement `electron/browser/favicons.js`**

```js
// Site icons are fetched here, through the browser's own session, and handed
// to the UI as small data: URLs — so Marven's CSP never has to allow remote
// images.

const { isWebUrl } = require('./validate');

const MAX_BYTES = 64 * 1024;
const IMAGE_TYPES = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|jpeg|webp)$/;

async function fetchFavicon(ses, url) {
  if (!isWebUrl(url)) return null;
  try {
    const res = await ses.fetch(url);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { fetchFavicon };
```

- [ ] **Step 3: Syntax-check both**

Run: `node --check electron/browser/downloads.js && node --check electron/browser/favicons.js && echo ok`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add electron/browser/downloads.js electron/browser/favicons.js
git commit -m "Add downloads and favicons for the in-app browser"
```

---

### Task 10: The Tab class

**Files:**
- Create: `electron/browser/tab.js`

- [ ] **Step 1: Implement**

```js
// One browser tab: a native WebContentsView created the first time the tab is
// shown (restored tabs stay unloaded until then), plus the page state the UI
// draws. Security is the same for every tab: sandboxed, no Node, no preload,
// http(s) only, and window.open becomes a new tab.

const { WebContentsView } = require('electron');
const { isWebUrl } = require('./validate');

const ERR_ABORTED = -3;
const isCertificateError = (code) => code <= -200 && code > -300;

class Tab {
  /**
   * @param {{ id: string, url: string, title: string, session: Electron.Session, hooks: {
   *   onUpdate: (tab: Tab) => void,
   *   onVisit: (url: string, title: string) => void,
   *   onTitle: (url: string, title: string) => void,
   *   onFavicon: (tab: Tab, iconUrl: string) => void,
   *   onOpenTab: (tab: Tab, url: string) => void,
   *   onShortcut: (input: Electron.Input) => boolean,
   *   onView: (tab: Tab) => void,
   * } }} options
   */
  constructor({ id, url, title, session, hooks }) {
    this.id = id;
    this.url = url;
    this.title = title || '';
    this.session = session;
    this.hooks = hooks;
    this.view = null;
    this.webContentsId = null;
    this.favicon = null;
    this.loading = false;
    this.error = null;
    this.blocked = 0;
  }

  get webContents() {
    return this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  ensureView() {
    if (this.webContents) return this.view;
    this.view = new WebContentsView({
      webPreferences: {
        session: this.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    this.view.setVisible(false);
    const wc = this.view.webContents;
    this.webContentsId = wc.id;
    this.wire(wc);
    this.hooks.onView(this);
    if (isWebUrl(this.url)) wc.loadURL(this.url).catch(() => {});
    return this.view;
  }

  wire(wc) {
    const update = () => this.hooks.onUpdate(this);

    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) this.hooks.onOpenTab(this, url);
      return { action: 'deny' };
    });
    const guard = (event, url) => {
      if (!isWebUrl(url)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);

    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      this.blocked = 0;
      this.error = null;
      update();
    });
    wc.on('did-navigate', (_e, url) => {
      this.url = url;
      if (!this.error) this.hooks.onVisit(url, wc.getTitle());
      update();
    });
    wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
      if (!isMainFrame) return;
      this.url = url;
      this.hooks.onVisit(url, wc.getTitle());
      update();
    });
    wc.on('page-title-updated', (_e, title) => {
      this.title = title;
      this.hooks.onTitle(this.url, title);
      update();
    });
    wc.on('page-favicon-updated', (_e, favicons) => {
      if (favicons[0]) this.hooks.onFavicon(this, favicons[0]);
    });
    wc.on('did-start-loading', () => {
      this.loading = true;
      update();
    });
    wc.on('did-stop-loading', () => {
      this.loading = false;
      update();
    });
    wc.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      if (isWebUrl(validatedURL)) this.url = validatedURL;
      this.error = { kind: isCertificateError(code) ? 'certificate' : 'unreachable', description };
      update();
    });
    wc.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit') return;
      this.error = { kind: 'crashed', description: details.reason };
      this.loading = false;
      update();
    });
    wc.on('before-input-event', (event, input) => {
      if (this.hooks.onShortcut(input)) event.preventDefault();
    });
  }

  load(url) {
    if (!isWebUrl(url)) return false;
    this.url = url;
    this.error = null;
    this.webContents?.loadURL(url).catch(() => {});
    this.hooks.onUpdate(this);
    return true;
  }

  canGoBack() {
    return !!this.webContents?.navigationHistory.canGoBack();
  }

  canGoForward() {
    return !!this.webContents?.navigationHistory.canGoForward();
  }

  command(name) {
    const wc = this.webContents;
    if (!wc) return;
    if (name === 'back') wc.navigationHistory.goBack();
    else if (name === 'forward') wc.navigationHistory.goForward();
    else if (name === 'reload') wc.reload();
    else if (name === 'stop') wc.stop();
    else if (name === 'retry') {
      this.error = null;
      wc.loadURL(this.url).catch(() => {});
      this.hooks.onUpdate(this);
    }
  }

  destroyView() {
    const wc = this.webContents;
    this.view = null;
    this.webContentsId = null;
    if (wc) wc.close();
  }
}

module.exports = { Tab };
```

- [ ] **Step 2: Syntax-check**

Run: `node --check electron/browser/tab.js && echo ok`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add electron/browser/tab.js
git commit -m "Add the browser tab wrapper around WebContentsView"
```

---

### Task 11: The manager

**Files:**
- Create: `electron/browser/manager.js`

The session and stores are created lazily on first use, because `session.fromPartition` needs the app to be ready and the manager is created at module load in `main.js`.

- [ ] **Step 1: Implement**

```js
// The in-app browser. Owns the tab list, one native view per tab (only the
// active one is attached, over the panel's viewport), saved history and
// bookmarks, ad blocking and downloads. The renderer gets a snapshot after
// every change and sends commands back (see ipc.js).

const path = require('node:path');
const crypto = require('node:crypto');
const { session } = require('electron');
const { createJsonStore } = require('./store');
const model = require('./tabsModel');
const history = require('./history');
const bookmarks = require('./bookmarks');
const { rankSuggestions } = require('./suggest');
const { createBlocker } = require('./blocker');
const { createDownloads } = require('./downloads');
const { fetchFavicon } = require('./favicons');
const { shortcutAction } = require('./shortcuts');
const { Tab } = require('./tab');
const { hostOf, isWebUrl } = require('./validate');

const PARTITION = 'persist:marven-browser';
const HOME_URL = 'https://search.brave.com/';
const SNAPSHOT_DELAY_MS = 16;
const newId = () => crypto.randomUUID();

/**
 * @param {{ dir: string, getWindow: () => Electron.BrowserWindow | null }} options
 */
function createBrowserManager({ dir, getWindow }) {
  let ses = null;
  let stores = null;
  let downloads = null;
  let state = model.emptyState();
  const tabs = new Map(); // tab id → Tab
  const byWebContents = new Map(); // webContents id → Tab
  let bounds = null;
  let shown = false;
  let frozen = false;
  let freezeToken = 0;
  let panelFocused = false;
  let attached = null;
  let snapshotTimer = null;

  function init() {
    if (ses) return;
    stores = {
      tabs: createJsonStore(path.join(dir, 'tabs.json'), { tabs: [], activeIndex: 0 }),
      history: createJsonStore(path.join(dir, 'history.json'), {}),
      bookmarks: createJsonStore(path.join(dir, 'bookmarks.json'), []),
      sites: createJsonStore(path.join(dir, 'sites.json'), { blockingDisabled: [] }),
    };
    stores.history.set(history.prune(history.sanitizeHistory(stores.history.get()), Date.now()));
    stores.bookmarks.set(bookmarks.sanitizeBookmarks(stores.bookmarks.get()));
    const sites = stores.sites.get();
    if (!Array.isArray(sites?.blockingDisabled)) stores.sites.set({ blockingDisabled: [] });
    state = model.fromSaved(stores.tabs.get(), newId);

    ses = session.fromPartition(PARTITION);
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    downloads = createDownloads({ onChange: scheduleSnapshot });
    ses.on('will-download', (event, item) => downloads.handle(event, item));
    const blocker = createBlocker({
      dir,
      isDisabledFor: blockingDisabled,
      onBlocked: (webContentsId) => {
        const tab = byWebContents.get(webContentsId);
        if (!tab) return;
        tab.blocked += 1;
        scheduleSnapshot();
      },
    });
    blocker.attach(ses);
    void blocker.load();
  }

  function blockingDisabled(host) {
    return !!host && stores.sites.get().blockingDisabled.includes(host);
  }

  // ── State and snapshots ────────────────────────────────────────────────

  function commit(next) {
    if (next === state) return;
    state = next;
    stores.tabs.set(model.toSaved(state));
    scheduleSnapshot();
  }

  function snapshot() {
    return {
      tabs: state.tabs.map((entry) => {
        const tab = tabs.get(entry.id);
        const url = tab?.url ?? entry.url;
        return {
          id: entry.id,
          url,
          title: tab?.title || entry.title,
          favicon: tab?.favicon ?? null,
          loading: tab?.loading ?? false,
          canGoBack: tab?.canGoBack() ?? false,
          canGoForward: tab?.canGoForward() ?? false,
          blocked: tab?.blocked ?? 0,
          blockingEnabled: !blockingDisabled(hostOf(url)),
          error: tab?.error ?? null,
        };
      }),
      activeId: state.activeId,
      downloads: downloads.list(),
      canReopenClosed: state.closed.length > 0,
    };
  }

  function scheduleSnapshot() {
    if (snapshotTimer) return;
    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('browser-snapshot', snapshot());
    }, SNAPSHOT_DELAY_MS);
  }

  // ── Tabs and views ─────────────────────────────────────────────────────

  function tabFor(entry) {
    let tab = tabs.get(entry.id);
    if (tab) return tab;
    tab = new Tab({
      id: entry.id,
      url: entry.url,
      title: entry.title,
      session: ses,
      hooks: {
        onUpdate,
        onVisit: (url, title) => stores.history.set(history.recordVisit(stores.history.get(), url, title, Date.now())),
        onTitle: (url, title) => stores.history.set(history.updateTitle(stores.history.get(), url, title)),
        onFavicon: (t, iconUrl) => {
          void fetchFavicon(ses, iconUrl).then((data) => {
            t.favicon = data;
            scheduleSnapshot();
          });
        },
        onOpenTab: (opener, url) => newTab(url, { afterId: opener.id }),
        onShortcut: handleShortcut,
        onView: (t) => byWebContents.set(t.webContentsId, t),
      },
    });
    tabs.set(entry.id, tab);
    return tab;
  }

  function onUpdate(tab) {
    const entry = state.tabs.find((t) => t.id === tab.id);
    if (entry && (entry.url !== tab.url || entry.title !== tab.title)) {
      commit(model.updateTab(state, tab.id, { url: tab.url, title: tab.title }));
    } else {
      scheduleSnapshot();
    }
    if (tab.id === state.activeId) syncVisibility();
  }

  function activeTab() {
    const entry = state.tabs.find((t) => t.id === state.activeId);
    return entry ? tabFor(entry) : null;
  }

  function detach() {
    if (!attached) return;
    const win = getWindow();
    attached.setVisible(false);
    if (win && !win.isDestroyed() && win.contentView.children.includes(attached)) win.contentView.removeChildView(attached);
    attached = null;
  }

  function showActive() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const tab = activeTab();
    const view = shown && tab ? tab.ensureView() : null;
    if (attached !== view) detach();
    if (view) {
      if (!win.contentView.children.includes(view)) win.contentView.addChildView(view);
      attached = view;
      if (bounds) view.setBounds(bounds);
    }
    syncVisibility();
  }

  function syncVisibility() {
    const tab = activeTab();
    if (attached) attached.setVisible(shown && !frozen && !!tab && !tab.error);
  }

  function forget(tab) {
    if (attached && attached === tab.view) detach();
    if (tab.webContentsId != null) byWebContents.delete(tab.webContentsId);
    tab.destroyView();
    tabs.delete(tab.id);
  }

  function newTab(url, { afterId = null, activate = true } = {}) {
    const entry = { id: newId(), url: isWebUrl(url) ? url : HOME_URL, title: '' };
    commit(model.addTab(state, entry, { afterId, activate }));
    showActive();
    return entry.id;
  }

  function closeTab(id) {
    const tab = tabs.get(id);
    commit(model.closeTab(state, id));
    if (tab) forget(tab);
    if (state.tabs.length === 0) newTab(HOME_URL);
    else showActive();
  }

  function activateTab(id) {
    commit(model.activateTab(state, id));
    showActive();
  }

  function moveTab(id, toIndex) {
    commit(model.moveTab(state, id, toIndex));
  }

  function reopenClosedTab() {
    commit(model.reopenClosed(state, newId));
    showActive();
  }

  function existingTab(id) {
    const entry = state.tabs.find((t) => t.id === id);
    return entry ? tabFor(entry) : null;
  }

  function navigate(id, url) {
    return existingTab(id)?.load(url) ?? false;
  }

  function command(id, name) {
    existingTab(id)?.command(name);
  }

  // ── Panel placement ────────────────────────────────────────────────────

  function show(b) {
    bounds = b;
    shown = true;
    frozen = false;
    freezeToken += 1;
    if (state.tabs.length === 0) newTab(HOME_URL);
    else showActive();
    scheduleSnapshot();
  }

  function setBounds(b) {
    bounds = b;
    if (attached) attached.setBounds(b);
  }

  function hide() {
    shown = false;
    syncVisibility();
  }

  // Menus in the toolbar open over the page area, but a native view draws
  // above the DOM. The renderer shows this screenshot in its place meanwhile.
  async function freeze() {
    const tab = activeTab();
    if (!attached || !shown || frozen || !tab || tab.error) return null;
    const token = ++freezeToken;
    const image = await attached.webContents.capturePage();
    if (token !== freezeToken) return null;
    frozen = true;
    syncVisibility();
    return image.isEmpty() ? null : image.toDataURL();
  }

  function unfreeze() {
    freezeToken += 1;
    frozen = false;
    syncVisibility();
  }

  // ── Shortcuts ──────────────────────────────────────────────────────────

  function focusAddress() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    win.webContents.focus();
    win.webContents.send('browser-focus-address');
  }

  function handleShortcut(input) {
    const shortcut = shortcutAction(input);
    if (!shortcut) return false;
    const active = state.activeId;
    switch (shortcut.action) {
      case 'new-tab': newTab(HOME_URL); break;
      case 'close-tab': if (active) closeTab(active); break;
      case 'reopen-tab': reopenClosedTab(); break;
      case 'focus-address': focusAddress(); break;
      case 'reload': if (active) command(active, 'reload'); break;
      case 'back': if (active) command(active, 'back'); break;
      case 'forward': if (active) command(active, 'forward'); break;
      case 'select-tab': {
        const target = shortcut.index === -1 ? state.tabs[state.tabs.length - 1] : state.tabs[shortcut.index];
        if (target) activateTab(target.id);
        break;
      }
      default: return false;
    }
    return true;
  }

  // ── Bookmarks, history, blocking, data ─────────────────────────────────

  function toggleBookmark(url, title) {
    const { list, bookmarked } = bookmarks.toggleBookmark(stores.bookmarks.get(), url, title, Date.now(), newId);
    stores.bookmarks.set(list);
    return bookmarked;
  }

  function removeBookmark(id) {
    stores.bookmarks.set(bookmarks.removeBookmark(stores.bookmarks.get(), id));
  }

  function listBookmarks(query) {
    return bookmarks.searchBookmarks(stores.bookmarks.get(), query);
  }

  function isBookmarked(url) {
    return stores.bookmarks.get().some((b) => b.url === url);
  }

  function suggest(query) {
    return rankSuggestions({ query, bookmarks: stores.bookmarks.get(), history: stores.history.get(), now: Date.now() });
  }

  function setBlocking(host, enabled) {
    const list = stores.sites.get().blockingDisabled.filter((h) => h !== host);
    if (!enabled) list.push(host);
    stores.sites.set({ blockingDisabled: list });
    const tab = activeTab();
    if (tab && hostOf(tab.url) === host) tab.command('reload');
    scheduleSnapshot();
  }

  async function clearBrowsingData() {
    stores.history.set({});
    await ses.clearStorageData();
    await ses.clearCache();
    return true;
  }

  // ── Window lifecycle ───────────────────────────────────────────────────

  function attachWindow(win) {
    // A renderer reload (HMR, crash recovery) must not leave a page floating
    // over a UI that no longer has a browser panel.
    win.webContents.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      panelFocused = false;
      if (ses) hide();
    });
    // Browser shortcuts while focus is in the panel's toolbar (the page's own
    // view handles them while the page has focus).
    win.webContents.on('before-input-event', (event, input) => {
      if (ses && panelFocused && handleShortcut(input)) event.preventDefault();
    });
    win.on('closed', () => {
      attached = null;
      shown = false;
      for (const tab of tabs.values()) {
        if (tab.webContentsId != null) byWebContents.delete(tab.webContentsId);
        tab.destroyView();
      }
    });
  }

  function flush() {
    if (!stores) return;
    for (const store of Object.values(stores)) store.flush();
  }

  const ready = (fn) => (...args) => {
    init();
    return fn(...args);
  };

  return {
    attachWindow,
    flush,
    show: ready(show),
    setBounds: ready(setBounds),
    hide: ready(hide),
    freeze: ready(freeze),
    unfreeze: ready(unfreeze),
    setPanelFocused: (focused) => { panelFocused = focused; },
    snapshot: ready(snapshot),
    newTab: ready((url) => newTab(url)),
    closeTab: ready(closeTab),
    activateTab: ready(activateTab),
    moveTab: ready(moveTab),
    reopenClosedTab: ready(reopenClosedTab),
    navigate: ready(navigate),
    command: ready(command),
    toggleBookmark: ready(toggleBookmark),
    removeBookmark: ready(removeBookmark),
    listBookmarks: ready(listBookmarks),
    isBookmarked: ready(isBookmarked),
    suggest: ready(suggest),
    setBlocking: ready(setBlocking),
    cancelDownload: ready((id) => downloads.cancel(id)),
    showDownload: ready((id) => downloads.show(id)),
    clearBrowsingData: ready(clearBrowsingData),
  };
}

module.exports = { createBrowserManager, HOME_URL };
```

- [ ] **Step 2: Syntax-check**

Run: `node --check electron/browser/manager.js && echo ok`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add electron/browser/manager.js
git commit -m "Add the in-app browser manager"
```

---

### Task 12: IPC, preload, and main-process wiring

**Files:**
- Create: `electron/browser/ipc.js`
- Modify: `electron/main.js` (lines 10, 315, 422, and the `before-quit` handler at ~873)
- Modify: `electron/preload.js` (the `browser:` block)
- Delete: `electron/browserView.js`

- [ ] **Step 1: Implement `electron/browser/ipc.js`**

```js
// IPC for the in-app browser. Only Marven's own window may call these, and
// every argument is checked before it reaches the manager.

const { ipcMain } = require('electron');
const { isWebUrl, cleanBounds, cleanText, isId, isHost } = require('./validate');

const COMMANDS = new Set(['back', 'forward', 'reload', 'stop', 'retry']);

function registerBrowserIpc(manager, getWindow) {
  const fromApp = (event) => {
    const win = getWindow();
    return !!win && !win.isDestroyed() && event.sender === win.webContents;
  };
  const handle = (channel, fn) => ipcMain.handle(channel, (event, ...args) => (fromApp(event) ? fn(...args) : null));
  const on = (channel, fn) => ipcMain.on(channel, (event, ...args) => {
    if (fromApp(event)) fn(...args);
  });

  handle('browser-show', (bounds) => {
    const b = cleanBounds(bounds);
    if (!b) return false;
    manager.show(b);
    return true;
  });
  on('browser-bounds', (bounds) => {
    const b = cleanBounds(bounds);
    if (b) manager.setBounds(b);
  });
  on('browser-hide', () => manager.hide());
  handle('browser-freeze', () => manager.freeze());
  on('browser-unfreeze', () => manager.unfreeze());
  on('browser-focus', (focused) => manager.setPanelFocused(focused === true));
  handle('browser-snapshot', () => manager.snapshot());

  handle('browser-new-tab', (url) => manager.newTab(isWebUrl(url) ? url : undefined));
  on('browser-close-tab', (id) => { if (isId(id)) manager.closeTab(id); });
  on('browser-activate-tab', (id) => { if (isId(id)) manager.activateTab(id); });
  on('browser-move-tab', (id, toIndex) => { if (isId(id) && Number.isInteger(toIndex)) manager.moveTab(id, toIndex); });
  on('browser-reopen-tab', () => manager.reopenClosedTab());
  handle('browser-navigate', (id, url) => (isId(id) && isWebUrl(url) ? manager.navigate(id, url) : false));
  on('browser-command', (id, name) => { if (isId(id) && COMMANDS.has(name)) manager.command(id, name); });

  handle('browser-toggle-bookmark', (url, title) => (isWebUrl(url) ? manager.toggleBookmark(url, cleanText(title, 300)) : false));
  handle('browser-remove-bookmark', (id) => { if (isId(id)) manager.removeBookmark(id); });
  handle('browser-bookmarks', (query) => manager.listBookmarks(cleanText(query, 200)));
  handle('browser-is-bookmarked', (url) => isWebUrl(url) && manager.isBookmarked(url));
  handle('browser-suggest', (query) => manager.suggest(cleanText(query, 200)));
  on('browser-set-blocking', (host, enabled) => {
    if (isHost(host) && typeof enabled === 'boolean') manager.setBlocking(host, enabled);
  });

  on('browser-cancel-download', (id) => { if (isId(id)) manager.cancelDownload(id); });
  on('browser-show-download', (id) => { if (isId(id)) manager.showDownload(id); });
  handle('browser-clear-data', () => manager.clearBrowsingData());
}

module.exports = { registerBrowserIpc };
```

- [ ] **Step 2: Wire it into `electron/main.js`**

Replace line 10:

```js
const { registerInAppBrowser } = require('./browserView');
```

with:

```js
const { createBrowserManager } = require('./browser/manager');
const { registerBrowserIpc } = require('./browser/ipc');
```

Replace line 315:

```js
const attachInAppBrowser = registerInAppBrowser(() => mainWindow);
```

with:

```js
const inAppBrowser = createBrowserManager({
  dir: path.join(app.getPath('userData'), 'browser'),
  getWindow: () => mainWindow,
});
registerBrowserIpc(inAppBrowser, () => mainWindow);
```

Replace line 422:

```js
  attachInAppBrowser(mainWindow);
```

with:

```js
  inAppBrowser.attachWindow(mainWindow);
```

In `app.on('before-quit', () => {` (~line 873), add as the first line of the handler body:

```js
  inAppBrowser.flush();
```

- [ ] **Step 3: Delete the old module**

```bash
git rm electron/browserView.js
grep -rn "browserView" electron app lib || echo "no references left"
```

Expected: `no references left`

- [ ] **Step 4: Replace the `browser:` block in `electron/preload.js`**

```js
  browser: {
    show: (bounds) => ipcRenderer.invoke("browser-show", bounds),
    setBounds: (bounds) => ipcRenderer.send("browser-bounds", bounds),
    hide: () => ipcRenderer.send("browser-hide"),
    freeze: () => ipcRenderer.invoke("browser-freeze"),
    unfreeze: () => ipcRenderer.send("browser-unfreeze"),
    setFocused: (focused) => ipcRenderer.send("browser-focus", focused),
    snapshot: () => ipcRenderer.invoke("browser-snapshot"),
    newTab: (url) => ipcRenderer.invoke("browser-new-tab", url),
    closeTab: (id) => ipcRenderer.send("browser-close-tab", id),
    activateTab: (id) => ipcRenderer.send("browser-activate-tab", id),
    moveTab: (id, toIndex) => ipcRenderer.send("browser-move-tab", id, toIndex),
    reopenClosedTab: () => ipcRenderer.send("browser-reopen-tab"),
    navigate: (id, url) => ipcRenderer.invoke("browser-navigate", id, url),
    command: (id, name) => ipcRenderer.send("browser-command", id, name),
    toggleBookmark: (url, title) => ipcRenderer.invoke("browser-toggle-bookmark", url, title),
    removeBookmark: (id) => ipcRenderer.invoke("browser-remove-bookmark", id),
    listBookmarks: (query) => ipcRenderer.invoke("browser-bookmarks", query),
    isBookmarked: (url) => ipcRenderer.invoke("browser-is-bookmarked", url),
    suggest: (query) => ipcRenderer.invoke("browser-suggest", query),
    setBlocking: (host, enabled) => ipcRenderer.send("browser-set-blocking", host, enabled),
    cancelDownload: (id) => ipcRenderer.send("browser-cancel-download", id),
    showDownload: (id) => ipcRenderer.send("browser-show-download", id),
    clearBrowsingData: () => ipcRenderer.invoke("browser-clear-data"),
    onSnapshot: (cb) => {
      const handler = (_e, data) => cb(data);
      ipcRenderer.on("browser-snapshot", handler);
      return () => ipcRenderer.removeListener("browser-snapshot", handler);
    },
    onFocusAddress: (cb) => {
      const handler = () => cb();
      ipcRenderer.on("browser-focus-address", handler);
      return () => ipcRenderer.removeListener("browser-focus-address", handler);
    },
  },
```

- [ ] **Step 5: Syntax-check the main-process files**

Run: `for f in electron/main.js electron/preload.js electron/browser/*.js; do node --check "$f" || exit 1; done; echo ok`
Expected: `ok`

- [ ] **Step 6: Commit**

```bash
git add electron/browser/ipc.js electron/main.js electron/preload.js
git commit -m "Wire the in-app browser manager into the main process"
```

---

### Task 13: Renderer types, snapshot hook, dismiss hook

**Files:**
- Modify: `lib/inAppBrowser.ts` (replace everything above `export const SEARCH_URL`)
- Create: `app/components/marven/browser/useBrowserSnapshot.ts`, `app/components/marven/browser/useDismiss.ts`

- [ ] **Step 1: Replace the types in `lib/inAppBrowser.ts`**

Replace from the top of the file down to (not including) `export const SEARCH_URL` with:

```ts
// Renderer side of the in-app browser (electron/browser/ does the work).

export interface BrowserError {
  kind: "unreachable" | "certificate" | "crashed";
  description: string;
}

export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  blocked: number;
  blockingEnabled: boolean;
  error: BrowserError | null;
}

export interface BrowserDownload {
  id: string;
  filename: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  receivedBytes: number;
  totalBytes: number;
}

export interface BrowserSnapshot {
  tabs: BrowserTab[];
  activeId: string | null;
  downloads: BrowserDownload[];
  canReopenClosed: boolean;
}

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

export interface Suggestion {
  kind: "bookmark" | "history";
  url: string;
  title: string;
}

export type TabCommand = "back" | "forward" | "reload" | "stop" | "retry";

export interface BrowserBridge {
  show: (bounds: BrowserBounds) => Promise<boolean>;
  setBounds: (bounds: BrowserBounds) => void;
  hide: () => void;
  freeze: () => Promise<string | null>;
  unfreeze: () => void;
  setFocused: (focused: boolean) => void;
  snapshot: () => Promise<BrowserSnapshot | null>;
  newTab: (url?: string) => Promise<string | null>;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  moveTab: (id: string, toIndex: number) => void;
  reopenClosedTab: () => void;
  navigate: (id: string, url: string) => Promise<boolean>;
  command: (id: string, name: TabCommand) => void;
  toggleBookmark: (url: string, title: string) => Promise<boolean>;
  removeBookmark: (id: string) => Promise<void>;
  listBookmarks: (query: string) => Promise<Bookmark[]>;
  isBookmarked: (url: string) => Promise<boolean>;
  suggest: (query: string) => Promise<Suggestion[]>;
  setBlocking: (host: string, enabled: boolean) => void;
  cancelDownload: (id: string) => void;
  showDownload: (id: string) => void;
  clearBrowsingData: () => Promise<boolean>;
  onSnapshot: (cb: (snapshot: BrowserSnapshot) => void) => () => void;
  onFocusAddress: (cb: () => void) => () => void;
}

/** The Electron bridge, or null outside the desktop app (e.g. `next dev` in a browser). */
export function getBrowserBridge(): BrowserBridge | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((window as any).marvenElectron?.browser as BrowserBridge | undefined) ?? null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function isWebUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

```

Leave `SEARCH_URL` and `normalizeBrowserInput` exactly as they are.

- [ ] **Step 2: Add tests for the two new helpers to `lib/inAppBrowser.test.ts`**

Change the import line to:

```ts
import { SEARCH_URL, normalizeBrowserInput, hostOf, isWebUrl } from "./inAppBrowser";
```

and append:

```ts
describe("hostOf / isWebUrl", () => {
  it("extracts hosts and recognises web URLs", () => {
    expect(hostOf("https://www.example.com/a")).toBe("www.example.com");
    expect(hostOf("nope")).toBe("");
    expect(isWebUrl("https://a.com/")).toBe(true);
    expect(isWebUrl("about:blank")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run lib/inAppBrowser.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 4: Create `app/components/marven/browser/useBrowserSnapshot.ts`**

```ts
"use client";

import { useEffect, useState } from "react";
import type { BrowserBridge, BrowserSnapshot } from "@/lib/inAppBrowser";

const EMPTY: BrowserSnapshot = { tabs: [], activeId: null, downloads: [], canReopenClosed: false };

/** The latest browser snapshot pushed by the main process. */
export function useBrowserSnapshot(bridge: BrowserBridge | null): BrowserSnapshot {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>(EMPTY);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    let pushed = false;
    const off = bridge.onSnapshot((next) => {
      pushed = true;
      if (live) setSnapshot(next);
    });
    // Pull once in case nothing changes for a while; a push always wins.
    void bridge.snapshot().then((next) => {
      if (live && next && !pushed) setSnapshot(next);
    });
    return () => {
      live = false;
      off();
    };
  }, [bridge]);

  return snapshot;
}
```

- [ ] **Step 5: Create `app/components/marven/browser/useDismiss.ts`**

```ts
"use client";

import { useEffect, type RefObject } from "react";

/** Calls `onDismiss` on a click outside `ref` or on Escape, while `active`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, active, onDismiss]);
}
```

- [ ] **Step 6: Commit** (typecheck runs after the components exist, in Task 15)

```bash
git add lib/inAppBrowser.ts lib/inAppBrowser.test.ts app/components/marven/browser/useBrowserSnapshot.ts app/components/marven/browser/useDismiss.ts
git commit -m "Add renderer types and hooks for the in-app browser"
```

---

### Task 14: Strings

**Files:**
- Modify: `lib/i18n/en.ts` (the `browser:` block, ~line 182), `lib/i18n/ar.ts` (its `browser:` block)
- Modify: `lib/i18n/settings.en.ts`, `lib/i18n/settings.ar.ts` (inside `general: {` after `saveShortcut`)

- [ ] **Step 1: Replace the `browser:` block in `lib/i18n/en.ts`**

```ts
  browser: {
    open: "Browser",
    tabs: "Tabs",
    newTab: "New tab",
    closeTab: "Close tab",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    stop: "Stop loading",
    address: "Search or enter an address",
    secure: "Secure connection",
    searchFor: "Search Brave for “{{query}}”",
    blocked_one: "{{count}} ad or tracker blocked",
    blocked_other: "{{count}} ads and trackers blocked",
    blockedHint: "Click to turn off blocking on this site",
    blockingOff: "Blocking is off for this site. Click to turn it on.",
    bookmarkPage: "Bookmark this page",
    removeBookmark: "Remove bookmark",
    bookmarks: "Bookmarks",
    searchBookmarks: "Search bookmarks",
    noBookmarks: "Pages you bookmark show up here.",
    downloads: "Downloads",
    noDownloads: "Files you download show up here.",
    cancel: "Cancel",
    showInFolder: "Show in Finder",
    downloadDone: "Done",
    downloadCancelled: "Cancelled",
    downloadFailed: "Failed",
    expand: "Expand browser",
    collapse: "Back to side panel",
    close: "Close browser",
    errorUnreachable: "Can't reach this site",
    errorCertificate: "This connection isn't secure",
    errorCrashed: "This page crashed",
    retry: "Retry",
    desktopOnly: "The in-app browser works in the Marven desktop app.",
  },
```

- [ ] **Step 2: Replace the `browser:` block in `lib/i18n/ar.ts`**

```ts
  browser: {
    open: "المتصفح",
    tabs: "علامات التبويب",
    newTab: "علامة تبويب جديدة",
    closeTab: "إغلاق علامة التبويب",
    back: "رجوع",
    forward: "تقدّم",
    reload: "إعادة التحميل",
    stop: "إيقاف التحميل",
    address: "ابحث أو أدخل عنوانًا",
    secure: "اتصال آمن",
    searchFor: "ابحث في Brave عن «{{query}}»",
    blocked_zero: "لم يُحظر أي إعلان أو متتبّع",
    blocked_one: "حُظر إعلان أو متتبّع واحد",
    blocked_two: "حُظر إعلانان أو متتبّعان",
    blocked_few: "حُظرت {{count}} إعلانات ومتتبّعات",
    blocked_many: "حُظر {{count}} إعلانًا ومتتبّعًا",
    blocked_other: "حُظر {{count}} إعلان ومتتبّع",
    blockedHint: "انقر لإيقاف الحظر على هذا الموقع",
    blockingOff: "الحظر متوقف لهذا الموقع. انقر لتشغيله.",
    bookmarkPage: "إضافة إشارة مرجعية لهذه الصفحة",
    removeBookmark: "إزالة الإشارة المرجعية",
    bookmarks: "الإشارات المرجعية",
    searchBookmarks: "ابحث في الإشارات المرجعية",
    noBookmarks: "تظهر هنا الصفحات التي تضيف لها إشارة مرجعية.",
    downloads: "التنزيلات",
    noDownloads: "تظهر هنا الملفات التي تنزّلها.",
    cancel: "إلغاء",
    showInFolder: "إظهار في Finder",
    downloadDone: "اكتمل",
    downloadCancelled: "أُلغي",
    downloadFailed: "فشل",
    expand: "توسيع المتصفح",
    collapse: "العودة إلى اللوحة الجانبية",
    close: "إغلاق المتصفح",
    errorUnreachable: "تعذّر الوصول إلى هذا الموقع",
    errorCertificate: "هذا الاتصال غير آمن",
    errorCrashed: "تعطّلت هذه الصفحة",
    retry: "إعادة المحاولة",
    desktopOnly: "يعمل المتصفح المدمج في تطبيق Marven لسطح المكتب.",
  },
```

- [ ] **Step 3: Add the Settings strings**

In `lib/i18n/settings.en.ts`, inside `general: {`, after `saveShortcut: "⌘↵ to save",`:

```ts
    browsingData: "Browsing data",
    browsingDataHint: "Clear the in-app browser's history, cookies and cache. Bookmarks are kept.",
    clearBrowsingData: "Clear browsing data",
    browsingDataCleared: "Cleared",
```

In `lib/i18n/settings.ar.ts`, at the same place:

```ts
    browsingData: "بيانات التصفح",
    browsingDataHint: "امسح سجل المتصفح المدمج وملفات تعريف الارتباط وذاكرة التخزين المؤقت. تبقى الإشارات المرجعية.",
    clearBrowsingData: "مسح بيانات التصفح",
    browsingDataCleared: "تم المسح",
```

- [ ] **Step 4: Run the i18n parity tests**

Run: `npx vitest run lib/i18n`
Expected: PASS (the `Shape<typeof en>` type check happens in typecheck, Task 15).

- [ ] **Step 5: Commit**

```bash
git add lib/i18n/en.ts lib/i18n/ar.ts lib/i18n/settings.en.ts lib/i18n/settings.ar.ts
git commit -m "Add English and Arabic strings for the in-app browser"
```

---

### Task 15: Browser panel components

**Files:**
- Create: `app/components/marven/browser/BrowserPanel.tsx`, `TabStrip.tsx`, `Toolbar.tsx`, `AddressBar.tsx`, `BookmarksMenu.tsx`, `DownloadsMenu.tsx`, `ErrorState.tsx`
- Delete: `app/components/marven/BrowserPanel.tsx`
- Modify: `app/components/marven/ChatLayout.tsx`

Note: the old toolbar's "Open in your browser" button is dropped — there's no room for it next to downloads, bookmarks and expand at the panel's 360px minimum width.

- [ ] **Step 1: Create `ErrorState.tsx`**

```tsx
"use client";

import { GlobeIcon } from "../Icons";
import { useT } from "@/lib/i18n";
import type { BrowserError } from "@/lib/inAppBrowser";

/** Shown in place of the page when the active tab failed to load or crashed. */
export function ErrorState({ error, onRetry }: { error: BrowserError; onRetry: () => void }) {
  const { t } = useT();
  const title =
    error.kind === "certificate"
      ? t("browser.errorCertificate")
      : error.kind === "crashed"
        ? t("browser.errorCrashed")
        : t("browser.errorUnreachable");

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <GlobeIcon className="h-8 w-8 text-[var(--m-text-faint)]" />
      <p className="text-[14px] font-medium text-[var(--m-text)]">{title}</p>
      <p dir="ltr" className="max-w-[320px] break-words font-mono text-[11px] text-[var(--m-text-faint)]">
        {error.description}
      </p>
      {error.kind !== "certificate" && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-[var(--m-border)] px-3 py-1 text-[12px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-2)]"
        >
          {error.kind === "crashed" ? t("browser.reload") : t("browser.retry")}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `TabStrip.tsx`**

```tsx
"use client";

import { useState } from "react";
import { GlobeIcon } from "../Icons";
import { useT } from "@/lib/i18n";
import { hostOf, type BrowserBridge, type BrowserSnapshot } from "@/lib/inAppBrowser";

export function TabStrip({ bridge, snapshot }: { bridge: BrowserBridge; snapshot: BrowserSnapshot }) {
  const { t } = useT();
  const [dragId, setDragId] = useState<string | null>(null);

  return (
    <div
      role="tablist"
      aria-label={t("browser.tabs")}
      className="flex h-9 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-[var(--m-border-subtle)] px-1.5 pt-1.5 [scrollbar-width:none]"
    >
      {snapshot.tabs.map((tab, index) => {
        const active = tab.id === snapshot.activeId;
        const label = tab.title || hostOf(tab.url) || t("browser.newTab");
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            title={label}
            draggable
            onDragStart={(e) => {
              setDragId(tab.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== tab.id) bridge.moveTab(dragId, index);
              setDragId(null);
            }}
            onDragEnd={() => setDragId(null)}
            onClick={() => bridge.activateTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1) bridge.closeTab(tab.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                bridge.activateTab(tab.id);
              }
            }}
            className={`group flex h-full min-w-[80px] max-w-[180px] flex-1 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 px-2 text-[12px] ${
              active
                ? "border-[var(--m-border-subtle)] bg-[var(--m-surface)] text-[var(--m-text)]"
                : "border-transparent text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)]"
            }`}
          >
            {tab.loading ? (
              <span className="h-3 w-3 shrink-0 animate-spin rounded-full border border-[var(--m-text-faint)] border-t-[var(--m-text)]" />
            ) : tab.favicon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <GlobeIcon className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <button
              type="button"
              aria-label={t("browser.closeTab")}
              title={t("browser.closeTab")}
              onClick={(e) => {
                e.stopPropagation();
                bridge.closeTab(tab.id);
              }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-[var(--m-surface-3)] ${
                active ? "" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => void bridge.newTab()}
        aria-label={t("browser.newTab")}
        title={t("browser.newTab")}
        className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Create `AddressBar.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import {
  SEARCH_URL, hostOf, isWebUrl, normalizeBrowserInput, type BrowserBridge, type BrowserTab, type Suggestion,
} from "@/lib/inAppBrowser";

interface Row {
  kind: Suggestion["kind"] | "search";
  url: string;
  title: string;
}

interface AddressBarProps {
  bridge: BrowserBridge | null;
  tab: BrowserTab | null;
  bookmarkVersion: number;
  onSuggestingChange: (open: boolean) => void;
}

export function AddressBar({ bridge, tab, bookmarkVersion, onSuggestingChange }: AddressBarProps) {
  const { t } = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [bookmarked, setBookmarked] = useState(false);
  const url = tab?.url ?? "";
  const web = isWebUrl(url);

  useEffect(() => {
    if (!editing) setText(web ? url : "");
  }, [url, web, editing]);

  useEffect(() => {
    if (!bridge || !web) {
      setBookmarked(false);
      return;
    }
    let live = true;
    void bridge.isBookmarked(url).then((value) => {
      if (live) setBookmarked(value);
    });
    return () => {
      live = false;
    };
  }, [bridge, url, web, bookmarkVersion]);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onFocusAddress(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [bridge]);

  const query = editing ? text.trim() : "";
  useEffect(() => {
    if (!bridge || !query) {
      setSuggestions([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      void bridge.suggest(query).then((list) => {
        if (!live) return;
        setSuggestions(list);
        setHighlight(-1);
      });
    }, 80);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [bridge, query]);

  const rows: Row[] = query
    ? [...suggestions, { kind: "search", url: SEARCH_URL + encodeURIComponent(query), title: t("browser.searchFor", { query }) }]
    : [];
  const open = rows.length > 0;

  useEffect(() => {
    onSuggestingChange(open);
  }, [open, onSuggestingChange]);

  function go(target: string | null) {
    const next = target ?? normalizeBrowserInput(text);
    if (!next || !bridge) return;
    setEditing(false);
    inputRef.current?.blur();
    if (tab) void bridge.navigate(tab.id, next);
    else void bridge.newTab(next);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && open) {
      e.preventDefault();
      setHighlight((h) => (h + 1) % rows.length);
    } else if (e.key === "ArrowUp" && open) {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? rows.length - 1 : h - 1));
    } else if (e.key === "Escape") {
      e.preventDefault();
      setEditing(false);
      e.currentTarget.blur();
    }
  }

  const blockedLabel = tab?.blockingEnabled ? t("browser.blocked", { count: tab.blocked }) : t("browser.blockingOff");

  return (
    <form
      className="relative min-w-0 flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        go(highlight >= 0 ? rows[highlight]?.url ?? null : null);
      }}
    >
      <div className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] ps-2.5 pe-1 focus-within:border-[var(--m-accent)]/60">
        {url.startsWith("https://") && !editing && (
          <svg className="h-3 w-3 shrink-0 text-[var(--m-text-faint)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-label={t("browser.secure")}>
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        )}
        <input
          ref={inputRef}
          dir="ltr"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEditing(true);
          }}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={onKeyDown}
          placeholder={t("browser.address")}
          aria-label={t("browser.address")}
          aria-expanded={open}
          aria-autocomplete="list"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)]"
        />
        {tab && web && !editing && (
          <>
            <button
              type="button"
              onClick={() => bridge?.setBlocking(hostOf(url), !tab.blockingEnabled)}
              title={tab.blockingEnabled ? `${blockedLabel}. ${t("browser.blockedHint")}` : blockedLabel}
              aria-label={blockedLabel}
              aria-pressed={tab.blockingEnabled}
              className={`flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] tabular-nums transition-colors ${
                tab.blockingEnabled
                  ? "text-[var(--m-local)] hover:bg-[var(--m-surface-2)]"
                  : "text-[var(--m-text-faint)] hover:bg-[var(--m-surface-2)]"
              }`}
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
                {!tab.blockingEnabled && <path d="M4 4l16 16" strokeLinecap="round" />}
              </svg>
              {tab.blockingEnabled && tab.blocked > 0 && <span>{tab.blocked}</span>}
            </button>
            <button
              type="button"
              onClick={() => bridge && void bridge.toggleBookmark(url, tab.title).then(setBookmarked)}
              title={bookmarked ? t("browser.removeBookmark") : t("browser.bookmarkPage")}
              aria-label={bookmarked ? t("browser.removeBookmark") : t("browser.bookmarkPage")}
              aria-pressed={bookmarked}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
            >
              <svg className="h-3.5 w-3.5" fill={bookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden>
                <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5z" />
              </svg>
            </button>
          </>
        )}
      </div>

      {open && (
        <ul
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] py-1 shadow-lg"
        >
          {rows.map((row, i) => (
            <li
              key={`${row.kind}:${row.url}`}
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => {
                e.preventDefault();
                go(row.url);
              }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex cursor-default items-center gap-2 px-2.5 py-1.5 text-[12px] ${
                i === highlight ? "bg-[var(--m-surface-2)]" : ""
              }`}
            >
              <span className="w-3.5 shrink-0 text-center text-[var(--m-text-faint)]" aria-hidden>
                {row.kind === "bookmark" ? "★" : row.kind === "history" ? "↺" : "⌕"}
              </span>
              <span className="min-w-0 truncate text-[var(--m-text)]">{row.title || row.url}</span>
              {row.kind !== "search" && (
                <span dir="ltr" className="min-w-0 shrink truncate text-[var(--m-text-faint)]">
                  {hostOf(row.url)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
```

- [ ] **Step 4: Create `BookmarksMenu.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import { hostOf, type Bookmark, type BrowserBridge } from "@/lib/inAppBrowser";

interface BookmarksMenuProps {
  bridge: BrowserBridge;
  onOpen: (url: string) => void;
  onChanged: () => void;
}

export function BookmarksMenu({ bridge, onOpen, onChanged }: BookmarksMenuProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Bookmark[]>([]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    void bridge.listBookmarks(query).then((list) => {
      if (live) setItems(list);
    });
    return () => {
      live = false;
    };
  }, [bridge, query, version]);

  return (
    <div className="absolute end-0 top-full z-30 mt-1 w-72 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] p-1.5 shadow-lg">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("browser.searchBookmarks")}
        aria-label={t("browser.searchBookmarks")}
        className="mb-1 h-7 w-full rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-2 text-[12px] text-[var(--m-text)] outline-none placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)]/60"
      />
      {items.length === 0 ? (
        <p className="px-2 py-3 text-center text-[12px] text-[var(--m-text-faint)]">{t("browser.noBookmarks")}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {items.map((b) => (
            <li key={b.id} className="group flex items-center rounded-md hover:bg-[var(--m-surface-2)]">
              <button type="button" onClick={() => onOpen(b.url)} className="flex min-w-0 flex-1 flex-col items-start px-2 py-1.5 text-start">
                <span className="w-full truncate text-[12px] text-[var(--m-text)]">{b.title || b.url}</span>
                <span dir="ltr" className="w-full truncate text-[11px] text-[var(--m-text-faint)]">{hostOf(b.url)}</span>
              </button>
              <button
                type="button"
                aria-label={t("browser.removeBookmark")}
                title={t("browser.removeBookmark")}
                onClick={() =>
                  void bridge.removeBookmark(b.id).then(() => {
                    setVersion((v) => v + 1);
                    onChanged();
                  })
                }
                className="me-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--m-text-faint)] opacity-0 hover:text-[var(--m-text)] group-hover:opacity-100"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Create `DownloadsMenu.tsx`**

```tsx
"use client";

import { useT } from "@/lib/i18n";
import type { BrowserBridge, BrowserDownload } from "@/lib/inAppBrowser";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function DownloadsMenu({ bridge, downloads }: { bridge: BrowserBridge; downloads: BrowserDownload[] }) {
  const { t } = useT();

  return (
    <div className="absolute end-0 top-full z-30 mt-1 w-72 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] p-1.5 shadow-lg">
      {downloads.length === 0 ? (
        <p className="px-2 py-3 text-center text-[12px] text-[var(--m-text-faint)]">{t("browser.noDownloads")}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {[...downloads].reverse().map((d) => {
            const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : null;
            const status =
              d.state === "progressing"
                ? pct !== null ? `${pct}%` : formatBytes(d.receivedBytes)
                : d.state === "completed"
                  ? t("browser.downloadDone")
                  : d.state === "cancelled"
                    ? t("browser.downloadCancelled")
                    : t("browser.downloadFailed");
            return (
              <li key={d.id} className="rounded-md px-2 py-1.5">
                <p dir="auto" className="truncate text-[12px] text-[var(--m-text)]">{d.filename}</p>
                {d.state === "progressing" && (
                  <div className="mt-1 h-1 overflow-hidden rounded bg-[var(--m-surface-3)]">
                    <div className="h-full bg-[var(--m-accent)] transition-[width]" style={{ width: `${pct ?? 0}%` }} />
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--m-text-faint)]">
                  <span className="tabular-nums">{status}</span>
                  {d.state === "progressing" ? (
                    <button type="button" onClick={() => bridge.cancelDownload(d.id)} className="hover:text-[var(--m-text)]">
                      {t("browser.cancel")}
                    </button>
                  ) : d.state === "completed" ? (
                    <button type="button" onClick={() => bridge.showDownload(d.id)} className="hover:text-[var(--m-text)]">
                      {t("browser.showInFolder")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create `Toolbar.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { BrowserBridge, BrowserDownload, BrowserTab } from "@/lib/inAppBrowser";
import { AddressBar } from "./AddressBar";
import { BookmarksMenu } from "./BookmarksMenu";
import { DownloadsMenu } from "./DownloadsMenu";
import { useDismiss } from "./useDismiss";

type Menu = "bookmarks" | "downloads" | null;

interface ToolbarProps {
  bridge: BrowserBridge | null;
  tab: BrowserTab | null;
  downloads: BrowserDownload[];
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
  onMenuChange: (open: boolean) => void;
}

const tool =
  "relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:hover:bg-transparent";

export function Toolbar({ bridge, tab, downloads, expanded, onToggleExpand, onClose, onMenuChange }: ToolbarProps) {
  const { t } = useT();
  const [menu, setMenu] = useState<Menu>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [bookmarkVersion, setBookmarkVersion] = useState(0);
  const menusRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  useDismiss(menusRef, menu !== null, closeMenu);

  useEffect(() => {
    onMenuChange(menu !== null || suggesting);
  }, [menu, suggesting, onMenuChange]);

  const toggle = (next: Exclude<Menu, null>) => setMenu((m) => (m === next ? null : next));
  const active = downloads.filter((d) => d.state === "progressing");
  const totals = active.reduce((acc, d) => ({ got: acc.got + d.receivedBytes, all: acc.all + d.totalBytes }), { got: 0, all: 0 });
  const progress = totals.all > 0 ? totals.got / totals.all : 0;

  return (
    <div className="relative flex h-11 shrink-0 items-center gap-1 border-b border-[var(--m-border-subtle)] px-2">
      <button type="button" className={tool} disabled={!tab?.canGoBack} onClick={() => tab && bridge?.command(tab.id, "back")} aria-label={t("browser.back")} title={t("browser.back")}>
        <svg className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <button type="button" className={tool} disabled={!tab?.canGoForward} onClick={() => tab && bridge?.command(tab.id, "forward")} aria-label={t("browser.forward")} title={t("browser.forward")}>
        <svg className="h-4 w-4 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M9 6l6 6-6 6" /></svg>
      </button>
      <button
        type="button"
        className={tool}
        disabled={!tab}
        onClick={() => tab && bridge?.command(tab.id, tab.loading ? "stop" : "reload")}
        aria-label={tab?.loading ? t("browser.stop") : t("browser.reload")}
        title={tab?.loading ? t("browser.stop") : t("browser.reload")}
      >
        {tab?.loading ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" /></svg>
        )}
      </button>

      <AddressBar bridge={bridge} tab={tab} bookmarkVersion={bookmarkVersion} onSuggestingChange={setSuggesting} />

      <div ref={menusRef} className="flex items-center gap-1">
        <div className="relative">
          <button type="button" className={tool} disabled={!bridge} onClick={() => toggle("downloads")} aria-expanded={menu === "downloads"} aria-label={t("browser.downloads")} title={t("browser.downloads")}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></svg>
            {active.length > 0 && (
              <svg className="pointer-events-none absolute inset-0.5" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--m-accent)" strokeWidth="1.5" strokeDasharray={`${progress * 66} 66`} transform="rotate(-90 12 12)" />
              </svg>
            )}
          </button>
          {menu === "downloads" && bridge && <DownloadsMenu bridge={bridge} downloads={downloads} />}
        </div>
        <div className="relative">
          <button type="button" className={tool} disabled={!bridge} onClick={() => toggle("bookmarks")} aria-expanded={menu === "bookmarks"} aria-label={t("browser.bookmarks")} title={t("browser.bookmarks")}>
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M7 4h10v16l-5-3.5L7 20V4z" /></svg>
          </button>
          {menu === "bookmarks" && bridge && (
            <BookmarksMenu
              bridge={bridge}
              onOpen={(url) => {
                if (tab) void bridge.navigate(tab.id, url);
                else void bridge.newTab(url);
                setMenu(null);
              }}
              onChanged={() => setBookmarkVersion((v) => v + 1)}
            />
          )}
        </div>
      </div>

      <button type="button" className={tool} onClick={onToggleExpand} aria-pressed={expanded} aria-label={expanded ? t("browser.collapse") : t("browser.expand")} title={expanded ? t("browser.collapse") : t("browser.expand")}>
        {expanded ? (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>
        ) : (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24" aria-hidden><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
        )}
      </button>
      <button type="button" className={tool} onClick={onClose} aria-label={t("browser.close")} title={t("browser.close")}>
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Create `BrowserPanel.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GlobeIcon } from "../Icons";
import { useT } from "@/lib/i18n";
import { useAnyOverlayOpen } from "@/lib/overlays";
import { getBrowserBridge, type BrowserBounds } from "@/lib/inAppBrowser";
import { useBrowserSnapshot } from "./useBrowserSnapshot";
import { TabStrip } from "./TabStrip";
import { Toolbar } from "./Toolbar";
import { ErrorState } from "./ErrorState";

interface BrowserPanelProps {
  expanded: boolean;
  onToggleExpand: () => void;
  onClose: () => void;
}

/**
 * In-app browser panel. Pages are native views (electron/browser/) that the
 * main process positions over `viewport`; this component draws the tabs and
 * toolbar from the main process's snapshot and keeps the view's bounds in sync.
 */
export function BrowserPanel({ expanded, onToggleExpand, onClose }: BrowserPanelProps) {
  const { t } = useT();
  const bridge = useMemo(getBrowserBridge, []);
  const snapshot = useBrowserSnapshot(bridge);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayOpen = useAnyOverlayOpen();
  const [menuOpen, setMenuOpen] = useState(false);
  const [frozen, setFrozen] = useState<string | null>(null);
  const active = snapshot.tabs.find((tab) => tab.id === snapshot.activeId) ?? null;

  // Show the active page over the viewport and keep its bounds in sync; hide
  // it while a full-window overlay (Settings, Language…) is open — a native
  // view always draws above the page and would cover the overlay.
  useEffect(() => {
    const el = viewportRef.current;
    if (!bridge || !el) return;
    if (overlayOpen) {
      bridge.hide();
      return;
    }
    const rectOf = (): BrowserBounds => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    let last = "";
    const sync = () => {
      const b = rectOf();
      const key = `${b.x},${b.y},${b.width},${b.height}`;
      if (key === last) return;
      last = key;
      bridge.setBounds(b);
    };
    void bridge.show(rectOf());
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    // The viewport can move without resizing (e.g. the sidebar sliding).
    const poll = window.setInterval(sync, 250);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.clearInterval(poll);
      bridge.hide();
    };
  }, [bridge, overlayOpen]);

  // Toolbar menus open over the page area; swap the page for a screenshot
  // while one is open so the menu isn't hidden under the native view.
  useEffect(() => {
    if (!bridge) return;
    if (!menuOpen) {
      setFrozen(null);
      bridge.unfreeze();
      return;
    }
    let live = true;
    void bridge.freeze().then((image) => {
      if (live) setFrozen(image);
    });
    return () => {
      live = false;
    };
  }, [bridge, menuOpen]);

  // Lets the main process handle browser shortcuts while focus is in the
  // toolbar (the page's own view handles them while the page has focus).
  useEffect(() => {
    const el = rootRef.current;
    if (!bridge || !el) return;
    const onIn = () => bridge.setFocused(true);
    const onOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) bridge.setFocused(false);
    };
    el.addEventListener("focusin", onIn);
    el.addEventListener("focusout", onOut);
    return () => {
      el.removeEventListener("focusin", onIn);
      el.removeEventListener("focusout", onOut);
      bridge.setFocused(false);
    };
  }, [bridge]);

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && expanded && !menuOpen && !e.defaultPrevented) onToggleExpand();
      }}
      className="flex h-full min-h-0 flex-col bg-[var(--m-bg)]"
    >
      {bridge && <TabStrip bridge={bridge} snapshot={snapshot} />}
      <Toolbar
        bridge={bridge}
        tab={active}
        downloads={snapshot.downloads}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        onClose={onClose}
        onMenuChange={setMenuOpen}
      />

      {/* The native page view is positioned over this element. */}
      <div ref={viewportRef} className="relative min-h-0 flex-1">
        {!bridge && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <GlobeIcon className="h-8 w-8 text-[var(--m-text-faint)]" />
            <p className="max-w-[280px] text-[13px] text-[var(--m-text-muted)]">{t("browser.desktopOnly")}</p>
          </div>
        )}
        {bridge && active?.error && <ErrorState error={active.error} onRetry={() => bridge.command(active.id, "retry")} />}
        {frozen && menuOpen && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frozen} alt="" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full object-cover object-left-top" />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Remove the old panel and update `ChatLayout.tsx`**

```bash
git rm app/components/marven/BrowserPanel.tsx
```

In `app/components/marven/ChatLayout.tsx`:

Replace the import (line 27):

```tsx
import { BrowserPanel } from "@/app/components/marven/BrowserPanel";
```

with:

```tsx
import { BrowserPanel } from "@/app/components/marven/browser/BrowserPanel";
```

After `const [browserOpen, setBrowserOpen] = useState(false);` (line 273) add:

```tsx
  const [browserExpanded, setBrowserExpanded] = useState(false);
```

In the chat branch, the wrapper is currently:

```tsx
<div className="flex min-h-0 flex-1 overflow-hidden"><div className="flex min-w-0 flex-1 flex-col">
```

Change the inner div's `className` to:

```tsx
className={`flex min-w-0 flex-1 flex-col ${browserOpen && browserExpanded ? "hidden" : ""}`}
```

Replace the browser `aside` (lines ~598–602):

```tsx
            {browserOpen && (
              <aside className="flex w-1/2 min-w-[360px] flex-col border-s border-[var(--m-border)]">
                <BrowserPanel onClose={() => setBrowserOpen(false)} />
              </aside>
            )}
```

with:

```tsx
            {browserOpen && (
              <aside
                className={
                  browserExpanded
                    ? "flex min-w-0 flex-1 flex-col"
                    : "flex w-1/2 min-w-[360px] flex-col border-s border-[var(--m-border)]"
                }
              >
                <BrowserPanel
                  expanded={browserExpanded}
                  onToggleExpand={() => setBrowserExpanded((v) => !v)}
                  onClose={() => {
                    setBrowserOpen(false);
                    setBrowserExpanded(false);
                  }}
                />
              </aside>
            )}
```

And in the globe button's `onClick` (line ~434), collapse when closing:

```tsx
                      onClick={() => {
                        setBrowserOpen((v) => !v);
                        setBrowserExpanded(false);
                      }}
```

- [ ] **Step 9: Typecheck and run the suite**

Run: `npm run typecheck`
Expected: no output after the `tsc` line (exit 0).

Run: `npx vitest run`
Expected: everything passes except the 2 known `lib/storage.test.ts` failures.

- [ ] **Step 10: Commit**

```bash
git add app/components/marven/browser app/components/marven/ChatLayout.tsx
git commit -m "Add tabs, bookmarks, downloads and a full-width view to the browser panel"
```

---

### Task 16: Clear browsing data in Settings

**Files:**
- Modify: `app/components/marven/SettingsModal.tsx` (imports, state near line 323, and the General section after the system-prompt block ending ~line 951)

- [ ] **Step 1: Add the import**

Next to the other `@/lib` imports at the top:

```tsx
import { getBrowserBridge } from "@/lib/inAppBrowser";
```

- [ ] **Step 2: Add state**

After `const [systemPromptDraft, setSystemPromptDraft] = useState("");` (line 323):

```tsx
  const browserBridge = useMemo(getBrowserBridge, []);
  const [browsingDataState, setBrowsingDataState] = useState<"idle" | "clearing" | "cleared">("idle");
```

If `useMemo` is not already imported from `react` in this file, add it to the existing `react` import.

- [ ] **Step 3: Add the block after the system-prompt `</div>` and before `{/* Theme selector — visual preview tiles */}`**

```tsx
            {/* In-app browser data */}
            {browserBridge && (
              <div>
                <h3 className="mb-1 text-[13px] font-medium text-[var(--m-text)]">{tr("settings.general.browsingData")}</h3>
                <p className="mb-3 text-[11px] text-[var(--m-text-faint)]">{tr("settings.general.browsingDataHint")}</p>
                <button
                  type="button"
                  disabled={browsingDataState === "clearing"}
                  onClick={async () => {
                    setBrowsingDataState("clearing");
                    await browserBridge.clearBrowsingData();
                    setBrowsingDataState("cleared");
                  }}
                  className="rounded-md border border-[var(--m-border)] px-3 py-1 text-[11px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-2)] disabled:opacity-50"
                >
                  {browsingDataState === "cleared" ? tr("settings.general.browsingDataCleared") : tr("settings.general.clearBrowsingData")}
                </button>
              </div>
            )}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/components/marven/SettingsModal.tsx
git commit -m "Add a Clear browsing data button to Settings"
```

---

### Task 17: Verify in the real Electron app

**Files:**
- Create (scratch, not committed): `$SCRATCH/browser-e2e.mjs` where `$SCRATCH` is the session scratchpad directory

This drives the running app over CDP. The renderer target is the page on `http://localhost:3000`; the browser bridge is called directly so the checks don't depend on pixel positions. The main process is inspected through `--inspect=9401` to read view visibility and bounds.

- [ ] **Step 1: Start the Next dev server if it isn't running, then launch Electron with debugging and a test downloads folder**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000 || npm run dev &
```

```bash
mkdir -p "$SCRATCH/downloads" && MARVEN_DOWNLOADS_DIR="$SCRATCH/downloads" NODE_ENV=development ./node_modules/.bin/electron --inspect=9401 . --remote-debugging-port=9400 > "$SCRATCH/electron.log" 2>&1 &
```

Wait until `curl -s http://127.0.0.1:9400/json/list | grep -q localhost:3000` succeeds.

- [ ] **Step 2: Write `$SCRATCH/browser-e2e.mjs`**

```js
// Drives Marven's in-app browser over CDP and prints PASS/FAIL per check.
const PORT = 9400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 180000);

async function connect(match) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const target = targets.find((t) => t.type === "page" && match(t.url));
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { ws, evaluate };
}

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};

const app = await connect((url) => url.startsWith("http://localhost:3000"));
const B = "window.marvenElectron.browser";
const snap = () => app.evaluate(`${B}.snapshot()`);

// Open the panel from the globe.
await app.evaluate(`document.querySelector('button[aria-label="Browser"]').click()`);
await sleep(3000);
let s = await snap();
check("panel opens with at least one tab", s.tabs.length >= 1, `${s.tabs.length} tabs`);

// New tab, navigate, switch, close, reopen.
const id = await app.evaluate(`${B}.newTab("https://example.com/")`);
await sleep(3000);
s = await snap();
const created = s.tabs.find((t) => t.id === id);
check("new tab loads example.com", created?.url === "https://example.com/" && created.title === "Example Domain", JSON.stringify(created));
check("new tab is active", s.activeId === id);
const first = s.tabs[0].id;
await app.evaluate(`${B}.activateTab(${JSON.stringify(first)})`);
await sleep(500);
check("switching tabs", (await snap()).activeId === first);
await app.evaluate(`${B}.closeTab(${JSON.stringify(id)})`);
await sleep(500);
s = await snap();
check("closing a tab", !s.tabs.some((t) => t.id === id) && s.canReopenClosed);
await app.evaluate(`${B}.reopenClosedTab()`);
await sleep(3000);
s = await snap();
check("reopening a closed tab", s.tabs.some((t) => t.url === "https://example.com/"));

// Bookmarks and suggestions.
const bookmarked = await app.evaluate(`${B}.toggleBookmark("https://example.com/", "Example Domain")`);
check("bookmarking", bookmarked === true);
const sugg = await app.evaluate(`${B}.suggest("example")`);
check("suggestions include the bookmark", sugg[0]?.kind === "bookmark" && sugg[0].url === "https://example.com/", JSON.stringify(sugg));
await app.evaluate(`${B}.toggleBookmark("https://example.com/", "Example Domain")`);

// Blocking: a page with third-party ads/trackers.
const adTab = await app.evaluate(`${B}.newTab("https://www.theverge.com/")`);
await sleep(10000);
s = await snap();
const ad = s.tabs.find((t) => t.id === adTab);
check("blocked count > 0 on an ad-heavy page", (ad?.blocked ?? 0) > 0, `blocked=${ad?.blocked}`);
await app.evaluate(`${B}.closeTab(${JSON.stringify(adTab)})`);

// Error states.
const badCert = await app.evaluate(`${B}.newTab("https://expired.badssl.com/")`);
await sleep(5000);
s = await snap();
check("bad certificate shows an error", s.tabs.find((t) => t.id === badCert)?.error?.kind === "certificate");
await app.evaluate(`${B}.closeTab(${JSON.stringify(badCert)})`);
const unreachable = await app.evaluate(`${B}.newTab("https://no-such-host.invalid/")`);
await sleep(4000);
s = await snap();
check("unknown host shows an error", s.tabs.find((t) => t.id === unreachable)?.error?.kind === "unreachable");
await app.evaluate(`${B}.closeTab(${JSON.stringify(unreachable)})`);

// Download a small file into the test folder.
const dl = await app.evaluate(`${B}.newTab("https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf")`);
await sleep(6000);
s = await snap();
check("download completes", s.downloads.some((d) => d.state === "completed" && d.filename.endsWith(".pdf")), JSON.stringify(s.downloads));
if (s.tabs.some((t) => t.id === dl)) await app.evaluate(`${B}.closeTab(${JSON.stringify(dl)})`);

// Page isolation.
const page = await connect((url) => url.startsWith("https://example.com"));
check("page has no Node or Marven bridge", (await page.evaluate("typeof require + '/' + typeof window.marvenElectron")) === "undefined/undefined");
page.ws.close();

// Expand toggle: the viewport grows.
const width = () => app.evaluate(`Math.round([...document.querySelectorAll('aside .relative.min-h-0.flex-1')].pop().getBoundingClientRect().width)`);
const before = await width();
await app.evaluate(`document.querySelector('button[aria-label="Expand browser"]').click()`);
await sleep(800);
const after = await width();
check("expand makes the browser wider", after > before + 100, `${before} → ${after}`);
await app.evaluate(`document.querySelector('button[aria-label="Back to side panel"]').click()`);
await sleep(500);

app.ws.close();
console.log(failures === 0 ? "ALL PASSED" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
```

- [ ] **Step 3: Run it**

Run: `node "$SCRATCH/browser-e2e.mjs"`
Expected: every line `PASS`, ending with `ALL PASSED`. If the ad-blocking check fails on the first launch, the filter lists may still be downloading — wait 30s and rerun; `ls ~/Library/Application\ Support/marven/browser/adblock.bin` (the folder name follows the app's `productName`) should exist afterwards.

- [ ] **Step 4: Check the native view position against the viewport (main-process inspector)**

Reuse the previous session's `mainprobe.mjs` approach: connect to `ws://127.0.0.1:9401` (from `http://127.0.0.1:9401/json/list`), evaluate

```js
(() => { const { BrowserWindow } = process.mainModule.require('electron'); const win = BrowserWindow.getAllWindows()[0]; return win.contentView.children.map((v) => ({ visible: v.getVisible(), bounds: v.getBounds(), url: v.webContents.getURL() })); })()
```

Expected: exactly one child view, `visible: true`, and bounds equal to the viewport rect printed by `document.querySelector('aside .relative.min-h-0.flex-1').getBoundingClientRect()` in the renderer (rounded). Open Settings → the view reports `visible: false`; close it → `visible: true`. Open the bookmarks menu → `visible: false` and the renderer shows the screenshot `<img>`; close it → `visible: true`.

- [ ] **Step 5: Restart restore**

Quit Electron (`pkill -f "electron.*--inspect=9401"`), confirm `browser/tabs.json` lists the open tabs, relaunch with the Step 1 command, open the panel, and check with the snapshot that the same tabs come back with only the active one loaded: `snapshot().tabs.filter(t => t.loading || t.canGoBack).length` is at most 1, and in the main-process probe only one `WebContentsView` exists.

- [ ] **Step 6: Arabic layout**

In the app, Account menu → Language → العربية. Open the browser: the panel sits on the left, tabs flow right-to-left, back/forward arrows are mirrored, the address bar text stays left-to-right, and the native view's bounds still match the viewport (repeat the Step 4 probe). Switch back to English.

- [ ] **Step 7: Quarantine flag on downloads**

Run: `xattr -p com.apple.quarantine "$SCRATCH/downloads/"*.pdf`
Expected: a quarantine value is printed. If it isn't, note it in the PR description as a known gap (do not add code for it in this plan).

- [ ] **Step 8: Stop Electron**

```bash
pkill -f "electron.*--inspect=9401"
```

---

### Task 18: Pull request

- [ ] **Step 1: Final checks**

Run: `npm run typecheck && npx vitest run`
Expected: typecheck exit 0; tests pass except the 2 known `lib/storage.test.ts` failures.

- [ ] **Step 2: Push and open a PR stacked on PR #6**

```bash
git push -u origin feat/browser-tabs
gh pr create --repo ahomsi0/Marven --base feat/in-app-browser --head feat/browser-tabs \
  --title "Turn the in-app browser into a full browser: tabs, history, bookmarks, blocking, downloads"
```

The PR body covers: what's new (tabs, suggestions, bookmarks, blocking with per-site toggle, downloads, expand, shortcuts, restore, clear data), the security model (unchanged rules + IPC validation, favicons as data URLs, download name sanitising, no cosmetic filtering, core Ghostery engine instead of the Electron wrapper and why), the Task 17 results line by line, anything that failed or was skipped (including the quarantine check result), and that it's stacked on PR #6.

- [ ] **Step 3: Bind the PR in the app** (`get_status`, then `bind_pr` if it isn't reported).
