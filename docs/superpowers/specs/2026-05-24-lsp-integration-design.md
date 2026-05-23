# LSP Integration — Design Spec

**Date:** 2026-05-24
**Status:** Approved (Phase 1 of 4 in the "Cursor parity" roadmap)

---

## Goal

Give Marven's existing CodeMirror 6 editor real IDE intelligence — diagnostics, hover types, completions, go-to-definition, and rename — by speaking the Language Server Protocol (LSP). Ship TypeScript/JavaScript support on day one; the architecture supports adding other languages incrementally.

## Problem

Marven has a working code editor (CodeMirror 6, ~1,500 LOC) but no language intelligence:
- No red squigglies for type errors
- No hover tooltips showing types or JSDoc
- No autocompletion beyond CodeMirror's built-in word-list
- No go-to-definition / rename / find-references
- The editor feels "dumb" compared to VSCode, Cursor, or any modern IDE

Without LSP, Marven cannot be on par with Cursor for actual coding work — the AI agent is great, but the human editor experience is not.

---

## Scope

This spec covers:
- **LspManager** (Electron main process) — spawns and supervises language server child processes
- **IPC bridge** — `marvenElectron.lsp.*` channel exposed to the renderer
- **lspExtension** — a CodeMirror 6 extension that wires editor events to LSP messages and renders results
- **lspServers config** — mapping of file extensions to language server commands + npm packages
- **Auto-install** — first-time `npm install` of language servers into `~/.marven/lsp/<lang>/`
- **StatusBar indicator** — shows LSP state for the active file
- **Day-1 language**: TypeScript / JavaScript via `typescript-language-server`

Out of scope (deferred to Phase 1.5+):
- Multi-root workspaces
- Workspace symbol search
- Code actions / quick fixes
- Inlay hints
- Semantic tokens
- Settings UI for LSP
- Languages other than TS/JS

---

## Architecture

### Process model

```
┌──────────────────────────────────────────────────┐
│  Renderer (Next.js)                              │
│  ┌────────────────────────────────────────────┐  │
│  │  CodeEditor.tsx (CodeMirror 6)             │  │
│  │  + lspExtension({ sessionId, languageId,   │  │
│  │                   filePath, workspaceRoot})│  │
│  └────────────────────────────────────────────┘  │
└───────────────────┬──────────────────────────────┘
                    │ window.marvenElectron.lsp.*
                    │ (Electron contextBridge IPC)
┌───────────────────▼──────────────────────────────┐
│  Electron Main                                   │
│  ┌────────────────────────────────────────────┐  │
│  │  lspManager.js (singleton)                 │  │
│  │  - ensure(languageId)  → spawns server     │  │
│  │  - request(sessionId, method, params)      │  │
│  │  - on notification → broadcast to renderers│  │
│  │  - install(languageId) → npm install       │  │
│  └────────────────────────────────────────────┘  │
└───────────────────┬──────────────────────────────┘
                    │ stdio JSON-RPC
┌───────────────────▼──────────────────────────────┐
│  typescript-language-server (child process)      │
│  installed in ~/.marven/lsp/typescript/          │
└──────────────────────────────────────────────────┘
```

### Files

| File | Change |
|------|--------|
| `electron/lsp/lspManager.js` | New — process supervisor + JSON-RPC router |
| `electron/lsp/lspServers.js` | New — language server registry (lang→npm package, command, args) |
| `electron/lsp/__tests__/lspManager.test.js` | New — unit tests with mocked child_process |
| `electron/lsp/__tests__/lspManager.e2e.test.js` | New — single end-to-end test with real typescript-language-server |
| `electron/preload.js` | Modify — expose `marvenElectron.lsp.*` IPC methods |
| `electron/main.js` | Modify — instantiate LspManager singleton, register IPC handlers |
| `lib/editor/lspExtension.ts` | New — CodeMirror 6 extension wiring all five MVP features |
| `lib/editor/lspClient.ts` | New — renderer-side thin client wrapping IPC calls + event bus |
| `lib/editor/lspServers.ts` | New — extension→languageId mapping (shared shape with `electron/lsp/lspServers.js`) |
| `lib/editor/lspExtension.test.ts` | New — unit tests with mocked lspClient |
| `app/components/marven/CodeEditor.tsx` | Modify — accept languageId prop, conditionally include lspExtension |
| `app/components/marven/StatusBar.tsx` | Modify — render LSP status badge for active file |
| `types/index.ts` | Modify — add LSP-related types (`LspStatus`, `LspSession`, etc.) |

