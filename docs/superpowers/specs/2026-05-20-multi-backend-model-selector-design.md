# Multi-Backend Model Selector — Design Spec

**Date:** 2026-05-20
**Status:** Approved

---

## Goal

Add LM Studio and llama-server as local AI backends, and replace the cluttered provider dropdown with a cleaner Local/Cloud split UI. Provider configuration moves to a dedicated Settings panel.

## Scope

This spec covers:
- **A** — LM Studio backend
- **B** — llama-server (llama.cpp) backend
- **UI** — ModelSelector component (replaces GroupedModelDropdown)
- **UI** — Settings → AI Backends panel

Out of scope (separate specs):
- **C** — Hardware-aware backend recommendations
- **D** — Reduced LLM dependence for simple tasks

---

## Architecture

### Files changed

| File | Change |
|------|--------|
| `types/index.ts` | Add `"lmstudio" \| "llamaserver"` to `AIProvider` |
| `app/components/marven/ModelSelector.tsx` | New — replaces `GroupedModelDropdown.tsx` |
| `app/components/marven/GroupedModelDropdown.tsx` | Deleted |
| `app/components/marven/InputBar.tsx` | Swap import to `ModelSelector` |
| `app/components/marven/SettingsModal.tsx` | Add "AI Backends" tab/section |
| `lib/lmstudio.ts` | New — LM Studio streaming + model listing |
| `lib/llamaserver.ts` | New — llama-server streaming + model listing |
| `app/api/chat/route.ts` | Add `lmstudio` and `llamaserver` branches |
| `app/api/models/route.ts` | Add `lmstudio` and `llamaserver` branches |
| `electron/main.js` | Add `enabledProviders`, `lmStudioUrl`, `llamaServerUrl` to store |

### Tech stack

React 19, TypeScript, Tailwind CSS v4, Electron Store (via IPC), OpenAI SDK (reused for both new local backends), Vitest.

---

## Section 1: Data layer

### Electron Store — new fields

```ts
// Added to the settings object
enabledProviders: {
  groq: boolean        // default: true
  ollama: boolean      // default: true
  nim: boolean         // default: false
  openrouter: boolean  // default: false
  openai: boolean      // default: true
  anthropic: boolean   // default: false
  lmstudio: boolean    // default: false
  llamaserver: boolean // default: false
}
lmStudioUrl: string    // default: "http://localhost:1234"
llamaServerUrl: string // default: "http://localhost:8080"
lastUsedProvider: AIProvider  // default: "groq"
lastUsedModel: string         // default: "llama-3.3-70b-versatile"
```

### Defaults

On first load (when `enabledProviders` is absent from the store), the app writes the defaults above. This keeps the dropdown minimal out of the box — users opt in to what they actually have installed.

### Read/write pattern

Follows the existing pattern in `SettingsModal.tsx`:
- Load: `electron.getSettings()` on mount
- Save: `electron.getSettings()` → merge → `electron.saveSettings({ ...current, ...changes })`
- `lastUsedProvider` / `lastUsedModel` are written whenever the user changes selection in `ModelSelector`

---

## Section 2: New backends

Both LM Studio and llama-server expose an OpenAI-compatible REST API. Both modules follow the exact same shape as existing provider modules in `lib/`.

### `lib/lmstudio.ts`

```ts
// Key exports
export async function streamLMStudio(
  messages: Message[],
  model: string,
  systemPrompt: string,
  settings: Settings
): Promise<ReadableStream>

export async function getLMStudioModels(url: string): Promise<string[]>
```

- Creates `new OpenAI({ baseURL: url + "/v1", apiKey: "lm-studio" })`
- LM Studio ignores the API key value; the SDK requires a non-empty string
- `getLMStudioModels` hits `GET /v1/models`, returns `data[].id`
- On connection failure, `getLMStudioModels` returns `[]`

### `lib/llamaserver.ts`

Identical shape to `lib/lmstudio.ts`:

```ts
export async function streamLlamaServer(
  messages: Message[],
  model: string,
  systemPrompt: string,
  settings: Settings
): Promise<ReadableStream>

export async function getLlamaServerModels(url: string): Promise<string[]>
```

- Creates `new OpenAI({ baseURL: url + "/v1", apiKey: "llama-server" })`
- On connection failure, returns `[]`

### Error messages

If a local server is unreachable at request time, the chat route returns a structured error the UI already handles:

- LM Studio: `"LM Studio is not running. Start it and try again."`
- llama-server: `"llama-server is not running. Start it and try again."`

### `app/api/chat/route.ts`

Two new `else if` branches added to the existing provider chain:

```ts
} else if (provider === "lmstudio") {
  return streamLMStudio(messages, model, systemPrompt, settings);
} else if (provider === "llamaserver") {
  return streamLlamaServer(messages, model, systemPrompt, settings);
}
```

