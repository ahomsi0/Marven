# Inline AI Completions — Implementation Plan

**Date:** 2026-05-24
**Spec:** `docs/superpowers/specs/2026-05-24-inline-completions-design.md`
**Branch:** `feat/inline-completions`

---

## Approach

Strict TDD: every task lands a failing test, then the implementation. Single commit per task using conventional commits (`feat(completions): …`, `test(completions): …`, `chore(completions): …`). `npm test` runs Vitest and must pass after each task.

Single-source-of-truth type names live in `types/index.ts`:

```ts
export interface InlineCompletionRequest {
  prefix: string;
  suffix: string;
  filePath: string;
  languageId: string;
  provider: AIProvider;
  model: string;
}
export interface InlineCompletionResponse {
  completion: string;
}
```

`ContextWindow`, `ContextWindowOptions` live in `lib/completion/contextWindow.ts`. `FimPrompt`, `FimFormat` live in `lib/completion/fimPrompt.ts`. `CompletionRequest` (provider-level) lives in `lib/completion/providers.ts`. None are duplicated.

---

## Task 1 — Context window extraction

**Files**
- Create: `lib/completion/contextWindow.ts`
- Test: `lib/completion/contextWindow.test.ts`

**Steps**

- [ ] 1.1 Write test file with the cases: filename/languageId derivation, prefix/suffix split at cursorOffset, linesBefore/linesAfter caps, maxCharsPerSide clamp from the inside, common extension → languageId map.
- [ ] 1.2 Implement `extractContextWindow(doc, cursorOffset, filePath, opts?)`. Default `linesBefore=50`, `linesAfter=20`, `maxCharsPerSide=8000`.
- [ ] 1.3 `npm test`: passes.
- [ ] 1.4 Commit: `test(completions): add contextWindow extractor and tests`.

(See spec Section 1 + agent prompt for full code; tests precisely as listed.)

---

## Task 2 — FIM prompt builder

**Files**
- Create: `lib/completion/fimPrompt.ts`
- Test: `lib/completion/fimPrompt.test.ts`

**Steps**

- [ ] 2.1 Tests covering: qwen-coder format, deepseek-coder format, codestral inverted format, default → plain chat, stop sequences populated.
- [ ] 2.2 Implement `buildFimPrompt(ctx, model)` with the four model regexes and the plain fallback. Plain emits `messages: [system, user]` with the prompt template from the spec.
- [ ] 2.3 `npm test`: passes.
- [ ] 2.4 Commit: `feat(completions): add FIM prompt builder with per-model formats`.

---

## Task 3 — Provider adapters

**Files**
- Create: `lib/completion/providers.ts`
- Test: `lib/completion/providers.test.ts`

**Steps**

- [ ] 3.1 Tests, one per provider (openai, anthropic, ollama-chat, ollama-fim, lmstudio, llamaserver, groq, openrouter, nim) plus post-processing tests (strip code fences, "Here is:" prefix, suffix echo).
- [ ] 3.2 Implement `completeOnce(req)` dispatching by provider; each adapter `POST`s the right URL and body shape, forwards `req.signal`, returns the text. Apply `postProcess` before returning.
- [ ] 3.3 `npm test`: passes (≥9 cases pass).
- [ ] 3.4 Commit: `feat(completions): add provider adapters for 8 backends`.

---

## Task 4 — API route `/api/completion/inline`

**Files**
- Create: `app/api/completion/inline/route.ts`
- Test: `app/api/completion/inline/route.test.ts`
- Modify: `types/index.ts` (add `InlineCompletionRequest`, `InlineCompletionResponse`)

**Steps**

- [ ] 4.1 Add the two types to `types/index.ts`.
- [ ] 4.2 Write route tests: happy path returns `{ completion }`, 400 on bad body, 502 on provider failure, empty completion on abort. Mock `@/lib/completion/providers.completeOnce`.
- [ ] 4.3 Implement `POST(request: Request)`: parse + validate, build context, `buildFimPrompt`, 4-second timeout AbortController also tied to request abort, `completeOnce`, return JSON.
- [ ] 4.4 `npm test`: passes.
- [ ] 4.5 Commit: `feat(completions): add /api/completion/inline route`.

---

## Task 5 — CodeMirror inline completion extension

**Files**
- Create: `lib/editor/inlineCompletionExtension.ts`
- Test: `lib/editor/inlineCompletionExtension.test.ts` (`// @vitest-environment jsdom` at top)

**Steps**

- [ ] 5.1 Tests with jsdom + `vi.useFakeTimers()`, driving a real `EditorView`. Cases:
  - Typing dispatches debounced fetch → ghost appears after `vi.advanceTimersByTime(debounceMs)`.
  - Tab while ghost shown → inserts, moves cursor, clears ghost, calls `onAccept` with char count.
  - Esc dismisses + `onDismiss` called.
  - Any subsequent doc change (backspace, more typing) dismisses ghost.
  - Cursor moved before fetch resolves → ghost not set.
  - Newer request supersedes older response.
  - Empty doc → no trigger.
  - Multi-cursor → no trigger.
- [ ] 5.2 Implement `inlineCompletionExtension(opts)` returning `[ghostField, ViewPlugin, Prec.highest(keymap)]`. Export `inlineCompletionCompartment` for caller-driven reconfigure.
- [ ] 5.3 Inline post-response guards: cursor unchanged, request id matches, completion not whitespace-only, completion not equal to suffix prefix.
- [ ] 5.4 `npm test`: passes.
- [ ] 5.5 Commit: `feat(completions): add CodeMirror inline completion extension`.

