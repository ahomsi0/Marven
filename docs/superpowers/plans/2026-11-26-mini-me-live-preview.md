# Mini Me Live Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mini Me acts on what you tell him without choice buttons, queues what you add while he works, shows the site in a live preview window you open on demand, and keeps one history per project, which "Open in Marven" reuses.

**Architecture:** Pure helpers (routing, thread store, queue, window placement, CSP) carry the logic and the unit tests. `useCompanionBuild` runs jobs from a queue, with the project's thread as Agent history. A new Electron module owns one preview `BrowserWindow`, which loads the Marven page `/companion/preview` holding a toolbar and an iframe of the project served on `127.0.0.1` by `electron/projectServer.js`. The main window's hand-off reuses the Agent conversation already on the folder.

**Tech Stack:** Next.js 15 App Router, React 19, Electron 41, Vitest 4, Tailwind 4.

**Spec:** `docs/superpowers/specs/2026-11-26-mini-me-live-preview-design.md`

All paths below are relative to `apps/desktop/`. Run commands from there. Run tests with `npx vitest run <file>`, never `npm test`: its `pretest` rebuilds `better-sqlite3` for Node and breaks the running Electron app. Don't commit: the user commits.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `lib/companion/brain.ts` | modify | Routing: correction routes, `projectNameFor` |
| `lib/companion/project.ts` | modify | Current project + per-project thread store |
| `lib/companion/queue.ts` | create | Batching queued jobs into runs |
| `electron/companionGuards.js` | modify | Thread ids pass through; `edit` hand-off option removed |
| `electron/previewPlacement.js` | create | Where the preview window goes (pure) |
| `electron/appCsp.js` | modify | `frame-src http://127.0.0.1:*` for `/companion/preview` only |
| `electron/previewWindow.js` | create | The preview `BrowserWindow` |
| `electron/previewPreload.js` | create | The preview page's bridge |
| `electron/companion.js` | modify | Preview IPC; `open-in-browser` IPC removed |
| `electron/companionPreload.js`, `lib/companion/bridge.ts` | modify | `showPreview`, `previewReload`, `onPreviewOpenInMarven` |
| `app/companion/preview/page.tsx` | create | Toolbar + live iframe |
| `hooks/useCompanionBuild.ts` | rewrite | Queue, history, thread, file-written callback |
| `hooks/useCompanionBrain.ts` | modify | No choice buttons; build/edit/correction callbacks |
| `app/companion/BuildCard.tsx`, `SpeechBubble.tsx` | modify | New working/done states |
| `app/companion/page.tsx` | modify | Wiring |
| `app/page.tsx` | modify | Hand-off reuses the folder's conversation |
| `lib/i18n/en.ts`, `lib/i18n/ar.ts` | modify | Strings |

---

### Task 1: Correction routes and project names

**Files:**
- Modify: `lib/companion/brain.ts`
- Test: `lib/companion/brain.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `brain.test.ts`, and add `projectNameFor` to its import list)

```ts
describe("corrections right after a run", () => {
  const after = { allowCommands: true, afterRun: true, project: { recent: true } };
  it("switches to a new project", () => {
    for (const t of ["no, make a new one", "start a new project", "make it a separate site", "a new one instead", "No. New project!"]) {
      expect(routeInput(t, after), t).toEqual({ kind: "new-instead" });
    }
  });
  it("answers in chat instead", () => {
    expect(routeInput("no, just tell me", after)).toEqual({ kind: "chat-instead" });
    expect(routeInput("don't build it", after)).toEqual({ kind: "chat-instead" });
  });
  it("stops", () => {
    expect(routeInput("stop", after)).toEqual({ kind: "stop" });
    expect(routeInput("cancel!", after)).toEqual({ kind: "stop" });
  });
  it("only right after a run", () => {
    const idle = { allowCommands: true };
    expect(routeInput("no, make a new one", idle).kind).not.toBe("new-instead");
    expect(routeInput("stop", idle).kind).not.toBe("stop");
  });
  it("a new request with details is a build, not a correction", () => {
    expect(routeInput("make another site for my cafe", after)).toEqual({ kind: "build", name: "site cafe" });
  });
});

