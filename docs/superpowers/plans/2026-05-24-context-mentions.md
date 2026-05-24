# @-Mention Context Injection — Implementation Plan

**Date:** 2026-05-24
**Spec:** `docs/superpowers/specs/2026-05-24-context-mentions-design.md`
**Branch:** `feat/context-mentions`

---

## Approach

TDD strict. One commit per task. `npm test` green after each.

Types defined once in `lib/mentions/types.ts`. The agent stream route is the only server change. The InputBar receives chip + popup state.

---

## Task 1 — Types module

**Files**
- Create: `lib/mentions/types.ts`

**Steps**

- [ ] 1.1 Add the type definitions from spec Section 1 verbatim (`MentionKind`, `FileMention`, `FolderMention`, `CodebaseMention`, `WebMention`, `Mention`, `ResolvedMention`).
- [ ] 1.2 Re-export `Mention` from `types/index.ts` so callers can `import { Mention } from "@/types"`.
- [ ] 1.3 `npx tsc --noEmit`: clean.
- [ ] 1.4 Commit: `feat(mentions): add Mention and ResolvedMention types`.

---

## Task 2 — Parser

**Files**
- Create: `lib/mentions/parser.ts`
- Test: `lib/mentions/parser.test.ts`

**Steps**

- [ ] 2.1 Test cases (spec Section 11):
  - empty string → null
  - "hello" cursor at end → null
  - "@" cursor at 1 → trigger { startOffset: 0, query: "" }
  - "hi @fo" cursor at 6 → trigger { startOffset: 3, query: "fo" }
  - "hi @ " cursor at 5 → null (whitespace after @)
  - "@a\nb" cursor at 4 → null (newline before cursor)
  - "user@host" cursor at 9 → null (@ preceded by letter)
  - "@" at very start, cursor anywhere on same line w/o whitespace → trigger
- [ ] 2.2 Implement `getActiveTrigger(text, cursorOffset)`:
  - Walk backward from cursorOffset. If text[i] is whitespace or newline → null. If text[i] is `@`: check text[i-1]; if it's a non-whitespace, non-start char → null. Otherwise return `{ startOffset: i, query: text.slice(i+1, cursorOffset) }`.
- [ ] 2.3 `npm test`: passes.
- [ ] 2.4 Commit: `feat(mentions): add @ trigger parser`.

---

## Task 3 — Resolver

**Files**
- Create: `lib/mentions/resolver.ts`
- Test: `lib/mentions/resolver.test.ts`

**Steps**

- [ ] 3.1 Find existing helpers via grep before implementing:
  - File read: `lib/workspace.ts` has `readWorkspaceFile(rel, root)` (server-side reuse — check signature).
  - Folder list: `lib/agent/tools.ts` or `lib/agent/toolExecutor.ts` likely has a `list_files` implementation.
  - Codebase search: `import { searchCodebase } from "@/lib/index/search"` already exists.
  - Web fetch: likely `lib/agent/fetchUrl.ts` or similar — `grep -rn "fetch_url" lib/agent/`.
- [ ] 3.2 Tests (mock the helpers via `vi.mock`):
  - file small (≤32KB) → body wraps content in code fence, ok=true
  - file large → body split (first 24KB + last 4KB joined), truncated=true
  - file missing → ok=false with error
  - folder with 3 files, 1 binary → binary listed as skipped; first 50 lines of others included
  - folder over 16KB → remaining listed as "not previewed — folder budget reached"
  - codebase → calls `searchCodebase` and formats top-K
  - web → calls fetch helper, strips simple HTML tags
  - budget overflow across 3 mentions → each oversize body truncated proportionally with end marker
- [ ] 3.3 Implement `resolveMentions(mentions, opts)`. Returns array of `ResolvedMention`. Apply budget after collecting all bodies.
- [ ] 3.4 `npm test`: passes.
- [ ] 3.5 Commit: `feat(mentions): add server-side mention resolver`.

---

## Task 4 — Formatter

**Files**
- Create: `lib/mentions/formatter.ts`
- Test: `lib/mentions/formatter.test.ts`

**Steps**

- [ ] 4.1 Tests:
  - empty resolved → returns ""
  - one ok mention → wraps body in `<context>\n<header>\n\n<body>\n</context>`
  - mixed ok + failed → failed mention rendered as `[Attachment failed: <kind> <ref> — <error>]`
- [ ] 4.2 Implement `formatContextBlock(resolved)`. Body order = input order.
- [ ] 4.3 `npm test`: passes.
- [ ] 4.4 Commit: `feat(mentions): add context block formatter`.

---

## Task 5 — Wire into agent stream route

**Files**
- Modify: `app/api/agent/stream/route.ts`
- Test: `app/api/agent/stream/route.test.ts` (extend if exists; create if not)

**Steps**