---

## Section 1: Language Server Registry

**File:** `lib/editor/lspServers.ts`

```ts
export type LanguageId = "typescript"; // future: | "python" | "rust" | ...

export interface LspServerSpec {
  languageId: LanguageId;
  /** File extensions this server handles (no leading dot). */
  extensions: string[];
  /** Package(s) to npm-install. */
  npmPackages: string[];
  /** Command (relative to install dir's node_modules/.bin/). */
  command: string;
  /** Args to pass to the command. */
  args: string[];
  /** Initialization options sent in LSP `initialize`. */
  initializationOptions?: Record<string, unknown>;
}

export const LSP_SERVERS: Record<LanguageId, LspServerSpec> = {
  typescript: {
    languageId: "typescript",
    extensions: ["ts", "tsx", "js", "jsx", "mjs", "cjs"],
    npmPackages: ["typescript", "typescript-language-server"],
    command: "typescript-language-server",
    args: ["--stdio"],
    initializationOptions: {
      preferences: {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
      },
    },
  },
};

export function languageIdForExtension(ext: string): LanguageId | null {
  for (const spec of Object.values(LSP_SERVERS)) {
    if (spec.extensions.includes(ext.toLowerCase())) return spec.languageId;
  }
  return null;
}
```

**File:** `electron/lsp/lspServers.js` — same shape, CommonJS (kept in sync; tested via a structural assertion).

---

## Section 2: LspManager (Electron main)

**File:** `electron/lsp/lspManager.js`

### Responsibilities

1. **Install** language servers to `~/.marven/lsp/<languageId>/` via `npm install` (no global side effects).
2. **Spawn** the server process with `child_process.spawn(command, args, { stdio: "pipe" })`.
3. **JSON-RPC framing**: parse `Content-Length: N\r\n\r\n<json>` from stdout, write same format to stdin.
4. **Session lifecycle**: one server process per languageId, multiple `LspSession`s share it. Each session has a unique sessionId.
5. **Initialize handshake**: on first session for a server, send LSP `initialize` with workspace root + capabilities; respond to `initialized` notification.
6. **Route messages**:
   - Renderer requests (`hover`, `completion`, etc.) → forward to server, return response by request id.
   - Server notifications (`textDocument/publishDiagnostics`, etc.) → forward to all renderers via `webContents.send("lsp:notification", ...)`.
7. **Crash recovery**: if a server exits unexpectedly, mark sessions as errored, expose `restart(languageId)` IPC. No auto-restart loops.

### Public API (exposed via IPC)

```js
// All methods accept a callerWindow so notifications are routed correctly.
lspManager.ensure(languageId): Promise<{ status: "ready"|"installing"|"failed", error? }>
lspManager.openSession({ languageId, filePath, workspaceRoot }): Promise<{ sessionId }>
lspManager.closeSession(sessionId): Promise<void>
lspManager.didChange(sessionId, { version, text }): void   // notification, no response
lspManager.request(sessionId, method, params): Promise<unknown>
lspManager.restart(languageId): Promise<void>
```

### Install behaviour

```
ensure("typescript"):
  installDir = ~/.marven/lsp/typescript/
  binPath    = installDir/node_modules/.bin/typescript-language-server
  if exists(binPath):
    return { status: "ready" }
  emit "lsp:installing" { languageId: "typescript" }
  await run: npm install <npmPackages> --prefix <installDir> --no-audit --no-fund
  if exit code 0 and exists(binPath):
    emit "lsp:installed" { languageId: "typescript" }
    return { status: "ready" }
  else:
    emit "lsp:install-failed" { languageId, stderr }
    return { status: "failed", error }
```

A single install completes for the lifetime of the user's `~/.marven/` directory; subsequent app launches skip it.

---

## Section 3: Renderer LSP Client

**File:** `lib/editor/lspClient.ts`

Thin wrapper around `window.marvenElectron.lsp.*` exposing the same shape as `lspManager` plus an `EventEmitter`-style subscription for notifications:

