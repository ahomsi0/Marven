# Inline AI Completions — Design Spec

**Date:** 2026-05-24
**Status:** Approved (Phase 3 of 4 in the Cursor-parity roadmap)

---

## Goal

Add ghost-text completions in the editor: as the user types, faded text appears showing the AI's guess at what comes next. Tab accepts, Esc dismisses. This is Cursor's most-used feature — the "tab tab tab" experience.

## Problem

Marven has an excellent agent (chat-driven) and an excellent editor, but no "as-you-type" intelligence. Most coding moments don't warrant invoking the agent — they're routine continuations the model can predict in one shot.

Without inline completions:
- Users feel slower than Cursor for everyday typing
- The agent isn't the right tool for "finish this for loop" — too heavy
- Marven loses the most viral feature of modern AI editors

---

## Scope

This spec covers:
- **CodeMirror extension** — `inlineCompletionExtension` driving ghost text + Tab/Esc handling
- **API route** — `POST /api/completion/inline` returning a single completion
- **Provider adapter** — supports OpenAI, Anthropic, Ollama, LM Studio, llama-server, Groq, OpenRouter, NIM (same providers Marven already supports)
- **FIM prompt builder** — fill-in-middle prompting (provider-specific format where available, plain prefix-only fallback otherwise)
- **Context windowing** — sends ~50 lines before cursor + ~20 lines after as the prompt context (configurable)
- **Debouncing + cancellation** — fires 350ms after typing pauses, cancels prior in-flight requests
- **Settings UI** — toggle, model selector (separate from chat model), debounce slider
- **Telemetry counters** — accepts vs dismisses (in-memory only, surfaced in Settings)

