# Wave 1 — Providers & Storage Design

**Goal:** Add OpenAI and Anthropic as first-class providers (chat + agent) and persist the active provider/model per conversation so switching conversations restores the correct model.

**Architecture:** Two new provider libs mirroring existing Groq/OpenRouter shape, wired into the chat route, agent route, and models route. Conversation type gains optional `provider` + `model` fields written on send and restored on conversation switch.

**Tech Stack:** `openai` npm package, `@anthropic-ai/sdk` npm package, existing Next.js API routes, localStorage via `lib/storage.ts`.

---

## 1. Type changes (`types/index.ts`)

- `AIProvider` union: add `"openai"` and `"anthropic"`
- `Conversation` interface: add `provider?: AIProvider` and `model?: string`

No migration needed — optional fields mean existing stored conversations load without issue and fall back to the current global selection.

---

## 2. Chat lib files

### `lib/openai.ts`
- Exports `streamChat(req: ChatRequest, onChunk: (delta: string) => void): Promise<TokenUsage>`
- Uses `openai` npm package
- `client.chat.completions.create({ model, messages, stream: true })`
- Reads `chunk.choices[0].delta.content` per chunk
- Returns token usage from `chunk.usage` on the final chunk

### `lib/anthropic.ts`
- Exports `streamChat(req: ChatRequest, onChunk: (delta: string) => void): Promise<TokenUsage>`
- Uses `@anthropic-ai/sdk` npm package
- `client.messages.stream({ model, messages, max_tokens: 8192 })`
- Reads `event.delta.text` on `text_delta` events
- Returns token usage from the final `message_stop` event

Both accept the existing `ChatRequest` shape unchanged. Both check for their API key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) and throw a descriptive error if missing.

---

## 3. Agent adapter files

### `lib/agent/openai.ts`
- Exports `streamAgent(messages: InternalMessage[], tools: ToolDefinition[], onEvent: (e: AgentEvent) => void): Promise<void>`
- Uses `openai` npm package, `client.chat.completions.create({ tools, stream: true })`
- Parses `tool_calls` from delta chunks (OpenAI's native format already matches the internal shape)
- Emits `tool_call`, `text_delta`, and `done` events matching the existing `AgentEvent` union

### `lib/agent/anthropic.ts`
- Exports `streamAgent(messages: InternalMessage[], tools: ToolDefinition[], onEvent: (e: AgentEvent) => void): Promise<void>`
- Uses `@anthropic-ai/sdk`, `client.messages.stream({ tools })`
- Maps Anthropic's `tool_use` block format → internal `tool_call` event
- Maps `content_block_delta` text → `text_delta` event
- Emits `done` on `message_stop`

---

## 4. API route changes

### `app/api/chat/route.ts`
Add two new `case` branches in the provider switch:
```
case "openai": return streamChat via lib/openai.ts
case "anthropic": return streamChat via lib/anthropic.ts
```

### `app/api/agent/stream/route.ts`
Add two new `case` branches selecting the adapter:
```
case "openai": adapter = openaiAgent
case "anthropic": adapter = anthropicAgent
```

### `app/api/models/route.ts`
- `"openai"`: fetch `https://api.openai.com/v1/models`, filter to models whose `id` starts with `gpt-`, return as `OllamaModel[]` (name = id, size = 0). Return `{ models: [], error: "No API key" }` with 401 if `OPENAI_API_KEY` is missing.
- `"anthropic"`: return hardcoded list — `claude-opus-4-5`, `claude-sonnet-4-5`, `claude-haiku-3-5` — as `OllamaModel[]`. Return `{ models: [], error: "No API key" }` with 401 if `ANTHROPIC_API_KEY` is missing.

---

## 5. UI changes

### `app/components/marven/GroupedModelDropdown.tsx`
- Add `"openai"` and `"anthropic"` to the `PROVIDERS` array and `PROVIDER_LABELS` map
- Labels: `"OpenAI"` and `"Anthropic"`
- No other changes — the two-panel layout already handles any number of providers

### `app/components/marven/SettingsModal.tsx`
- Add two new API key input fields: `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`
- Same pattern as existing Groq/NIM/OpenRouter fields

### `app/page.tsx`
**On send (`onSend` / `onAgentSend`):**
- Before saving, write `provider` and `model` onto the active conversation object

**On conversation select (`onSelectConversation`):**
- If `conversation.provider` exists, call `setProvider(conversation.provider)`
- If `conversation.model` exists, call `setSelectedModel(conversation.model)`

---

## 6. Environment variables

Two new vars added to `.env.local` (and documented in README):
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

---

## 7. Dependencies to install

```bash
npm install openai @anthropic-ai/sdk
```

Both packages are the official SDKs, stable, and already used widely in Next.js projects.

---

## Out of scope for Wave 1

- Vision/image input for OpenAI or Anthropic
- Anthropic extended thinking
- Fine-tuned model support
- System prompt per conversation (Wave 2)