```ts
export interface LspClient {
  ensure(languageId: LanguageId): Promise<EnsureResult>;
  openSession(opts: OpenSessionOpts): Promise<{ sessionId: string }>;
  closeSession(sessionId: string): Promise<void>;
  didChange(sessionId: string, payload: { version: number; text: string }): void;
  request<T = unknown>(sessionId: string, method: string, params?: unknown): Promise<T>;
  onNotification(handler: (n: LspNotification) => void): () => void; // returns unsubscribe
}

export const lspClient: LspClient = /* binds to marvenElectron.lsp */;
```

A single shared `lspClient` instance lives at module scope. Multiple editors share it.

---

## Section 4: CodeMirror 6 Extension

**File:** `lib/editor/lspExtension.ts`

Builds a CM6 extension array. Wires the five MVP features:

| Feature | CodeMirror integration | LSP method |
|---|---|---|
| **Diagnostics** | `linter()` from `@codemirror/lint`, populated by a `StateField<Diagnostic[]>` updated via `publishDiagnostics` notifications | `textDocument/publishDiagnostics` |
| **Hover** | `hoverTooltip()` from `@codemirror/view` | `textDocument/hover` |
| **Completions** | `autocompletion()` source from `@codemirror/autocomplete`, triggers on `.`, `:`, `(`, `"`, `'`, and as-you-type after 1 char | `textDocument/completion` |
| **Go-to-definition** | `EditorView.domEventHandlers({ mousedown })` checking Cmd/Ctrl + click; opens new tab via callback prop (`onOpenFile`) | `textDocument/definition` |
| **Rename** | `keymap.of([{ key: "F2", run: ... }])` opening a small prompt overlay; applies `WorkspaceEdit` across files via `onApplyWorkspaceEdit` callback | `textDocument/rename` |

### Extension signature

```ts
export function lspExtension(opts: {
  sessionId: string;
  languageId: LanguageId;
  filePath: string;
  /** Called when LSP requests we open another file (go-to-def, rename targets). */
  onOpenFile: (path: string, position?: { line: number; character: number }) => void;
  /** Called when LSP rename produces a WorkspaceEdit spanning multiple files. */
  onApplyWorkspaceEdit: (edit: LspWorkspaceEdit) => Promise<void>;
}): Extension;
```

### Lifecycle

- On creation: `lspClient.didOpen(filePath, currentText)` (via `request` with method `"textDocument/didOpen"` — actually a notification).
- On every `update.docChanged`: debounce 150ms, then `lspClient.didChange(sessionId, { version, text })`.
- On view destroy: `lspClient.didClose(filePath)`.

### Diagnostic StateField

```ts
const diagnosticsField = StateField.define<Diagnostic[]>({
  create: () => [],
  update: (value, tr) => {
    for (const effect of tr.effects) {
      if (effect.is(setDiagnosticsEffect)) return effect.value;
    }
    return value;
  },
});
```

A subscription `lspClient.onNotification` listens for `publishDiagnostics` whose `uri` matches `filePath`, converts LSP ranges → CM offsets via the doc, and dispatches `setDiagnosticsEffect`.

---

## Section 5: CodeEditor Integration

**File:** `app/components/marven/CodeEditor.tsx`

New optional prop:

```ts
interface CodeEditorProps {
  // ...existing...
  filePath?: string;          // already exists in some form
  languageId?: LanguageId;    // NEW — if undefined, no LSP
  workspaceRoot?: string;     // NEW — required when languageId set
  onOpenFile?: (path: string, position?: Position) => void;       // NEW
  onApplyWorkspaceEdit?: (edit: LspWorkspaceEdit) => Promise<void>; // NEW
}
```

Behaviour:

1. On mount, if `languageId` set, call `lspClient.ensure(languageId)`.
2. If ready, `openSession({ languageId, filePath, workspaceRoot })` and add `lspExtension(...)` to the CM6 state.
3. While installing, render a small inline pill "Installing TypeScript language server…" via the `StatusBar`.
4. On unmount, `closeSession(sessionId)`.

`languageId` is derived in `EditorPanel.tsx` from the file extension using `languageIdForExtension(ext)`. Files with no supported language get no LSP and behave as today.

---

## Section 6: StatusBar Indicator

**File:** `app/components/marven/StatusBar.tsx`

Add a small badge to the right of the existing file info section:

| State | Icon | Tooltip |
|---|---|---|
| `idle` (no LSP for this file) | (hidden) | — |
| `installing` | `TS ◐` (animated) | "Installing TypeScript language server…" |
| `ready` | `TS ●` (green) | "TypeScript LSP ready" |
| `failed` | `TS ⚠` (red, clickable) | "LSP failed — click for details" → opens log modal |
| `restarting` | `TS ↻` | "Restarting…" |

State is held in a `useLspStatus(languageId)` hook subscribed to `lspClient.onNotification` filtered by manager events.

---

## Section 7: Testing

### Unit tests

**`electron/lsp/__tests__/lspManager.test.js`** — mocks `child_process.spawn`:
- `ensure()` runs npm install when bin missing
- `ensure()` returns ready when bin exists
- `openSession()` triggers LSP `initialize` handshake on first session
- JSON-RPC framing: parses `Content-Length` headers correctly across split buffers
- Server crash marks sessions errored and emits notification
- `restart()` cleanly kills + respawns

**`lib/editor/lspServers.test.ts`** — extension→languageId mapping:
- `languageIdForExtension("ts")` → `"typescript"`
- `languageIdForExtension("tsx")` → `"typescript"`
- `languageIdForExtension("py")` → `null`
- `languageIdForExtension("TS")` → `"typescript"` (case-insensitive)

**`lib/editor/lspExtension.test.ts`** — mocked `lspClient`:
- Diagnostics from notification populate CM `Diagnostic[]` with correct offsets
- Hover request sent on hover; tooltip renders returned markdown
- Completion request sent on `.`; returned items appear in autocomplete dropdown
- Cmd+click sends `definition` request; calls `onOpenFile` with response
- F2 sends `rename`; calls `onApplyWorkspaceEdit` with response

### End-to-end test

**`electron/lsp/__tests__/lspManager.e2e.test.js`** (vitest, runs in node, NOT jsdom, gated by `RUN_LSP_E2E=1` env var so CI without `npm` doesn't break):

```
1. Create temp dir with one file foo.ts containing: `const x: number = "wrong";`
2. ensure("typescript") — install if needed (cached after first run)
3. openSession({ languageId: "typescript", filePath: tmp+"/foo.ts", workspaceRoot: tmp })
4. Wait up to 10s for a `publishDiagnostics` notification
5. Assert at least one diagnostic with severity=Error mentions "Type 'string' is not assignable"
6. closeSession
```

### Manual smoke test (documented in spec — run before each release)

1. Open Marven on a fresh machine
2. Open a `.ts` file
3. Confirm StatusBar shows installing → ready within 60s
4. Type `const x: number = "bad";` — confirm red squiggle
5. Hover `x` — confirm tooltip shows `(const) x: number`
6. Type `console.` — confirm completions dropdown appears
7. Cmd+click an import — confirm new tab opens at definition
8. Place cursor on a function name, press F2, type new name, Enter — confirm rename across files

---

## Section 8: Error Handling

- **npm install fails**: StatusBar shows `⚠`, click opens modal with last 200 lines of stderr. Editor still works without LSP.
- **Server crashes**: Sessions for that language become errored. Notification fired. StatusBar shows `⚠` with "click to restart".
- **Server hangs (>30s no response to a request)**: Reject the pending request with a timeout error. Don't kill the server (TypeScript can be slow on large files).
- **`didChange` while installing**: Buffered. Replayed once ready.
- **Path with spaces**: JSON-RPC URIs encoded via `encodeURI`. Verified in tests.

---

## What Does Not Change

- CodeMirror 6 stays. No editor swap.
- Existing language modes (CM6 lang packages) stay — they handle syntax highlighting; LSP adds semantic features on top.
- The agent loop, agent tools, and chat UI are untouched. LSP is purely an editor feature.
- File buffer management in `app/page.tsx` is untouched.
- No change to existing tests.

---

## Future (Phase 1.5)

Once Phase 1 is shipped and stable, adding a new language is purely a config addition:

```ts
LSP_SERVERS.python = {
  languageId: "python",
  extensions: ["py", "pyi"],
  npmPackages: [],  // not npm
  command: "pyright-langserver",
  args: ["--stdio"],
};
```

…plus a one-line addition to the install logic to know "this one's not npm, it's pip". The architecture supports this without changing any of the renderer code.