### `app/api/models/route.ts`

Two new branches:

```ts
} else if (provider === "lmstudio") {
  models = await getLMStudioModels(settings.lmStudioUrl ?? "http://localhost:1234");
} else if (provider === "llamaserver") {
  models = await getLlamaServerModels(settings.llamaServerUrl ?? "http://localhost:8080");
}
```

---

## Section 3: ModelSelector component

**File:** `app/components/marven/ModelSelector.tsx`

Replaces `GroupedModelDropdown.tsx`. Mounted in `InputBar.tsx` in the same position.

### Trigger button (in the input bar)

```
● model-name · Provider  ▾
```

- Green dot when the selected provider is local and reachable; no dot for cloud
- Clicking opens the popup upward

### Popup structure

```
┌─────────────────────────────┐
│  ☁ Cloud  │  ⬡ Local        │  ← tab bar
├─────────────────────────────┤
│  [Groq]  [OpenAI]           │  ← provider chips (enabled only)
├─────────────────────────────┤
│  ● llama-3.3-70b-versatile  │
│    llama-3.1-8b-instant     │  ← model list
│    mixtral-8x7b-32768       │
└─────────────────────────────┘
```

**Tab bar:** Cloud / Local. Switching tabs shows only the enabled providers in that category.

**Provider chips:** One chip per enabled provider in the active tab. Active chip highlighted in gold. Hovering/clicking a chip loads its model list.

**Model list:** Scrollable. Fetched from `/api/models?provider=X` on chip hover (150 ms debounce to avoid thrashing). Active model shown with a filled dot.

**Empty state:** If a tab has no enabled providers: *"Enable backends in Settings → AI Backends"*

**On selection:** Writes `lastUsedProvider` + `lastUsedModel` to Electron Store via `electron.saveSettings`.

**On mount:** Reads `lastUsedProvider` + `lastUsedModel` from settings. Falls back to first enabled provider + first available model if the saved selection is no longer enabled.

**Closing:** Click outside or press Escape.

---

## Section 4: Settings — AI Backends panel

**File:** `app/components/marven/SettingsModal.tsx`

New tab labelled **"AI Backends"** added alongside existing tabs.

### Layout

```
AI Backends
───────────

CLOUD
  ⚡ Groq      [cloud]   5 models · API key set          [toggle ON ]
  ◈ OpenAI    [cloud]   4 models · API key set          [toggle ON ]
  ✦ Anthropic [cloud]   No API key                       [toggle OFF]
  ◈ NIM       [cloud]   5 models · API key set          [toggle OFF]
  ◉ OpenRouter[cloud]   5 models · API key set          [toggle OFF]

LOCAL
  🦙 Ollama       [local]  3 models · ● running           [toggle ON ]
  ◉ LM Studio     [local]  2 models · ● running  [localhost:1234]  [toggle ON ]
  ⬡ llama-server  [local]  Not running           [localhost:8080]  [toggle OFF]
```

### Row behaviour

- **Toggle:** Immediately writes the changed `enabledProviders` entry to Electron Store via `electron.saveSettings`
- **URL fields** (LM Studio, llama-server): Save on blur. Validated with `new URL()` — invalid input shows a red border and reverts on blur
- **Status check:** On mount of the AI Backends section, fires `/api/models?provider=X` for each local backend. Shows `● running` if models come back, `✗ not running` if it errors or returns `[]`
- Cloud provider meta (model count) is the count from the static model list, not a live fetch
- A cloud provider with no API key can be toggled on — it will fail gracefully at request time

### Icons & colours

| Provider | Icon | Colour |
|----------|------|--------|
| Groq | ⚡ | `#d19a66` |
| OpenAI | ◈ | `#61afef` |
| Anthropic | ✦ | `#c678dd` |
| NIM | ◈ | `#61afef` |
| OpenRouter | ◉ | `#e06c75` |
| Ollama | 🦙 | `#98c379` |
| LM Studio | ◉ | `#e06c75` |
| llama-server | ⬡ | `#e5c07b` |

---

## Testing

- **`lib/lmstudio.test.ts`** — unit tests for `getLMStudioModels`: resolves correctly, returns `[]` on connection failure
- **`lib/llamaserver.test.ts`** — same for `getLlamaServerModels`
- **`lib/changelog.test.ts`** already covers the changelog module (no changes)
- No unit tests for UI components — behaviour verified by running the app

---

## What does not change

- The `/api/models` and `/api/chat` endpoint contracts
- How existing providers (Groq, Ollama, OpenAI, Anthropic, NIM, OpenRouter) work internally
- The `Message`, `Conversation`, and other core types
- API key storage (existing Electron Store keys unchanged)