- [ ] 5.1 Add `mentions?: Mention[]` to the `StreamRequestBody` type.
- [ ] 5.2 Before invoking the agent loop: if `body.mentions?.length`, call `resolveMentions(body.mentions, { workspaceRoot: body.workspaceRoot })`, then `body.prompt = formatContextBlock(resolved) + "\n\n" + body.prompt`.
- [ ] 5.3 Test: post a request with one `@file` mention pointing to a fixture file under a temp workspace; assert the prompt passed to `runAgentLoop` (mock the loop) contains the file's content wrapped in `<context>`.
- [ ] 5.4 `npm test`: passes.
- [ ] 5.5 Commit: `feat(mentions): wire mention resolution into agent stream`.

---

## Task 6 — Update useAgentStream

**Files**
- Modify: `hooks/useAgentStream.ts`
- Modify: `hooks/useAgentStream.test.ts` if exists

**Steps**

- [ ] 6.1 Change `send` signature to `send(prompt, opts?: { attachments?: ImageAttachment[]; mentions?: Mention[] })`.
- [ ] 6.2 Forward `mentions` in the fetch body.
- [ ] 6.3 Update existing callers of `send(prompt, attachments)` to `send(prompt, { attachments })`. Grep to find them all — likely `app/page.tsx`, `InputBar.tsx`, possibly `Message.tsx` for retry.
- [ ] 6.4 `npx tsc --noEmit`: clean.
- [ ] 6.5 `npm test`: passes.
- [ ] 6.6 Commit: `feat(mentions): accept mentions in useAgentStream.send`.

---

## Task 7 — MentionChip + MentionPopup components

**Files**
- Create: `app/components/marven/MentionChip.tsx`
- Create: `app/components/marven/MentionPopup.tsx`

**Steps**

- [ ] 7.1 Implement `MentionChip` (small rounded pill, icon by kind, X button). No tests (pure presentational).
- [ ] 7.2 Implement `MentionPopup`:
  - State: `mode: "category" | "file" | "folder" | "codebase" | "web"`, `highlightedIdx`, `textInput`
  - In "category" mode: render 4 category cards. Filter by `query` (case-insensitive substring of label).
  - In "file"/"folder" mode: render fuzzy filtered list (use the existing fuzzy helper if present, else simple `text.toLowerCase().includes(q.toLowerCase())`).
  - In "codebase"/"web" mode: render a text input; Enter creates the mention.
  - Keyboard: ArrowUp/Down navigate; Enter selects; Esc → if not in category mode, back to category; if in category, close.
  - Position: absolute-positioned at `anchor.x, anchor.y` with `position: fixed`. Clamp to viewport.
- [ ] 7.3 Commit: `feat(mentions): add MentionChip and MentionPopup components`.

---

## Task 8 — InputBar integration + smoke

**Files**
- Modify: `app/components/marven/InputBar.tsx`

**Steps**

- [ ] 8.1 Add state: `mentions: Mention[]`, `mentionPopup: { open, anchor, query } | null`.
- [ ] 8.2 Compute caret coords: in textarea `onSelect`/`onKeyUp`, derive `{ x, y }` from a shadow `<div>` mirror (standard textarea-caret trick) or by using a position helper.
- [ ] 8.3 On every input change, run `getActiveTrigger(textarea.value, textarea.selectionStart)`. If non-null → open popup with `anchor` + `query`. If null → close popup.
- [ ] 8.4 Render chip row above the textarea. Each chip's `onRemove` removes from `mentions`.
- [ ] 8.5 On popup `onPick(m)`: append to `mentions`, close popup, focus textarea, and strip the `@…` typed query from the textarea (replace `text.slice(trigger.startOffset, cursor)` with empty).
- [ ] 8.6 On Backspace with textarea cursor at offset 0 and `mentions.length > 0` → pop last mention.
- [ ] 8.7 In submit handler: call `onSend(text, { mentions, attachments })`. Clear `mentions` after send.
- [ ] 8.8 Show "Type @ to attach files, folders, code search, or URLs." as placeholder when input + mentions are both empty.
- [ ] 8.9 Need workspace file list for the picker — pass through from `app/page.tsx`'s existing workspace file state (grep for the current source).
- [ ] 8.10 `npx tsc --noEmit`: clean. `npm test`: passes.
- [ ] 8.11 Commit body: manual smoke checklist from spec Section 11.
- [ ] 8.12 Commit: `feat(mentions): integrate popup + chips into InputBar`.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| 1 Types | 1 |
| 2 Parser | 2 |
| 3 Resolver (all four kinds + budget) | 3 |
| 4 Formatter | 4 |
| 5 API wiring | 5 |
| 6 useAgentStream | 6 |
| 7 MentionPopup | 7 |
| 8 MentionChip | 7 |
| 9 InputBar integration | 8 |
| 10 No new settings | n/a |
| 11 Unit + integration tests | 2, 3, 4, 5 |
| 11 Manual smoke | 8 (commit body) |

All sections covered.