describe("projectNameFor", () => {
  it("uses the build name, else the first words", () => {
    expect(projectNameFor("make a portfolio website for James Doe")).toBe("portfolio website james doe");
    expect(projectNameFor("red background, bigger title")).toBe("red background bigger title");
    expect(projectNameFor("   ")).toBe("project");
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/companion/brain.test.ts`
Expected: FAIL (`projectNameFor` is not exported; routes come back as `chat`/`build`)

- [ ] **Step 3: Implement** in `brain.ts`

Add to the `Route` union:

```ts
  /** Right after a run: start the previous request as a new project instead. */
  | { kind: "new-instead" }
  /** Right after a run: answer the previous request in chat instead. */
  | { kind: "chat-instead" }
  /** Stop the run (and the queue). */
  | { kind: "stop" }
```

Add above `routeInput`:

```ts
// Said right after Mini Me started (or finished) a run from your previous
// message. A new request with details ("make another site for my cafe") is
// not a correction: the noun must end the sentence.
const NEW_INSTEAD =
  /^\s*(?:no[,.!]?\s+)?(?:(?:please|actually)[\s,]+)?(?:(?:make|start|create|build|do)\s+(?:(?:it|that)\s+(?:as\s+)?)?(?:a\s+)?)?(?:a\s+)?(?:brand[\s-]+)?(?:new|separate|another|different)\s+(?:one|project|site|website|page|app)(?:\s+instead)?[\s.!]*$/i;
const CHAT_INSTEAD = /^\s*(?:no[,.!]?\s+)?(?:just\s+(?:tell\s+me|answer|explain)|don(?:'|’)?t\s+(?:build|make|change|do)\s+(?:it|that|anything))\b/i;
const STOP = /^\s*(?:stop|cancel|never\s*mind|nevermind|hold\s+on)\b[\s.!]*$/i;

/** A short name for a project made from `text`: its build name, else its first words. */
export function projectNameFor(text: string): string {
  const built = detectBuild(text);
  if (built) return built;
  const name = words(text).filter((w) => !NAME_FILLER.has(w.toLowerCase())).slice(0, 4).join(" ").toLowerCase();
  return name || "project";
}
```

In `routeInput`, add `afterRun?: boolean` to `opts` (doc comment: "Mini Me is working on, or just finished, a run started from the previous message.") and check it first:

```ts
  if (opts.afterRun) {
    if (STOP.test(text)) return { kind: "stop" };
    if (NEW_INSTEAD.test(text)) return { kind: "new-instead" };
    if (CHAT_INSTEAD.test(text)) return { kind: "chat-instead" };
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/companion/brain.test.ts`
Expected: PASS

### Task 2: Per-project thread store

**Files:**
- Modify: `lib/companion/project.ts`
- Test: `lib/companion/project.test.ts`

- [ ] **Step 1: Write the failing tests** (append; extend the import with `THREADS_KEY, THREAD_LIMIT, THREAD_PROJECTS, appendThread, loadThread, forgetProject, PROJECT_KEY`)

```ts
describe("project threads", () => {
  function store(initial: Record<string, string> = {}) {
    const data: Record<string, string> = { ...initial };
    return {
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => void (data[k] = v),
      removeItem: (k: string) => void delete data[k],
      data,
    };
  }
  it("appends with unique ids and keeps the last 20", () => {
    const s = store();
    for (let i = 0; i < 25; i++) appendThread(s, "/p/a", [{ role: "user", content: `m${i}` }], 1000 + i);
    const t = loadThread(s, "/p/a");
    expect(t).toHaveLength(THREAD_LIMIT);
    expect(t[0].content).toBe("m5");
    expect(new Set(t.map((m) => m.id)).size).toBe(THREAD_LIMIT);
  });
  it("skips empty messages", () => {
    const s = store();
    expect(appendThread(s, "/p/a", [{ role: "assistant", content: "  " }], 1)).toEqual([]);
  });
  it("keeps the 10 most recently used projects", () => {
    const s = store();
    for (let i = 0; i < 12; i++) appendThread(s, `/p/${i}`, [{ role: "user", content: "x" }], i);
    expect(Object.keys(JSON.parse(s.data[THREADS_KEY]))).toHaveLength(THREAD_PROJECTS);
    expect(loadThread(s, "/p/0")).toEqual([]);
    expect(loadThread(s, "/p/11")).toHaveLength(1);
  });
  it("ignores malformed storage", () => {
    expect(loadThread(store({ [THREADS_KEY]: "{nope" }), "/p/a")).toEqual([]);
    expect(loadThread(store({ [THREADS_KEY]: JSON.stringify({ "/p/a": { at: 1, messages: [{ role: "x" }] } }) }), "/p/a")).toEqual([]);
  });
  it("forgets a project and its thread", () => {
    const s = store();
    saveProject(s, { root: "/p/a", name: "a", at: 1 });
    appendThread(s, "/p/a", [{ role: "user", content: "x" }], 1);
    forgetProject(s, "/p/a");
    expect(loadProject(s)).toBeNull();
    expect(loadThread(s, "/p/a")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run lib/companion/project.test.ts` → FAIL (exports missing)

- [ ] **Step 3: Implement** (append to `project.ts`)

```ts
/** One message of a project's history, shared by Mini Me's runs and Marven's Agent conversation. */
export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export const THREADS_KEY = "marven-companion-threads";
export const THREAD_LIMIT = 20;
export const THREAD_PROJECTS = 10;
const MAX_CONTENT = 20_000;

interface StoredThread {
  at: number;
  messages: ThreadMessage[];
}

function isThreadMessage(value: unknown): value is ThreadMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return typeof m.id === "string" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string";
}

function readThreads(storage: Pick<Storage, "getItem">): Record<string, StoredThread> {
  try {
    const raw = storage.getItem(THREADS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, StoredThread> = {};
    for (const [root, value] of Object.entries(parsed as Record<string, unknown>)) {
      const t = value as { at?: unknown; messages?: unknown } | null;
      if (!t || typeof t.at !== "number" || !Array.isArray(t.messages)) continue;
      out[root] = { at: t.at, messages: t.messages.filter(isThreadMessage).slice(-THREAD_LIMIT) };
    }
    return out;
  } catch {
    return {};
  }
}

/** The project's history (oldest first), or [] when there is none. */
export function loadThread(storage: Pick<Storage, "getItem">, root: string): ThreadMessage[] {
  return readThreads(storage)[root]?.messages ?? [];
}

/** Adds messages to the project's history (empty ones skipped) and returns it. */
export function appendThread(
  storage: Pick<Storage, "getItem" | "setItem">,
  root: string,
  messages: { role: "user" | "assistant"; content: string }[],
  now: number = Date.now(),
): ThreadMessage[] {
  const all = readThreads(storage);
  const prev = all[root]?.messages ?? [];
  const added = messages
    .filter((m) => m.content.trim())
    .map((m, i) => ({ id: `minime-${now.toString(36)}-${prev.length + i + 1}`, role: m.role, content: m.content.slice(0, MAX_CONTENT) }));
  if (added.length === 0) return prev;
  const next = [...prev, ...added].slice(-THREAD_LIMIT);
  all[root] = { at: now, messages: next };
  const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, THREAD_PROJECTS);
  try {
    storage.setItem(THREADS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* quota errors are non-fatal */
  }
  return next;
}

/** The project's folder is gone: drop it as the current project and drop its history. */
export function forgetProject(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">, root: string): void {
  try {
    if (loadProject(storage)?.root === root) storage.removeItem(PROJECT_KEY);
    const all = readThreads(storage);
    if (all[root]) {
      delete all[root];
      storage.setItem(THREADS_KEY, JSON.stringify(all));
    }
  } catch {
    /* non-fatal */
  }
}
```

- [ ] **Step 4: Run the tests** → PASS

### Task 3: Queue batching

**Files:**
- Create: `lib/companion/queue.ts`
- Test: `lib/companion/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { editRequestText, takeNext, type QueuedJob } from "./queue";

describe("takeNext", () => {
  it("batches consecutive changes", () => {
    const q: QueuedJob[] = [
      { kind: "edit", request: "red background" },
      { kind: "edit", request: "bigger title" },
      { kind: "build", request: "make a quiz app", name: "quiz app" },
      { kind: "edit", request: "add a timer" },
    ];
    const first = takeNext(q)!;
    expect(first.job).toEqual({ kind: "edit", requests: ["red background", "bigger title"] });
    const second = takeNext(first.rest)!;
    expect(second.job).toEqual({ kind: "build", request: "make a quiz app", name: "quiz app" });
    expect(takeNext(second.rest)!.job).toEqual({ kind: "edit", requests: ["add a timer"] });
  });
  it("is null when empty", () => {
    expect(takeNext([])).toBeNull();
  });
});

describe("editRequestText", () => {
  it("passes one change through and numbers several", () => {
    expect(editRequestText(["red background"])).toBe("red background");
    expect(editRequestText(["red background", "bigger title"])).toBe("Make these changes:\n1. red background\n2. bigger title");
  });
});
```

- [ ] **Step 2: Run it** → FAIL (module missing)

- [ ] **Step 3: Implement** `lib/companion/queue.ts`

```ts
// What Mini Me does next when a run ends: queued changes to the current
// project run together, a new project runs on its own. Pure.

export type QueuedJob = { kind: "build"; request: string; name: string } | { kind: "edit"; request: string };
export type Job = { kind: "build"; request: string; name: string } | { kind: "edit"; requests: string[] };

/** The next run from the front of the queue, and what's left. */
export function takeNext(queue: QueuedJob[]): { job: Job; rest: QueuedJob[] } | null {
  if (queue.length === 0) return null;
  const [first, ...rest] = queue;
  if (first.kind === "build") return { job: first, rest };
  const requests = [first.request];
  let i = 0;
  while (i < rest.length) {
    const next = rest[i];
    if (next.kind !== "edit") break;
    requests.push(next.request);
    i++;
  }
  return { job: { kind: "edit", requests }, rest: rest.slice(i) };
}

/** The request the Agent gets for a batch of changes. */
export function editRequestText(requests: string[]): string {
  if (requests.length === 1) return requests[0];
  return `Make these changes:\n${requests.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;
}
```

- [ ] **Step 4: Run it** → PASS

### Task 4: Hand-off guards

**Files:**
- Modify: `electron/companionGuards.js`
- Test: `electron/companionGuards.test.ts`

- [ ] **Step 1: Tests.** Replace the `"keeps an edit of a project folder…"` test with:

```ts
  it("ignores an edit option (there is no change hand-off any more)", () => {
    const withFiles = { ...deps, readdir: () => ["index.html"] };
    expect(sanitizeOpenOptions({ workspaceRoot: root, edit: true }, "agent", "~/Marven Projects", withFiles)).toEqual({ workspaceRoot: root });
  });
```

and add to the `sanitizeThreadMessages` describe:

```ts
  it("keeps a short id, drops anything else", () => {
    expect(sanitizeThreadMessages([{ role: "user", content: "a", id: "minime-abc-1" }])).toEqual([{ role: "user", content: "a", id: "minime-abc-1" }]);
    expect(sanitizeThreadMessages([{ role: "user", content: "a", id: "x".repeat(101) }])).toEqual([{ role: "user", content: "a" }]);
    expect(sanitizeThreadMessages([{ role: "user", content: "a", id: "bad id!" }])).toEqual([{ role: "user", content: "a" }]);
  });
```

- [ ] **Step 2: Run** `npx vitest run electron/companionGuards.test.ts` → FAIL

- [ ] **Step 3: Implement.** In `sanitizeThreadMessages` replace the push with:

```js
    const msg = { role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) };
    if (typeof m.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(m.id)) msg.id = m.id;
    out.push(msg);
```

and update its doc comment ("…`{ role, content }` messages (plus a short `id` when present)…"). Delete the `options.edit` block in `sanitizeOpenOptions`.

- [ ] **Step 4: Run** → PASS

### Task 5: Preview placement

**Files:**
- Create: `electron/previewPlacement.js`, `electron/previewPlacement.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { previewBounds, PREVIEW_SIZE } = require("./previewPlacement");

const wa = { x: 0, y: 25, width: 1440, height: 875 };

describe("previewBounds", () => {
  it("goes on the side with more room, bottom-aligned with Mini Me", () => {
    const left = previewBounds({ x: 100, y: 600, width: 360, height: 280 }, wa);
    expect(left.x).toBe(100 + 360 + 12);
    expect(left.y + left.height).toBe(880);
    const right = previewBounds({ x: 1000, y: 600, width: 360, height: 280 }, wa);
    expect(right.x).toBe(1000 - 12 - PREVIEW_SIZE.width);
  });
  it("stays inside the work area", () => {
    const b = previewBounds({ x: 1300, y: 860, width: 360, height: 280 }, wa);
    expect(b.x).toBeGreaterThanOrEqual(wa.x + 12);
    expect(b.y + b.height).toBeLessThanOrEqual(wa.y + wa.height - 12);
  });
  it("shrinks on a tiny screen", () => {
    const b = previewBounds({ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 300, height: 200 });
    expect(b.width).toBe(276);
    expect(b.height).toBe(176);
  });
});
```

- [ ] **Step 2: Run** → FAIL

- [ ] **Step 3: Implement** `electron/previewPlacement.js`

```js
// Where Mini Me's preview window opens: beside the companion window, on the
// side with more room, bottom-aligned with it, inside the display's work area.
// Pure, so it can be unit-tested.

const PREVIEW_SIZE = { width: 420, height: 300 };
const MARGIN = 12;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {{ x: number, y: number, width: number, height: number }} companion
 * @param {{ x: number, y: number, width: number, height: number }} workArea
 */
function previewBounds(companion, workArea, size = PREVIEW_SIZE) {
  const width = Math.min(size.width, workArea.width - 2 * MARGIN);
  const height = Math.min(size.height, workArea.height - 2 * MARGIN);
  const roomRight = workArea.x + workArea.width - (companion.x + companion.width);
  const roomLeft = companion.x - workArea.x;
  const x = roomRight >= roomLeft ? companion.x + companion.width + MARGIN : companion.x - MARGIN - width;
  const y = companion.y + companion.height - height;
  return {
    x: Math.round(clamp(x, workArea.x + MARGIN, workArea.x + workArea.width - MARGIN - width)),
    y: Math.round(clamp(y, workArea.y + MARGIN, workArea.y + workArea.height - MARGIN - height)),
    width,
    height,
  };
}

module.exports = { previewBounds, PREVIEW_SIZE };
```

- [ ] **Step 4: Run** → PASS

### Task 6: CSP for the preview page

**Files:**
- Modify: `electron/appCsp.js`, `electron/appCsp.test.ts`

- [ ] **Step 1: Failing test** (append to `appCsp.test.ts`, using its existing `withAppCsp` import)

```ts
describe("the Mini Me preview page", () => {
  const opts = { appOrigin: "http://localhost:3000", csp: "default-src 'self'; frame-ancestors 'none'" };
  it("may frame the project server on 127.0.0.1", () => {
    const h = withAppCsp("http://localhost:3000/companion/preview?u=x", {}, opts);
    expect(h["Content-Security-Policy"][0]).toContain("frame-src http://127.0.0.1:*");
  });
  it("other pages may not", () => {
    for (const url of ["http://localhost:3000/companion", "http://localhost:3000/", "http://localhost:3000/companion/previewx"]) {
      expect(withAppCsp(url, {}, opts)["Content-Security-Policy"][0]).not.toContain("frame-src");
    }
  });
});
```

- [ ] **Step 2: Run** `npx vitest run electron/appCsp.test.ts` → FAIL

- [ ] **Step 3: Implement.** In `appCsp.js`:

```js
// Mini Me's preview window shows the project server (electron/projectServer.js,
// 127.0.0.1 only) in an iframe; only that page may frame it.
const MINI_ME_PREVIEW_PAGE = '/companion/preview';

function isMiniMePreviewPage(url, appOrigin) {
  if (!url.startsWith(appOrigin)) return false;
  try {
    return new URL(url).pathname === MINI_ME_PREVIEW_PAGE;
  } catch {
    return false;
  }
}
```

and in `withAppCsp` replace `return { ...headers, 'Content-Security-Policy': [csp] };` with:

```js
    const policy = isMiniMePreviewPage(url, appOrigin) ? `${csp}; frame-src http://127.0.0.1:*` : csp;
    return { ...headers, 'Content-Security-Policy': [policy] };
```

- [ ] **Step 4: Run** → PASS

### Task 7: Preview window and IPC

**Files:**
- Create: `electron/previewWindow.js`, `electron/previewPreload.js`
- Modify: `electron/companion.js`, `electron/companionPreload.js`, `lib/companion/bridge.ts`

- [ ] **Step 1: `electron/previewWindow.js`**

```js
// Mini Me's preview: one small window showing a project folder served on
// 127.0.0.1 (electron/projectServer.js). It loads Marven's /companion/preview
// page (toolbar + iframe), never anything else.
const { BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { previewBounds } = require('./previewPlacement');

const MAX_NAME = 80;

function createPreviewWindow({ appPort }) {
  const appOrigin = `http://localhost:${appPort}`;
  let win = null;
  let current = null; // { root, url, name }

  const alive = () => !!win && !win.isDestroyed();
  const hasIndex = () => {
    try {
      return !!current && fs.statSync(path.join(current.root, 'index.html')).isFile();
    } catch {
      return false;
    }
  };
  const pageUrl = () => {
    const q = new URLSearchParams({ u: current.url, n: current.name, ready: hasIndex() ? '1' : '0' });
    return `${appOrigin}/companion/preview?${q}`;
  };
  const isPreviewPage = (target) => {
    try {
      const u = new URL(target);
      return u.origin === appOrigin && u.pathname === '/companion/preview';
    } catch {
      return false;
    }
  };

  /** Show `project` (a checked folder and its server address), beside `companionBounds` the first time. */
  function show(project, companionBounds) {
    current = { root: project.root, url: project.url, name: String(project.name || '').slice(0, MAX_NAME) };
    if (!alive()) {
      const display = companionBounds ? screen.getDisplayMatching(companionBounds) : screen.getPrimaryDisplay();
      const anchor = companionBounds || { x: display.workArea.x, y: display.workArea.y + display.workArea.height, width: 0, height: 0 };
      win = new BrowserWindow({
        ...previewBounds(anchor, display.workArea),
        minWidth: 280,
        minHeight: 200,
        frame: false,
        show: false,
        title: current.name || 'Preview',
        backgroundColor: '#1e1e1e',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: path.join(__dirname, 'previewPreload.js'),
        },
      });
      const w = win;
      const block = (event, target) => {
        if (!isPreviewPage(target)) event.preventDefault();
      };
      w.webContents.on('will-navigate', block);
      w.webContents.on('will-redirect', block);
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.once('ready-to-show', () => w.show());
      w.on('closed', () => {
        if (win === w) win = null;
      });
    } else {
      win.setTitle(current.name || 'Preview');
      win.show();
      win.focus();
    }
    win.loadURL(pageUrl());
  }

  /** Files changed: the page reloads its frame (and learns whether index.html exists yet). */
  function reload() {
    if (alive()) win.webContents.send('preview:reload', { hasIndex: hasIndex() });
  }

  function close() {
    if (alive()) win.close();
  }

  const isSender = (event) => alive() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;

  return { show, reload, close, isSender, current: () => current };
}

module.exports = { createPreviewWindow };
```

- [ ] **Step 2: `electron/previewPreload.js`**

```js
// Preload for Mini Me's preview window: reload notices in, toolbar actions out.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marvenPreview', {
  onReload: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('preview:reload', handler);
    return () => ipcRenderer.removeListener('preview:reload', handler);
  },
  openInBrowser: () => ipcRenderer.send('preview:open-browser'),
  openFolder: () => ipcRenderer.send('preview:open-folder'),
  openInMarven: () => ipcRenderer.send('preview:open-in-marven'),
  close: () => ipcRenderer.send('preview:close'),
});
```

- [ ] **Step 3: IPC in `electron/companion.js`.** Require `const { createPreviewWindow } = require('./previewWindow');`. Inside `createCompanion`, after `const url = …`, add `const preview = createPreviewWindow({ appPort });`. Replace the `companion:open-in-browser` handler with:

```js
  // Show a project in the preview window: its folder (inside the projects
  // folder only) served read-only on 127.0.0.1. Resolves to the address, or null.
  ipcMain.handle('companion:preview-show', async (event, target, name) => {
    if (!fromCompanion(event)) return null;
    const real = projectFolderInside(target, settings.miniMeProjectsDir, { home: os.homedir(), realpath: fs.realpathSync.native, lstat: fs.lstatSync });
    if (!real) return null;
    const serverUrl = await projectServer.urlFor(real);
    if (!serverUrl) return null;
    preview.show({ root: real, url: serverUrl, name: typeof name === 'string' ? name : '' }, alive() ? win.getBounds() : null);
    return serverUrl;
  });
  ipcMain.on('companion:preview-reload', (event) => {
    if (fromCompanion(event)) preview.reload();
  });
  // The preview window's toolbar.
  ipcMain.on('preview:open-browser', (event) => {
    const p = preview.current();
    if (preview.isSender(event) && p && isLoopbackHttpUrl(p.url)) void shell.openExternal(p.url);
  });
  ipcMain.on('preview:open-folder', (event) => {
    const p = preview.current();
    if (!preview.isSender(event) || !p) return;
    const real = projectFolderInside(p.root, settings.miniMeProjectsDir, { home: os.homedir(), realpath: fs.realpathSync.native, lstat: fs.lstatSync });
    if (real) void shell.openPath(real);
  });
  ipcMain.on('preview:open-in-marven', (event) => {
    const p = preview.current();
    if (preview.isSender(event) && p && alive()) win.webContents.send('companion:preview-open-in-marven', p.root);
  });
  ipcMain.on('preview:close', (event) => {
    if (preview.isSender(event)) preview.close();
  });
```

In `destroy()`, add `preview.close();` before `if (alive()) win.destroy();`.

- [ ] **Step 4: `electron/companionPreload.js`.** Replace the `openInBrowser` line with:

```js
    showPreview: (root, name) => ipcRenderer.invoke('companion:preview-show', root, name).then((u) => (typeof u === 'string' ? u : null), () => null),
    previewReload: () => ipcRenderer.send('companion:preview-reload'),
    onPreviewOpenInMarven: subscribe('companion:preview-open-in-marven'),
```

- [ ] **Step 5: `lib/companion/bridge.ts`.** Replace the `openInBrowser` member with:

```ts
  /** Show a project folder (inside the projects folder) in the preview window, served on 127.0.0.1; resolves to its address, or null. */
  showPreview(root: string, name: string): Promise<string | null>;
  /** The project's files changed: the preview window (if open) reloads. */
  previewReload(): void;
  /** The preview window's "Open in Marven" was pressed for this project folder. */
  onPreviewOpenInMarven(cb: (root: string) => void): Unsubscribe;
```

Remove `edit?: boolean` from `openInMarven`'s options type and the sentence about `edit` from its comment.

- [ ] **Step 6:** `npm run typecheck` will fail until Task 12 updates the page. Carry on.

### Task 8: Preview page

**Files:**
- Create: `app/companion/preview/page.tsx`
- Modify: `lib/i18n/en.ts`, `lib/i18n/ar.ts`

- [ ] **Step 1: Strings.** Add under `companion` in `en.ts`:

```ts
    preview: {
      waiting: "Waiting for the first page…",
      invalid: "Nothing to preview.",
      reload: "Reload",
      openInBrowser: "Open in browser",
      openInMarven: "Open in Marven",
      openFolder: "Open folder",
      close: "Close",
    },
```

and in `ar.ts`:

```ts
    preview: {
      waiting: "بانتظار الصفحة الأولى…",
      invalid: "لا شيء لمعاينته.",
      reload: "إعادة التحميل",
      openInBrowser: "فتح في المتصفح",
      openInMarven: "فتح في Marven",
      openFolder: "فتح المجلد",
      close: "إغلاق",
    },
```

- [ ] **Step 2: `app/companion/preview/page.tsx`**

```tsx
"use client";

// Mini Me's preview window: a toolbar and the project, served on 127.0.0.1 by
// Marven (electron/projectServer.js), in a sandboxed frame that reloads
// whenever Mini Me writes a file.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";

interface PreviewBridge {
  onReload(cb: (state: { hasIndex?: unknown } | null) => void): () => void;
  openInBrowser(): void;
  openFolder(): void;
  openInMarven(): void;
  close(): void;
}

const LOOPBACK_ROOT = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/$/;

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--m-text-muted)] hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text)]"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {children}
    </button>
  );
}

const icon = "h-3.5 w-3.5";

export default function PreviewPage() {
  const { t } = useT();
  const bridge = useMemo(
    () => (typeof window === "undefined" ? null : ((window as unknown as { marvenPreview?: PreviewBridge }).marvenPreview ?? null)),
    [],
  );
  const [state, setState] = useState<{ url: string; name: string; hasIndex: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const url = q.get("u") ?? "";
    if (!LOOPBACK_ROOT.test(url)) return;
    setState({ url, name: (q.get("n") ?? "").slice(0, 80), hasIndex: q.get("ready") === "1" });
  }, []);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onReload((s) => {
      const hasIndex = s && typeof s.hasIndex === "boolean" ? s.hasIndex : undefined;
      setState((prev) => (prev && hasIndex !== undefined ? { ...prev, hasIndex } : prev));
      setNonce((n) => n + 1);
    });
  }, [bridge]);

  const host = state ? state.url.replace(/^http:\/\//, "").replace(/\/$/, "") : "";

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--m-bg)] text-[var(--m-text)]">
      <div
        className="flex h-[34px] shrink-0 items-center gap-1.5 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-2 text-[11.5px]"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <ToolButton label={t("companion.preview.close")} onClick={() => bridge?.close()}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </ToolButton>
        <ToolButton label={t("companion.preview.reload")} onClick={() => setNonce((n) => n + 1)}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" /></svg>
        </ToolButton>
        <div className="flex h-[22px] min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[var(--m-bg)] px-2 text-[var(--m-text-muted)]">
          <span className="min-w-0 truncate font-medium text-[var(--m-text)]">{state?.name}</span>
          {host && <span className="shrink-0 text-[var(--m-text-faint)]">{host}</span>}
        </div>
        <ToolButton label={t("companion.preview.openInBrowser")} onClick={() => bridge?.openInBrowser()}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></svg>
        </ToolButton>
        <ToolButton label={t("companion.preview.openInMarven")} onClick={() => bridge?.openInMarven()}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>
        </ToolButton>
        <ToolButton label={t("companion.preview.openFolder")} onClick={() => bridge?.openFolder()}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>
        </ToolButton>
      </div>
      {!state ? (
        <p className="m-auto text-[12px] text-[var(--m-text-faint)]">{t("companion.preview.invalid")}</p>
      ) : state.hasIndex ? (
        <iframe
          key={nonce}
          src={state.url}
          title={state.name || "Preview"}
          sandbox="allow-scripts allow-forms"
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <div className="m-auto flex items-center gap-2 text-[12px] text-[var(--m-text-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--m-accent)]" />
          {t("companion.preview.waiting")}
        </div>
      )}
    </main>
  );
}
```

### Task 9: Build hook: queue, history, thread

**Files:**
- Modify: `hooks/useCompanionBuild.ts`

- [ ] **Step 1: Strings.** In `companion.build` add (en / ar):

```ts
      showPreview: "Show preview",            // "عرض المعاينة"
      next: "Next: {{request}}",              // "التالي: {{request}}"
      previewFailed: "I couldn't show the preview.",  // "تعذّر عرض المعاينة."
      marvenBusy: "Marven's Agent is busy. Try again when it's done.", // "وكيل Marven مشغول. حاول مرة أخرى عندما ينتهي."
      projectGone: "The folder for {{name}} is gone, so the next site starts fresh.", // "مجلد {{name}} لم يعد موجودًا، لذا سيبدأ الموقع التالي من جديد."
      stoppedNote: "Stopped before finishing.",       // "توقّفت قبل الانتهاء."
      failedNote: "Didn't finish: {{error}}",         // "لم يكتمل: {{error}}"
