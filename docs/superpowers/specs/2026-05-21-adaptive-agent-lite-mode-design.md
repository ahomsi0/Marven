# Adaptive Agent Lite Mode — Design Spec

**Date:** 2026-05-21
**Status:** Approved

---

## Goal

Make Marven's agent work reliably with weaker local models (Ollama, LM Studio, llama-server) by automatically reducing complexity for simple tasks and recovering gracefully from common failure modes.

## Problem

Weaker models (7B–13B) fail the agent loop because:
1. **Too many tools** — 13 tools overwhelm small models; they pick wrong ones or ignore tool calling entirely
2. **System prompt too long** — ~50 lines of instructions get ignored after the first few
3. **No retry on stall** — when a model outputs text instead of calling a tool, the loop stops treating it as a final answer
4. **Context blowup** — after 5+ tool calls, history exceeds the model's context window and it starts repeating or losing track
5. **apply_patch too complex** — the search/replace JSON format trips up smaller models

---

## Scope

This spec covers:
- **Task classification** — simple vs standard tier
- **Tiered tool sets** — 4 tools for simple, 13 for standard
- **Tiered system prompts** — lite (15 lines) vs full (current)
- **Retry on stall** — one recovery prompt when the model stops calling tools mid-task
- **Context pruning** — truncate old tool results when history exceeds 3,000 estimated tokens
- **Settings toggle** — manual override for lite mode

Out of scope:
- Planner/executor architecture split
- Per-model capability database
- Automatic tool suggestion based on task content

---

## Architecture

### Files changed

| File | Change |
|------|--------|
| `lib/agent/taskClassifier.ts` | New — heuristic simple/standard classifier |
| `lib/agent/taskClassifier.test.ts` | New — unit tests |
| `lib/agent/systemPrompts.ts` | New — lite + full prompts extracted from `loop.ts` |
| `lib/agent/loop.ts` | Add retry logic + context pruning, accept `tier` param |
| `app/api/agent/stream/route.ts` | Classify task, select tool set + prompt tier |
| `app/components/marven/SettingsModal.tsx` | Add "Lite agent mode" toggle under General |
| `electron/main.js` | Add `liteAgentMode` boolean to store |

---

## Section 1: Task Classification

**File:** `lib/agent/taskClassifier.ts`

```ts
export type AgentTier = "simple" | "standard";

export function classifyTask(prompt: string): AgentTier
```

### Logic

```
isSimple =
  wordCount(prompt) <= 120
  AND prompt contains at least one SIGNAL word (case-insensitive):
    change, color, colour, rename, fix, replace, update, typo,
    style, font, size, margin, padding, border, background, text
  AND prompt does NOT contain any COMPLEXITY word:
    create, build, install, feature, refactor, add, connect,
    "all files", multiple, across
```

Returns `"simple"` if the condition is met, `"standard"` otherwise.

### Override rules (applied in `route.ts`, not in classifier)

- Cloud providers (groq, openai, anthropic, nim, openrouter) → always `standard` **unless** `liteAgentMode` is manually enabled in Settings
- Local providers (ollama, lmstudio, llamaserver) → use classifier result, but can be **overridden to standard** if `liteAgentMode` is explicitly disabled in Settings
- Manual Settings toggle always wins over auto-detection

---

## Section 2: Tool Sets

**File:** `app/api/agent/stream/route.ts`

The tool list passed to `runAgentLoop` is assembled based on tier.

### Simple tier — 4 tools

```ts
const SIMPLE_TOOLS = ["list_files", "read_file", "write_file", "search_files"];
```

`apply_patch` is excluded — the search/replace JSON format is unreliable for weaker models. `write_file` is used for all edits.

All git tools, `web_search`, `fetch_url`, and `remember` are excluded.

### Standard tier — all tools (unchanged)

All 13 current `TOOL_DEFINITIONS` entries are passed as today.

---

## Section 3: System Prompts

**File:** `lib/agent/systemPrompts.ts`

Exports two functions replacing `makeSystemPrompt` in `loop.ts`:

### `makeLiteSystemPrompt(workspaceRoot, memory?)`