Out of scope (deferred):
- Multi-line block predictions (we ship single-line + multi-line single response, but no "predict next 5 edits" — Cursor's flagship feature)
- Custom model fine-tuning
- Speculative edit caching
- Streaming partial completions into ghost text (one-shot only in v1)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  CodeMirror Editor                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ inlineCompletionExtension                                  │  │
│  │  - debounce(350ms) on doc change                           │  │
│  │  - extract { prefix, suffix } from view state              │  │
│  │  - cancel previous AbortController                          │  │
│  │  - fetch("/api/completion/inline", {...})                   │  │
│  │  - render returned text as ghost decoration                 │  │
│  │  - Tab → insert, Esc → dismiss                              │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────────┘
                     │ fetch
┌────────────────────▼────────────────────────────────────────────┐
│  app/api/completion/inline/route.ts                             │
│  - reads provider/model from request body                        │
│  - calls lib/completion/providers.ts → adapter for provider     │
│  - returns { completion: string }                                │
└────────────────────┬────────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────────┐
│  lib/completion/providers.ts                                    │
│  - per-provider completion functions                             │
│  - calls FIM-formatted prompt or plain prefix prompt             │
└─────────────────────────────────────────────────────────────────┘
```

### Files

| File | Change |
|------|--------|
| `lib/completion/fimPrompt.ts` | New — builds FIM (fill-in-middle) prompts |
| `lib/completion/fimPrompt.test.ts` | New |
| `lib/completion/providers.ts` | New — provider-specific completion adapters |
| `lib/completion/providers.test.ts` | New |
| `lib/completion/contextWindow.ts` | New — extract prefix/suffix slices with sane line counts |
| `lib/completion/contextWindow.test.ts` | New |
| `app/api/completion/inline/route.ts` | New — POST handler |
| `app/api/completion/inline/route.test.ts` | New |
| `lib/editor/inlineCompletionExtension.ts` | New — CodeMirror extension |
| `lib/editor/inlineCompletionExtension.test.ts` | New |
| `app/components/marven/CodeEditor.tsx` | Modify — accept `inlineCompletions` prop, include extension |
| `app/components/marven/SettingsModal.tsx` | Modify — add "Inline Completions" section in General |
| `electron/main.js` | Modify — add settings: `inlineCompletionsEnabled`, `inlineCompletionModel`, `inlineCompletionProvider`, `inlineCompletionDebounceMs` |
| `app/page.tsx` | Modify — read settings, pass to EditorPanel → CodeEditor |
| `types/index.ts` | Modify — add `InlineCompletionRequest`, `InlineCompletionResponse` |

---

## Section 1: Context Window

**File:** `lib/completion/contextWindow.ts`

```ts
export interface ContextWindow {
  /** Content before the cursor. */
  prefix: string;
  /** Content after the cursor. */
  suffix: string;
  /** Filename without path. */
  filename: string;
  /** Language id (e.g. "typescript", "python") — best-effort from extension. */
  languageId: string;
  /** 0-indexed line of the cursor in the original document. */
  cursorLine: number;
}

export interface ContextWindowOptions {
  /** Default 50. */
  linesBefore?: number;
  /** Default 20. */
  linesAfter?: number;
  /** Default 8000 chars per side — hard cap to bound token usage. */
  maxCharsPerSide?: number;
}

export function extractContextWindow(
  doc: string,
  cursorOffset: number,
  filePath: string,
  opts?: ContextWindowOptions
): ContextWindow;
```

Algorithm:
- Split doc by `"\n"`.
- Find `cursorLine = doc[..cursorOffset].split("\n").length - 1`, `cursorChar = …`.
- Take `lines[max(0, cursorLine - 50)..cursorLine]` joined, plus the current line up to `cursorChar` → **prefix**.
- Take `lines[cursorLine][cursorChar..]` plus `lines[cursorLine+1..cursorLine+20]` joined → **suffix**.
- If either exceeds `maxCharsPerSide`, slice from the inside (closest to cursor).

`filename`/`languageId` derived from `filePath`.

---

## Section 2: FIM Prompt Builder

**File:** `lib/completion/fimPrompt.ts`

Different models support different FIM formats. The builder picks the right one based on `model`:

```ts
export type FimFormat = "openai-fim" | "qwen-fim" | "codestral-fim" | "deepseek-fim" | "plain";

export interface FimPrompt {
  format: FimFormat;
  /** For chat-style providers (OpenAI, Anthropic). */
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** For raw-completion providers (Ollama generate, llama-server completion). */
  raw?: string;
  /** Stop sequences hinted to the provider. */
  stop?: string[];
}

export function buildFimPrompt(ctx: ContextWindow, model: string): FimPrompt;
```

### Format dispatch

```
if model matches /codestral/i              → codestral-fim   ("[SUFFIX]...[PREFIX]..." inverted form)
if model matches /qwen.*coder|qwen2.*coder/i → qwen-fim       ("<|fim_prefix|>...<|fim_suffix|>...<|fim_middle|>")
if model matches /deepseek.*coder/i        → deepseek-fim    ("<｜fim▁begin｜>...<｜fim▁hole｜>...<｜fim▁end｜>")
otherwise (chat models)                    → "plain"         (a system+user message asking to complete from prefix, with suffix as context)
```

### Plain (chat) prompt

```
system: "You are an inline code completion engine. Output ONLY the code that should be inserted at the cursor. No prose, no markdown, no fences. Stop as soon as the completion is complete (usually one logical unit: a line, an expression, a small block)."

user: "File: src/utils/parse.ts (typescript)

Code before cursor:
```typescript
{prefix}
```

Code after cursor:
```typescript
{suffix}
```

Insert the code that should appear at the cursor. Output only the insertion."
```

Stop sequences: `["\n\n", "```"]`.

---

## Section 3: Provider Adapters

**File:** `lib/completion/providers.ts`

```ts
export interface CompletionRequest {
  provider: AIProvider;
  model: string;
  prompt: FimPrompt;
  signal: AbortSignal;
  maxTokens?: number;      // default 128
  temperature?: number;    // default 0.2
}

export async function completeOnce(req: CompletionRequest): Promise<string>;
```

Per-provider:

- **openai / openrouter / groq / nim** → `POST /v1/chat/completions` with `messages`, `max_tokens`, `temperature`, `stop`. Returns `choices[0].message.content`.
- **anthropic** → `POST /v1/messages` with `system` + `user` content. Returns `content[0].text`.
- **ollama** → if `format === "plain"`, use `/api/chat` with messages; if FIM, use `/api/generate` with `prompt: prompt.raw`. `options: { stop, num_predict, temperature }`.
- **lmstudio / llamaserver** → `POST /v1/completions` (raw) or `/v1/chat/completions` (chat) depending on format. Both support OpenAI-compatible endpoints.

All adapters honor `signal: AbortSignal` so debounce/cancel works.

**Post-processing applied to every result:**

1. Trim trailing `</code>`, code fence markers, the explanation prefix "Here is..." (defensive).
2. If the completion starts with the *first line of suffix* verbatim (model echoed the suffix), drop that.
3. Strip leading whitespace if it would create double indentation (heuristic: if prefix's last line ends with whitespace and completion also starts with whitespace, drop completion's leading whitespace).

---

## Section 4: API Route

**File:** `app/api/completion/inline/route.ts`

```ts
POST /api/completion/inline
Body: {
  prefix: string,
  suffix: string,
  filePath: string,
  languageId: string,
  provider: AIProvider,
  model: string
}
Response 200: { completion: string }     // possibly empty string
Response 400: { error: string }          // bad params
Response 502: { error: string }          // provider failure
```

Behavior:
1. Validate body shape.
2. Build `ContextWindow` shape (the caller already split — the route just wraps).
3. `buildFimPrompt(ctx, model)`.
4. `completeOnce(...)` with a 4-second timeout AbortController.
5. Return `{ completion }`.

If the client aborts (`request.signal.aborted`), the AbortController for `completeOnce` is also aborted.

---

## Section 5: CodeMirror Extension

**File:** `lib/editor/inlineCompletionExtension.ts`

CodeMirror 6 has a built-in `inlineCompletion` source we can wire to. We provide a `Source` that fetches our API and returns a single completion.

```ts
export interface InlineCompletionOptions {
  enabled: boolean;
  debounceMs?: number;           // default 350
  provider: AIProvider;
  model: string;
  filePath: string;
  workspaceRoot: string;
  /** Called when user accepts a completion. Used for telemetry. */
  onAccept?: (chars: number) => void;
  /** Called when user dismisses. */
  onDismiss?: () => void;
}

export function inlineCompletionExtension(opts: InlineCompletionOptions): Extension;
```

Internal pieces:
- A `StateField<{ completion: string | null; from: number }>` holds the current ghost.
- A debounced `EditorView.updateListener` triggers when the doc/selection changes:
  - Bail if `!enabled`, or user is in a multi-cursor selection, or inside a known "do not suggest" position (right after `//`, inside a string mid-token — simple heuristics).
  - Cancel pending fetch.
  - Build context, fetch, on response dispatch a `StateEffect` setting the new ghost.
- A `Decoration.widget` of class `cm-inline-completion` rendering the ghost faded inline at the cursor.
- A `keymap`: Tab → if ghost exists, insert it + dismiss; Esc → dismiss.
- On any explicit user edit (typing while ghost shown), dismiss.

### Edge cases

- **Don't show if it's just whitespace** — e.g. user just pressed Enter, model returns indentation we already have.
- **Don't show if exactly equal to suffix start** — model just echoed.
- **Don't show on the very first character of an empty file** — context too thin.
- **Backspace cancels** — dismiss when the user deletes.
- **Race conditions** — completion arrives after user has typed past it; compare `state.doc.length` and cursor position at request time vs response time, dismiss if cursor moved.

---

## Section 6: Settings UI

**File:** `app/components/marven/SettingsModal.tsx`

New section under General, "Inline Completions":

```
Inline Completions
──────────────────
[Toggle] Enable inline completions               ON
         Ghost-text suggestions appear as you type. Tab to accept.

Provider:  [ Ollama          ▼ ]
Model:     [ qwen2.5-coder:7b ▼ ]
           Tip: small, fast models work best. Qwen2.5-Coder and
           DeepSeek-Coder support FIM natively.

Trigger delay: ───────●───── 350 ms

Stats this session: 47 accepted · 128 dismissed · 27% accept rate
[Reset stats]
```

Stored settings:
- `inlineCompletionsEnabled: boolean` (default `false` — opt-in to avoid surprising users)
- `inlineCompletionProvider: AIProvider` (default same as chat provider)
- `inlineCompletionModel: string` (default empty → falls back to chat model)
- `inlineCompletionDebounceMs: number` (default `350`, range `100–1500`)

Telemetry stats live in `sessionStorage` keyed by app session (not persistent across reloads — by design, no PII).

---

## Section 7: Wiring

**File:** `app/page.tsx`

- Read four new settings on mount; subscribe to `marven:settings-changed`.
- Pass them to `EditorPanel` → `CodeEditor` as `inlineCompletions={{ enabled, provider, model, debounceMs }}`.

**File:** `app/components/marven/CodeEditor.tsx`

- New optional prop `inlineCompletions?: { enabled, provider, model, debounceMs }`.
- When set & `enabled`, include `inlineCompletionExtension({ ...opts, filePath, workspaceRoot })` via a Compartment so the extension can be reconfigured without rebuilding the editor.

---

## Section 8: Testing

### Unit

- `contextWindow.test.ts` — slice correctness near top of file, middle, end of file; over `maxCharsPerSide` clamped.
- `fimPrompt.test.ts` — each format produces correct token markers; chat format produces system+user with prefix/suffix interpolated.
- `providers.test.ts` — mocked fetch; assert each provider sends the correct URL, headers, body shape; AbortSignal forwarded.
- `route.test.ts` — happy path returns `{ completion }`; bad body returns 400; timeout returns 502.
- `inlineCompletionExtension.test.ts` — mocked fetch; on typing, debounce fires; ghost decoration appears; Tab inserts; Esc dismisses; backspace dismisses; cursor-moved cancels.

### Manual

1. Settings → enable, pick `ollama / qwen2.5-coder:1.5b` (fast).
2. Open a TS file, type `function add(a: number, b: number) {`.
3. Wait ~400ms → ghost text suggests `return a + b;`.
4. Tab → accepted.
5. Type something obviously wrong, ghost should reflect surrounding context.

---

## Section 9: Performance + Cost

- **Local providers**: free, fast on small models (Qwen2.5-Coder:1.5b → ~200ms for a 1-line completion on M1).
- **Cloud providers**: ~$0.10–$0.50 per 1000 keystrokes with gpt-4o-mini, similar with Haiku. Bounded by debounce + abort.
- **Token budget per call**: ≤2000 in + 128 out. Single request, no streaming.
- **Cancellation**: a typing user fires + cancels in rapid sequence; the AbortController is essential.

---

## Section 10: Error Handling

- **Ollama down**: fetch fails → swallow silently (no ghost text) + log to console. No error toast — would be annoying during typing.
- **Cloud rate-limit**: same — silent fail.
- **Timeout (>4s)**: silent dismiss.
- **Bad model name**: provider returns 4xx → silent dismiss, but surface in Settings ("Last completion error: …") so user can debug.

The principle: inline completions are a quality-of-life feature; never interrupt the user's flow with errors.

---

## What Does Not Change

- The agent loop, the chat model, the agent's tool set, tier classifier — untouched.
- Codebase indexing (Phase 2) — untouched. (Could be used as future context source, but not in v1.)
- LSP (Phase 1) — untouched. (LSP completions and inline AI completions coexist; LSP is for symbol-aware popups, AI is for context-aware ghost text.)
- The editor's existing CodeMirror extensions — additive.

---

## Future (Phase 3.5)

- **Streaming ghost text** — show partial results as they arrive
- **Multi-line predictions** — predict not just the line but the next 5 likely edits (Cursor's flagship)
- **Index-augmented context** — include top-K relevant chunks from Phase 2's index in the prompt
- **Speculative caching** — pre-fetch on cursor pause before typing
- **A/B model selection** — best-of-two between two models