---

## Task 6 — Electron settings storage

**Files**
- Modify: `electron/main.js` (add four new keys to defaults)
- Create: `lib/completion/settingsClient.ts`
- Create: `lib/completion/settingsClient.test.ts`

**Steps**

- [ ] 6.1 Add the four keys to the settings defaults next to existing keys (`liteAgentMode`, `codebaseIndexEnabled`):
  - `inlineCompletionsEnabled: false`
  - `inlineCompletionProvider: "ollama"`
  - `inlineCompletionModel: ""`
  - `inlineCompletionDebounceMs: 350`
  Confirm `saveSettings` already passes the object through unchanged.
- [ ] 6.2 Implement `lib/completion/settingsClient.ts` exporting `readInlineCompletionSettings()` reading from `(window as any).marvenElectron?.getSettings()` with fallbacks to defaults.
- [ ] 6.3 Tests with a fake `globalThis.window.marvenElectron.getSettings`: missing window, missing settings, partial settings, full settings.
- [ ] 6.4 `npm test`: passes.
- [ ] 6.5 Commit: `feat(completions): persist inline completion settings in electron`.

---

## Task 7 — Settings UI + telemetry

**Files**
- Modify: `app/components/marven/SettingsModal.tsx`
- Create: `lib/completion/telemetry.ts`
- Create: `lib/completion/telemetry.test.ts`

**Steps**

- [ ] 7.1 Implement `lib/completion/telemetry.ts`: `recordAccept(chars)`, `recordDismiss()`, `readStats()` returning `{ accepts, dismisses, chars, rate }`, `resetStats()`. Use `sessionStorage`. Tests cover increment, read, reset, rate math (0/0 → 0, 5/(5+5) → 0.5).
- [ ] 7.2 In `SettingsModal.tsx`: hydrate four `useState` from electron settings (mirror the LSP/index pattern). Add a new "Inline Completions" section under General with: toggle, provider dropdown, model dropdown (reuse `ModelSelector` if applicable), debounce range slider (100–1500, step 50), stats display, "Reset stats" button.
- [ ] 7.3 Each control writes via `saveBackendSettings({ ... })` and dispatches `window.dispatchEvent(new CustomEvent("marven:settings-changed"))`.
- [ ] 7.4 `npm test`: passes (telemetry tests).
- [ ] 7.5 Commit: `feat(completions): settings UI section and session telemetry`.

---

## Task 8 — Wire through editor surface + manual smoke

**Files**
- Modify: `app/page.tsx`
- Modify: `app/components/marven/ChatLayout.tsx`
- Modify: `app/components/marven/AgentWorkspace.tsx`
- Modify: `app/components/marven/EditorPanel.tsx`
- Modify: `app/components/marven/CodeEditor.tsx`

**Steps**

- [ ] 8.1 In `app/page.tsx`: import `readInlineCompletionSettings`, add `inlineCompletionSettings` state, load on mount, subscribe to `marven:settings-changed`. Pass as `inlineCompletions={inlineCompletionSettings}` to ChatLayout.
- [ ] 8.2 Thread `inlineCompletions` prop through ChatLayout → AgentWorkspace → EditorPanel → CodeEditor (same pattern as `onApplyWorkspaceEdit` in Phase 1).
- [ ] 8.3 In `CodeEditor.tsx`: import `inlineCompletionExtension` and `inlineCompletionCompartment`. On first mount, include `inlineCompletionCompartment.of(buildExt(currentInlineCompletions))`. On `useEffect` watching `inlineCompletions`, `view.dispatch({ effects: inlineCompletionCompartment.reconfigure(buildExt(...)) })`.
- [ ] 8.4 `buildExt(c)` returns `inlineCompletionExtension({ enabled: c?.enabled ?? false, provider: c?.provider ?? "ollama", model: c?.model ?? "", debounceMs: c?.debounceMs ?? 350, filePath, workspaceRoot, onAccept: recordAccept, onDismiss: recordDismiss })` or `[]` if disabled.
- [ ] 8.5 Add `.cm-inline-completion { opacity: .45; font-style: italic; white-space: pre; }` to the editor stylesheet (find via grep for existing `.cm-` selectors).
- [ ] 8.6 `npx tsc --noEmit`: clean.
- [ ] 8.7 `npm test`: passes.
- [ ] 8.8 Commit body must include manual smoke checklist:
  1. Enable in Settings, pick `ollama` + `qwen2.5-coder:1.5b`.
  2. Open a `.ts` file, type `function add(a: number, b: number) {`.
  3. After ~400ms a ghost suggests a body (e.g. `return a + b;`).
  4. Tab → inserted; cursor at end of insertion.
  5. Esc dismisses the next suggestion.
  6. Backspace clears the ghost.
- [ ] 8.9 Commit: `chore(completions): wire inline completions into editor surface`.

---

## Spec coverage check

| Spec section | Task |
|---|---|
| 1 Context window | 1 |
| 2 FIM prompt builder | 2 |
| 3 Provider adapters + post-processing | 3 |
| 4 API route | 4 |
| 5 CodeMirror extension | 5 |
| 6 Settings UI | 7 |
| 6 Settings storage | 6 |
| 7 Wiring | 8 |
| 8 Unit tests | 1–5, 7 |
| 8 Manual smoke | 8 |
| 9 Performance | 3, 5 (debounce + abort) |
| 10 Silent error handling | 3, 4, 5 |

All sections covered.