```
You are Marven Agent. The workspace is at: {workspaceRoot}

Your job: make exactly the change the user asked for. Nothing more.

RULES:
- Always call list_files or search_files first to find the right file.
- Call read_file before editing any file.
- Call write_file to save your change. Put the FULL file content in "content".
- Make ONE change at a time. Call one tool per response.
- Do NOT describe what you are doing — just call the tool.
- When done, say "Done." in one sentence.
```

Memory block prepended if present (same pattern as current full prompt).

### `makeFullSystemPrompt(workspaceRoot, memory?)`

Current `makeSystemPrompt` content moved here verbatim. No changes to the text.

### Usage

`loop.ts` accepts a `systemPrompt: string` parameter. The caller (`route.ts`) computes and passes it — loop no longer generates its own prompt.

---

## Section 4: Retry on Stall

**File:** `lib/agent/loop.ts`

A single `retryCount` variable (initialised to `0`) tracks how many recovery prompts have been sent this run.

After `providerStep` returns `{ type: "text" }`:

```
if (
  i > 0                                    // model has seen at least one tool result
  AND retryCount < 1                       // only retry once
  AND result.content does NOT contain
      "done" | "complete" | "finished" |
      "here is" | "here's" | "all done"   // not a genuine final answer
) {
  push recovery message to history:
    { role: "user", content:
      "You must call a tool next. Do not describe what you will do —
       call the tool directly. Available tools: {tool names joined by ', '}." }
  retryCount++
  continue  // loop again
}
```

If the model stalls again after the one retry, the loop falls through to the normal `yield done` path.

---

## Section 5: Context Pruning

**File:** `lib/agent/loop.ts`

After every `history.push({ role: "tool_result", ... })`, check estimated token count:

```ts
function estimateTokens(messages: InternalMessage[]): number {
  return messages.reduce((sum, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + Math.ceil(text.length / 4);
  }, 0);
}
```

If `estimateTokens(history excluding system prompt) > 3000`:

- Find all `tool_result` messages **except the last 2**
- Truncate their `content` to 200 characters + `" […truncated]"`

This runs silently on every iteration. It does not affect `text` or `assistant_tool_call` messages. It never fires on simple tasks (which complete in 2–3 tool calls).

---

## Section 6: Settings Toggle

**File:** `app/components/marven/SettingsModal.tsx`

New toggle added in the **General** tab, in the "Agent" section (create if it doesn't exist):

```
Agent
─────
Lite agent mode    [toggle]
Automatically uses a reduced tool set and shorter instructions.
On by default for local models.
```

Toggle reads/writes `liteAgentMode: boolean` via `electron.saveSettings`.

**File:** `electron/main.js`

Add to store schema (no default needed — `undefined` = auto):

```js
liteAgentMode: boolean | undefined
// undefined = auto (local → lite, cloud → standard)
// true      = always lite
// false     = always standard
```

---

## Behaviour Matrix

| Provider | `liteAgentMode` setting | Effective tier |
|----------|-------------------------|----------------|
| Local (ollama/lmstudio/llamaserver) | undefined (auto) | classifier result |
| Local | true | simple |
| Local | false | standard |
| Cloud (groq/openai/etc.) | undefined (auto) | standard |
| Cloud | true | simple |
| Cloud | false | standard |

---

## Testing

- **`lib/agent/taskClassifier.test.ts`** — unit tests for `classifyTask`:
  - "change the button color to red" → `simple`
  - "build a new authentication feature" → `standard`
  - "fix the typo in the header" → `simple`
  - "install the react-router package" → `standard`
  - prompt > 120 words → `standard`
- **`lib/agent/loop.test.ts`** — extend existing tests:
  - retry fires when model returns text mid-task with no terminal phrase
  - retry does not fire twice
  - context pruning truncates old tool results when threshold exceeded
  - context pruning keeps last 2 tool results intact
- **`lib/agent/systemPrompts.test.ts`** — smoke tests:
  - both prompts include workspaceRoot
  - memory block is prepended when provided
  - lite prompt is shorter than full prompt

---

## What Does Not Change

- The tool execution logic (`executeTool`) — unchanged
- The write-approval gate — unchanged, applies to both tiers
- Plan mode — unchanged, only available in standard tier (classifier always returns standard for long planning prompts)
- MCP tools — appended after the base tool list in both tiers
- The narrated tool call parser (`parseNarratedToolCall`) — unchanged, already handles weak model output formats
