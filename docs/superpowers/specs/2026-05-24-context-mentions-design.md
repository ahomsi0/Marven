# @-Mention Context Injection — Design Spec

**Date:** 2026-05-24
**Status:** Approved (Phase 4 of 4 in the Cursor-parity roadmap)

---

## Goal

Let users explicitly attach context to chat messages via `@` mentions: `@file`, `@folder`, `@codebase`, `@web`. Selected items appear as chips in the input; on send, their content is expanded and prepended to the agent's prompt so the model knows exactly what the user wants it to consider.

## Problem

Today, when a user wants the agent to think about specific files, they either:
1. Manually paste the content (tedious, lossy for large files)
2. Hope the agent finds the right files via tool calls (slow, often misses)
3. Pre-open the file in the editor (the agent's current implicit context, but limited)

Cursor's flagship UX feature is `@`-mentions. Without them, Marven feels like a chatbot instead of a coding partner.

---

## Scope

This spec covers:
- **Mention popup** — appears when user types `@` in the chat input; shows categories and live results
- **Mention chips** — selected mentions render as removable chips in the input area
- **Expansion** — chips expand server-side into a structured context block prepended to the user's prompt
- **Four mention types**:
  - `@file <path>` — full content of a workspace file
  - `@folder <path>` — list of files + first 50 lines of each (capped by char budget)
  - `@codebase <query>` — top-K chunks from Phase 2 semantic index
  - `@web <url>` — fetched URL content (text only, via existing `fetch_url` tool)
- **Persistence** — chips persist across input edits until removed or sent
- **Budget** — total expanded context capped at 50K chars; oversize attachments are truncated with a marker

Out of scope:
- `@docs` (curated documentation set) — needs a docs library, deferred
- `@symbol` (LSP-resolved symbol) — could use Phase 1 LSP, deferred
- `@git` (diff, commit ranges) — could use existing git tools, deferred
- Drag-and-drop file/folder onto input → mention chip — UX polish, deferred
- Mention autocomplete inside the message body (only after `@` triggers a popup)

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  InputBar                                                        │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ MentionChip[]  +  <textarea> + MentionPopup              │    │
│  │  ├─ user types "@" → popup opens at caret               │    │
│  │  ├─ MentionPopup: 4 category buttons                     │    │
│  │  │   selecting one → category-specific picker:          │    │
│  │  │     @file   → fuzzy file picker (reuses QuickOpen)   │    │
│  │  │     @folder → folder picker                          │    │
│  │  │     @codebase → free-text search (uses /api/index)   │    │
│  │  │     @web    → URL input                              │    │
│  │  └─ selection → adds to chip list + closes popup        │    │
│  └──────────────────────────────────────────────────────────┘    │
└────────────────┬─────────────────────────────────────────────────┘
                 │ send: { prompt, mentions: Mention[], ... }
┌────────────────▼─────────────────────────────────────────────────┐
│  app/api/agent/stream/route.ts                                   │
│  - calls expandMentions(mentions, workspaceRoot)                 │
│  - prepends "<context>...</context>" block to user prompt        │
│  - passes through to runAgentLoop as before                      │
└──────────────────────────────────────────────────────────────────┘
```

### Files

| File | Change |
|------|--------|
| `lib/mentions/types.ts` | New — `Mention`, `MentionKind`, `ResolvedContext` |
| `lib/mentions/parser.ts` | New — parse `@` triggers in textarea |
| `lib/mentions/resolver.ts` | New — server-side expansion to text content |
| `lib/mentions/resolver.test.ts` | New |
| `lib/mentions/formatter.ts` | New — assembles `<context>…</context>` block |
| `lib/mentions/formatter.test.ts` | New |
| `app/components/marven/MentionPopup.tsx` | New — category picker + per-kind picker |
| `app/components/marven/MentionChip.tsx` | New — renders one chip |
| `app/components/marven/InputBar.tsx` | Modify — integrate popup + chips + parser |
| `app/api/agent/stream/route.ts` | Modify — call `resolveMentions` + `formatContext` |
| `hooks/useAgentStream.ts` | Modify — accept + forward mentions in `send()` |
| `app/page.tsx` | Modify — pass workspaceRoot to InputBar (likely already does); no other changes |
| `types/index.ts` | Modify — export `Mention` types from `lib/mentions/types.ts` |

---

## Section 1: Types

**File:** `lib/mentions/types.ts`

```ts
export type MentionKind = "file" | "folder" | "codebase" | "web";

export interface FileMention {
  kind: "file";
  /** Workspace-relative path. */
  path: string;
}

export interface FolderMention {
  kind: "folder";
  /** Workspace-relative path. */
  path: string;
}

export interface CodebaseMention {
  kind: "codebase";
  query: string;
  /** Default 8, capped at 20. */
  limit?: number;
}

export interface WebMention {
  kind: "web";
  url: string;
}

export type Mention = FileMention | FolderMention | CodebaseMention | WebMention;

export interface ResolvedMention {
  mention: Mention;
  /** Text representation injected into the context block. */
  body: string;
  /** Was the body truncated to fit the budget? */
  truncated: boolean;
  /** Was the fetch/read successful? */
  ok: boolean;
  /** Error message if !ok. */
  error?: string;
}
```

---

## Section 2: Parser

**File:** `lib/mentions/parser.ts`

A tiny pure function used by InputBar to detect the `@` trigger as the user types:

```ts
export interface MentionTrigger {
  /** The offset where '@' was typed. */
  startOffset: number;
  /** Text after '@' up to cursor — used for filtering. */
  query: string;
}

/**
 * Returns the active mention trigger at `cursorOffset` if the user is typing one,
 * or null otherwise. A trigger is active when '@' appears in the line at or before
 * the cursor, with no whitespace between '@' and the cursor.
 */
export function getActiveTrigger(text: string, cursorOffset: number): MentionTrigger | null;
```

Behavior:
- Walks backward from `cursorOffset` until hitting whitespace, newline, or `@`.
- If `@` found and there's nothing but non-whitespace between it and the cursor → return the trigger.
- If a space or newline encountered first → no trigger (popup closes).
- If `@` is preceded by a non-whitespace character (e.g. an email `user@host`) → no trigger.

---

## Section 3: Resolver

**File:** `lib/mentions/resolver.ts`

Server-side. Converts each `Mention` to a `ResolvedMention`.

```ts
export interface ResolveOptions {
  workspaceRoot: string;
  /** Default 50000. */
  totalBudgetChars?: number;
}

export async function resolveMentions(
  mentions: Mention[],
  opts: ResolveOptions
): Promise<ResolvedMention[]>;
```

Per-kind resolution:

### `@file <path>`
- Read `workspaceRoot + "/" + mention.path`
- If file > 32KB: include first 24KB + last 4KB joined by `\n\n[…truncated…]\n\n`, mark `truncated`
- If binary or unreadable: `ok: false, error: "..."`
- Body format:
  ```
  ### File: <path>
  ```<langId>
  <content>
  ```
  ```

### `@folder <path>`
- List entries non-recursively
- For each file (skip subfolders and binary), include first 50 lines
- Cap total at 16KB; if exceeded, list remaining filenames only
- Body format:
  ```
  ### Folder: <path>
  
  - <child1.ts>
    ```typescript
    <first 50 lines>
    ```
  - <child2.md>
    ...
  - <other-file.bin>  (binary, skipped)
  - <child3.ts>  (not previewed — folder budget reached)
  ```

### `@codebase <query>`
- Call `/api/index/search` POST with `{ query, limit: mention.limit ?? 8, workspaceRoot }`
- Body format:
  ```
  ### Codebase search: "<query>"
  
  [1] src/auth/jwt.ts:42-89 (distance 0.21)
  ```typescript
  <text>
  ```
  
  [2] middleware/auth.ts:10-55 (distance 0.28)
  ...
  ```

### `@web <url>`
- Use existing `fetch_url` helper (whatever the agent uses today — discovered via grep in plan)
- Strip HTML to text where possible (basic readability heuristic)
- Body format:
  ```
  ### Web: <url>
  
  <text>
  ```

### Budget enforcement

After resolving all mentions, sum body lengths. If total > `totalBudgetChars`:
- Truncate each oversize body proportionally
- Each truncated body ends with `[…truncated to fit context budget…]`

---

## Section 4: Formatter

**File:** `lib/mentions/formatter.ts`

```ts
export function formatContextBlock(resolved: ResolvedMention[]): string;
```

Returns:
```
<context>
The user attached the following context. Use it when answering. Do NOT use tools to re-read these files unless content changed.

<mention 1 body>

<mention 2 body>

...
</context>
```

If `resolved` is empty, returns `""`.

If any resolved mention has `ok: false`, include a line:
```
[Attachment failed: <kind> <ref> — <error>]
```

---

## Section 5: API Wiring

**File:** `app/api/agent/stream/route.ts`

The request body already accepts `prompt`, `attachments?` (images). Add `mentions?: Mention[]`.

Before passing to `runAgentLoop`:

```ts
if (body.mentions && body.mentions.length > 0) {
  const resolved = await resolveMentions(body.mentions, { workspaceRoot: body.workspaceRoot });
  const ctxBlock = formatContextBlock(resolved);
  if (ctxBlock) {
    // Prepend to the user prompt — the model sees the context as part of its instruction.
    body.prompt = `${ctxBlock}\n\n${body.prompt}`;
  }
}
```

That's it. No change to the agent loop itself.

---

## Section 6: useAgentStream

**File:** `hooks/useAgentStream.ts`

Update the `send` function signature:

```ts
send(prompt: string, opts?: {
  attachments?: ImageAttachment[];
  mentions?: Mention[];
}): Promise<void>
```

Forward `mentions` in the POST body.

---

## Section 7: MentionPopup

**File:** `app/components/marven/MentionPopup.tsx`

```tsx
interface MentionPopupProps {
  /** Anchor position (caret coords relative to viewport). */
  anchor: { x: number; y: number };
  query: string;                  // text after '@'
  workspaceRoot: string;
  /** All workspace files for fuzzy filtering. */
  workspaceFiles: string[];
  onPick: (mention: Mention) => void;
  onClose: () => void;
}
```

Renders a floating panel positioned near the caret:

```
┌──────────────────────────────────────┐
│ Mention type                         │
│  📄 File          Add a file        │
│  📁 Folder        Add a folder      │
│  🔍 Codebase      Semantic search   │
│  🌐 Web           Fetch a URL       │
└──────────────────────────────────────┘
```

Keyboard:
- ↑↓ navigates options
- Enter selects the highlighted category → opens a sub-picker
- Esc closes
- When user keeps typing, `query` filters the option labels (e.g. typing `@cod` highlights "Codebase")

Sub-pickers:

**@file picker** — fuzzy filtering against `workspaceFiles`. Reuses the same list-of-paths interaction as QuickOpenModal but inline in the popup.

**@folder picker** — same, but list folders only (derive from file paths).

**@codebase picker** — single text input "Search:"; pressing Enter creates a `CodebaseMention` with `query: <input>`. (Doesn't run the search at edit time — server resolves on send.)

**@web picker** — single text input "URL:"; pressing Enter creates a `WebMention`.

---

## Section 8: MentionChip

**File:** `app/components/marven/MentionChip.tsx`

```tsx
interface MentionChipProps {
  mention: Mention;
  onRemove: () => void;
}
```

Renders a small rounded pill above the textarea:

- `@file src/auth.ts ✕`
- `@folder lib/ ✕`
- `@codebase "jwt validation" ✕`
- `@web example.com/docs ✕`

Backgrounds use the existing palette tokens (`var(--m-surface)` border + soft accent).

---

## Section 9: InputBar Integration

**File:** `app/components/marven/InputBar.tsx`

Changes:
1. New state: `mentions: Mention[]`.
2. New state: `mentionPopup: { open: boolean; anchor: { x, y }; query: string } | null`.
3. On `onChange`, call `getActiveTrigger(text, cursor)`. If returned, open the popup with caret position. If cursor leaves an active trigger, close.
4. Render `MentionChip[]` in a row above the textarea.
5. Pressing **Backspace** at offset 0 of the textarea while chips exist → removes the last chip (Cursor's behavior).
6. On send, call `onSend(text, { mentions, attachments: images })` instead of `onSend(text)`. Clear chips afterwards.
7. Visual ghost-hint: empty input shows "Type @ to attach files, folders, code search, or URLs."

---

## Section 10: Settings

No new settings. `@codebase` requires Phase 2's indexing to be enabled; if not, the mention resolves with `ok: false, error: "Codebase indexing is disabled. Enable it in Settings."`. `@web` requires network; if it fails, `ok: false`.

---

## Section 11: Testing

### Unit

- `parser.test.ts` — `getActiveTrigger` for: empty, no `@`, `@` at start, `@` after space, `@` after newline, `@` after non-whitespace (negative — email-like), `@filename` partial query, cursor not at trigger location.
- `resolver.test.ts` — file (small + truncated), folder (with binaries skipped), codebase (mocked search API), web (mocked fetch_url), budget enforcement across multiple oversize bodies.
- `formatter.test.ts` — empty → "", one mention → wraps in `<context>...</context>`, mixed ok + failed → includes failure line.

### Integration

- `app/api/agent/stream/route.test.ts` — extend with mentions: assert the prompt body received by `runAgentLoop` contains the expected `<context>` prefix.

### Manual smoke

1. Open Marven, focus chat input
2. Type `@` — popup opens
3. Type `cod` — Codebase highlighted; Enter → search input appears
4. Type `auth flow` + Enter — chip "@codebase 'auth flow'" appears
5. Type rest of message + send
6. Agent's first reply references the matching code chunks (not just a guess)
7. Type `@file` + select a file → chip appears, send works
8. Type `@web https://example.com` (or via URL picker) → chip appears, send works
9. Backspace at start of input with chips present → removes last chip

---

## What Does Not Change

- The agent loop, system prompts, tools, tier classifier — all untouched. Mentions are pre-expanded into the prompt string before the loop sees it.
- LSP — untouched.
- Codebase indexing — used as a service via existing `/api/index/search`; not modified.
- Inline completions — untouched.
- The existing image-attachment flow — untouched (mentions are a parallel channel).

---

## Error Handling

- **Picker can't load workspace files**: popup shows "Couldn't load file list."
- **`@codebase` with empty query**: chip rejected; popup shows "Search query required."
- **`@web` with bad URL**: chip rejected; popup shows "Invalid URL."
- **Mention resolution fails server-side**: the `<context>` block includes a `[Attachment failed: ...]` line so the model knows that attachment was missing. The chat continues.

---

## Future (Phase 4.5+)

- `@symbol` — LSP-backed symbol picker (uses Phase 1)
- `@docs <library>` — curated documentation set
- `@git <range>` — git diffs / commits
- Drag-and-drop file/folder → mention chip
- Persist last 10 used mentions for fast re-use
- `@` autocomplete that shows file path completions inline as the user types `@src/foo/...` directly (skipping the popup)