```

- [ ] **Step 2: Change the hook.**
  - Import `appendThread, loadThread, type CompanionProject` from `@/lib/companion/project`, and `editRequestText, takeNext, type Job, type QueuedJob` from `@/lib/companion/queue`.
  - `BuildView`: delete `conflict`; add `queue: string[]` ("Queued requests, shown as 'Next: …'"). `BuildAttention` becomes `"approval" | "done" | "failed" | "blocked"`.
  - `Options`: add `getProject: () => CompanionProject | null`, `onProjectGone?: (root: string) => void` and `onFileWritten?: () => void`. Keep `onFolderReady` and `onDone`.
  - `FolderPrep`'s failure variant gets `gone?: boolean`. In the reopen branch of `prepareProjectFolder`, `res.status === 404` returns `{ ok: false, message: i18n.t("companion.build.error.reopen", { name }), settingsPage: null, blocked: false, gone: true }`.
  - Replace `start` / `stop` / `switchTo` / `keepGoing` with:

```ts
  const queueRef = useRef<QueuedJob[]>([]);
  const queueLabels = () => queueRef.current.map((j) => j.request);

  /** Runs one job; when it ends (done or failed, not stopped), the queue drains. */
  const run = useCallback(
    async (job: Job) => {
      const project = job.kind === "edit" ? optionsRef.current.getProject() : null;
      if (job.kind === "edit" && !project) return;
      const edit = job.kind === "edit";
      const request = job.kind === "edit" ? editRequestText(job.requests) : job.request;
      const name = job.kind === "edit" ? project!.name : job.name;
      const existingRoot = project?.root;
      const runId = ++runIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      const alive = () => runId === runIdRef.current && !controller.signal.aborted;
      commit({
        phase: "preparing", name, request, edit, root: null, steps: 0,
        label: { key: edit ? "companion.build.opening" : "companion.build.preparing", params: { name } },
        approval: null, queue: queueLabels(), summary: "", liveUrl: null, error: null, settingsPage: null, note: null,
      });
      let root: string | null = null;
      let settled: "done" | "failed" | null = null;
      const note = (content: string) => root && appendThread(localStorage, root, [{ role: "assistant", content }]);
      const fail = (message: string, settingsPage: CompanionSettingsPage | null = null, phase: BuildPhase = "failed") => {
        if (runId !== runIdRef.current) return;
        settled = "failed";
        note(i18n.t("companion.build.failedNote", { error: message }));
        patch(runId, { phase, error: message, settingsPage, approval: null, note: null });
        optionsRef.current.onAttention(phase === "blocked" ? "blocked" : "failed");
      };
      try {
        const prep = await prepareProjectFolder(name, optionsRef.current.projectsDir, controller.signal, existingRoot, { edit });
        if (!alive()) return;
        if (!prep.ok) {
          if (prep.gone && existingRoot) optionsRef.current.onProjectGone?.(existingRoot);
          fail(prep.message, prep.settingsPage, prep.blocked ? "blocked" : "failed");
          return;
        }
        root = prep.root;
        const runRoot = prep.root;
        const history = loadThread(localStorage, runRoot).map(({ role, content }) => ({ role, content }));
        appendThread(localStorage, runRoot, [{ role: "user", content: request }]);
        const safetyProfile = prep.profile === "trusted" ? "ask-before-command" : prep.profile;
        patch(runId, { root: runRoot, phase: "running", label: { key: "companion.build.planning" } });
        optionsRef.current.onFolderReady?.(runRoot, name);
        // … provider / model / memory exactly as before …
        // fetch body: prompt: buildPrompt(request, name, edit), history, (rest unchanged)
        // conversationId: `minime-${edit ? "edit" : "build"}-${Date.now()}`
        const tools = new Map<string, string>();
        // in consumeSse:
        //   tool_call:   tools.set(event.callId, event.tool); then as before
        //   tool_result: as before, plus: if (WRITE_TOOLS.has(tools.get(event.callId) ?? "")) optionsRef.current.onFileWritten?.();
        //   done:        settled = "done"; note(text || i18n.t(edit ? "companion.build.editDoneTitle" : "companion.build.doneTitle", { name }));
        //                patch(runId, { phase: "done", summary: text, liveUrl, approval: null, queue: queueLabels() }); onAttention("done");
        //                onDone({ request, name, root: runRoot, summary: text, edit }); say(…) as before
        //   error:       fail(...) as before
      } catch (err) {
        if (!alive()) return;
        fail(chatErrorMessage(err));
      } finally {
        if (abortRef.current === controller && runId === runIdRef.current) abortRef.current = null;
        // Done or failed (not stopped, not replaced): run what was asked for meanwhile.
        if (settled && runId === runIdRef.current) {
          const next = takeNext(queueRef.current);
          if (next) {
            queueRef.current = next.rest;
            void runRef.current(next.job);
          }
        }
      }
    },
    [commit, patch, say],
  );
  const runRef = useRef(run);
  runRef.current = run;

  /** Run a job now, or queue it behind the one that's running. */
  const submit = useCallback((job: QueuedJob) => {
    if (isBuildActive(viewRef.current)) {
      queueRef.current = [...queueRef.current, job];
      commit({ ...viewRef.current!, queue: queueLabels() });
      return;
    }
    const next = takeNext([...queueRef.current, job]);
    queueRef.current = next!.rest;
    void run(next!.job);
  }, [commit, run]);

  /** Stop the running job and drop the queue (a pending approval is denied first). */
  const stop = useCallback(() => {
    queueRef.current = [];
    const current = viewRef.current;
    if (!isBuildActive(current)) return false;
    if (current!.approval) void postApproval(current!.approval.callId, false);
    abortRef.current?.abort();
    abortRef.current = null;
    if (current!.root) appendThread(localStorage, current!.root, [{ role: "assistant", content: i18n.t("companion.build.stoppedNote") }]);
    commit({ ...current!, phase: "stopped", approval: null, queue: [] });
    return true;
  }, [commit]);
```

  - `WRITE_TOOLS` is `new Set(["write_file", "apply_patch"])` at the top of the file.
  - `clear()` drops the `conflict` handling. The hook returns `{ view, submit, stop, answer, clear }`.

### Task 10: Brain hook without choice buttons

**Files:**
- Modify: `hooks/useCompanionBrain.ts`

- [ ] **Step 1:** Remove `BuildChoice`, `BuildTarget`, `chooseBuild`, `askEdit`, `onBuildHere`, `onBuildInMarven`, the `build` field of `BrainReply`, and the `"build-choice"` / `"build-here"` actions. Add options:

```ts
  /** A new project to build from `request` (named `name`). */
  onBuild?: (request: string, name: string) => void;
  /** A change to the current project. */
  onEdit?: (request: string) => void;
  /** "No, make a new one" / "no, just tell me" / "stop", about `previous` (the last job's request). */
  onCorrection?: (kind: "new-instead" | "chat-instead" | "stop", previous: { request: string; kind: "build" | "edit" } | null) => void;
```

- [ ] **Step 2:** Track the last job: `const lastJobRef = useRef<{ request: string; kind: "build" | "edit" } | null>(null);`. In `send`, route with `afterRun: !sendOpts?.skipBuild && lastJobRef.current !== null`. Then:

```ts
    const startJob = (kind: "build" | "edit", name?: string) => {
      lastJobRef.current = { request: text, kind };
      setReply(null);
      setBusy(false);
      emit("thinking");
      if (kind === "build") optionsRef.current.onBuild?.(text, name ?? projectNameFor(text));
      else optionsRef.current.onEdit?.(text);
    };
    if (route.kind === "new-instead" || route.kind === "chat-instead" || route.kind === "stop") {
      const previous = lastJobRef.current;
      lastJobRef.current = null;
      setBusy(false);
      optionsRef.current.onCorrection?.(route.kind, previous);
      if (route.kind === "chat-instead" && previous) void sendRef.current(previous.request, { skipBuild: true });
      return;
    }
    if (route.kind === "build") return startJob("build", route.name);
    if (route.kind === "edit" && project) return startJob("edit");
    lastJobRef.current = null;
```

(`sendRef` holds `send`, so the callback can call itself.) Marker replies do the same: `resolved.kind === "edit" && project` → `startJob("edit")`, and `resolved.kind === "build"` → `startJob("build", resolved.name)`.

- [ ] **Step 3:** Add `forgetCurrentProject = useCallback(() => { const p = projectRef.current; projectRef.current = null; if (p) forgetProject(localStorage, p.root); }, [])` and `getProject = useCallback(() => projectRef.current, [])`. Return `{ reply, busy, send, retry, dismiss, history, announce, setProject, getProject, forgetCurrentProject, recordExchange }`.

### Task 11: Bubble and build card

**Files:**
- Modify: `app/companion/BuildCard.tsx`, `app/companion/SpeechBubble.tsx`

- [ ] **Step 1: `BuildCardHandlers`** becomes:

```ts
export interface BuildCardHandlers {
  onStop: () => void;
  onAnswer: (accept: boolean) => void;
  onShowPreview: () => void;
  onOpenInMarven: () => void;
  onOpenSettings: (page: CompanionSettingsPage) => void;
  onClose: () => void;
}
```

`buildCardTakesInput(view)` returns `!view.approval`.

- [ ] **Step 2: Working state** (no approval): header row (pulse, "Building/Changing <name>", step count), then the step line, then `view.queue.map(r => <p className="… truncate">{t("companion.build.next", { request: r })}</p>)`, then a row `[Show preview (quiet)] … [Stop (secondary)]`. The approval branch is unchanged. Delete the conflict branch.

- [ ] **Step 3: Done state:**

```tsx
<div>
  <div className="flex items-start gap-2">
    <p className="min-w-0 flex-1 truncate font-medium leading-snug">{t(view.edit ? "companion.build.editDoneTitle" : "companion.build.doneTitle", { name })}</p>
    <CloseButton label={t("companion.build.close")} onClick={handlers.onClose} />
  </div>
  {view.summary && (
    <p className="mb-2 mt-0.5 line-clamp-2 text-[12px] leading-snug text-[var(--m-text-muted)]" title={view.summary}>{view.summary}</p>
  )}
  <div className="mb-2 flex items-center gap-1.5">
    <button type="button" onClick={handlers.onShowPreview} className={primary}>{t("companion.build.showPreview")}</button>
    <IconButton label={t("companion.build.openInMarven")} onClick={handlers.onOpenInMarven}>{/* sidebar icon */}</IconButton>
    {view.queue.length > 0 && <span className="ms-auto text-[11px] text-[var(--m-text-faint)]">{t("companion.build.next", { request: view.queue[0] })}</span>}
  </div>
</div>
```

(`IconButton` is a 28×28 version of `secondary` with `title` and `aria-label`.)

- [ ] **Step 4: Failed / stopped / blocked:** the settings button when `view.settingsPage` is set, and when `canOpenProject`, **Show preview** plus the Open in Marven icon. "Open folder" goes (it's in the preview toolbar).

- [ ] **Step 5: `SpeechBubble.tsx`:** delete the `build-choice` block, the `onBuildChoice` prop, and the `build-choice` / `build-here` entries in `ACTION_LABEL_KEYS`. Drop `build-here` from the "Not now" condition.

- [ ] **Step 6: Strings.** Delete keys that are no longer used (check each with `grep -rn "<key>" app hooks lib --include=*.ts --include=*.tsx` first): `companion.buildAsk`, `buildHere`, `buildInMarven`, `justTellMe`, `editAsk`, `editHere`, `editInMarven`, `build.conflict`, `build.switchTo`, `build.keepGoing`, `build.inMarven`, `build.agentBusy`, `build.editInMarvenSent`, `build.editAgentBusy`, `build.openFolder`, `build.openUrl`, `build.openInBrowser`, `build.savedIn`, `build.emptySummary`. Delete each from both `en.ts` and `ar.ts`.

### Task 12: Mini Me page wiring

**Files:**
- Modify: `app/companion/page.tsx`

- [ ] **Step 1:** The brain options become:

```ts
    onBuild: (request, name) => buildSubmit({ kind: "build", request, name }),
    onEdit: (request) => buildSubmit({ kind: "edit", request }),
    onCorrection: (kind, previous) => {
      if (kind === "stop") {
        if (!buildStop()) announce(t("companion.nothingToStop"));
        return;
      }
      buildStop();
      if (kind === "new-instead" && previous?.kind === "edit") {
        buildSubmit({ kind: "build", request: previous.request, name: projectNameFor(previous.request) });
      }
    },
```

- [ ] **Step 2:** Build hook options: `getProject`, `onFolderReady: setProject`, `onProjectGone: () => { forgetCurrentProject(); setNotice(t("companion.build.projectGone", { name: … })); }`, `onFileWritten: schedulePreviewReload` (a 300 ms debounce calling `bridge?.previewReload()`), and `onDone`, which records the exchange as before and calls `bridge?.previewReload()`.

- [ ] **Step 3:** Handlers:

```ts
  const openProjectInMarven = useCallback(async (root: string) => {
    if (!bridge) return;
    const thread = loadThread(localStorage, root);
    const messages = thread.length ? thread : build?.request ? [{ role: "user" as const, content: build.request }] : [];
    if (messages.length === 0) return;
    const result = await bridge.openInMarven(messages, "agent", { workspaceRoot: root });
    if (result.ok) closeBubble();
    else setNotice(t(result.reason === "busy" ? "companion.build.marvenBusy" : "companion.build.handOffRefused"));
  }, [bridge, build?.request, closeBubble, t]);
```

The card handlers are `onShowPreview` (`bridge.showPreview(build.root, build.name)`, with `previewFailed` on null), `onOpenInMarven` (`openProjectInMarven(build.root)`), `onStop`, `onAnswer`, `onOpenSettings` and `onClose`. Subscribe `bridge.onPreviewOpenInMarven((root) => void openProjectInMarven(root))` in the wiring effect.

- [ ] **Step 4:** Delete `buildInMarven`, `editInMarven`, `chooseBuild`, the `build-here` branch of `onAction`, the `onBuildChoice` prop, and `prepareProjectFolder` from the imports. `buildNeedsUser = !!build?.approval`. The `onAttention` reasons lose `conflict`.

- [ ] **Step 5:** Add `nothingToStop: "There's nothing to stop."` / `"لا يوجد شيء لإيقافه."` under `companion`.

- [ ] **Step 6:** Run `npm run typecheck` and fix what it reports.

### Task 13: Open in Marven reuses the conversation

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1:** Add next to `agentMessagesByConvRef` usage: `const agentStreamLoadMessagesRef = useRef(agentStreamLoadMessages); agentStreamLoadMessagesRef.current = agentStreamLoadMessages;` (after `agentStreamLoadMessages` is defined).

- [ ] **Step 2:** In `openThread`: keep `id` in the message filter (`m.id` string or absent), delete the `payload.edit === true` block and `edit` from the `HandOff` type, and replace the non-autostart workspace branch with:

```ts
        // A project Mini Me built: back to the Agent conversation already on
        // that folder (one per project), with the thread messages it doesn't
        // have yet; a new conversation only if there's none. Never while the
        // Agent runs: switching would abort it.
        if (agentRunningRef.current || pendingAutostartRef.current) return { ok: false, reason: "busy" };
        setWorkspaceTrusted(root, true);
        const incoming: AgentMessage[] = messages.map((m, i) => ({
          id: typeof m.id === "string" && m.id ? m.id : `minime-${Date.now()}-${i}`,
          role: m.role,
          content: m.content,
        }));
        const existing = [...conversationsRef.current].reverse().find((c) => c.mode === "agent" && c.workspaceRoot === root);
        if (existing) {
          const have = agentMessagesByConvRef.current.get(existing.id) ?? [];
          const ids = new Set(have.map((m) => m.id));
          const merged = [...have, ...incoming.filter((m) => !ids.has(m.id))];
          agentMessagesByConvRef.current.set(existing.id, merged);
          if (lastAgentConvIdRef.current === existing.id) {
            agentStreamLoadMessagesRef.current(merged);
          } else {
            queueSiteOpen({ convId: existing.id, root, gate: "files" });
          }
          setActiveConversationId(existing.id);
        } else {
          const agentConv: Conversation = { ...createConversationWithMode(request, "agent"), workspaceRoot: root };
          agentMessagesByConvRef.current.set(agentConv.id, incoming);
          queueSiteOpen({ convId: agentConv.id, root, gate: "files" });
          setConversations((prev) => [...prev, agentConv]);
          setActiveConversationId(agentConv.id);
        }
        setAgentInput("");
        setAgentAttachments([]);
        return { ok: true };
```

- [ ] **Step 3:** `npm run typecheck` → clean.

### Task 14: Verify

- [ ] `npm run typecheck`, then `npx vitest run` → all pass.
- [ ] Restart Marven (`npm run desktop` from the repo root) and, in the app:
  1. "make a portfolio website for James Doe": building starts with no question. Click **Show preview**: the window opens beside Mini Me and fills in as files are written.
  2. While it builds, type "red background" and "bigger title". Both show as "Next: …", run together afterwards in the same folder, and the preview reloads.
  3. **Open in Marven** twice (bubble, then preview toolbar): one Agent conversation on the folder, with the history.
  4. "add a contact section", then "no, make a new one": the change stops and a new folder is made.
  5. The preview's **Open in browser** opens `127.0.0.1:<port>` in the default browser.
- [ ] Report results with evidence (server log lines, folder listing, screenshots).
