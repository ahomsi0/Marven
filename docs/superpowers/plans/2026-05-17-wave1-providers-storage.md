# Wave 1 — Providers & Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenAI and Anthropic as first-class providers for both chat and agent modes, and persist the active provider + model per conversation so switching between chats restores the correct model.

**Architecture:** Six new/modified lib files mirror the existing Groq/OpenRouter pattern exactly. Three API routes get new provider branches. The UI picks up new providers automatically via the shared `PROVIDERS` array. `Conversation` gains optional `provider` + `model` fields written on send and restored on conversation switch.

**Tech Stack:** `openai` npm SDK, `@anthropic-ai/sdk` npm SDK, Next.js API routes, Electron IPC for key storage, localStorage via `lib/storage.ts`.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `types/index.ts` | Modify | Add `"openai" \| "anthropic"` to `AIProvider`; add `provider?`, `model?` to `Conversation` |
| `lib/openai.ts` | Create | OpenAI chat streaming — exports `streamOpenAI`, `OPENAI_MODELS`, `DEFAULT_MODEL` |
| `lib/anthropic.ts` | Create | Anthropic chat streaming — exports `streamAnthropic`, `ANTHROPIC_MODELS`, `DEFAULT_MODEL` |
| `lib/agent/openai.ts` | Create | OpenAI agent step — exports `openaiAgentStep` |
| `lib/agent/anthropic.ts` | Create | Anthropic agent step — exports `anthropicAgentStep` |
| `app/api/models/route.ts` | Modify | Add `openai` and `anthropic` cases |
| `app/api/chat/route.ts` | Modify | Add `openai` and `anthropic` streaming cases |
| `app/api/agent/stream/route.ts` | Modify | Add `openai` and `anthropic` adapter selection |
| `app/components/marven/GroupedModelDropdown.tsx` | Modify | Add `"openai"` and `"anthropic"` to `PROVIDERS` and `PROVIDER_LABELS` |
| `app/components/marven/SettingsModal.tsx` | Modify | Add OpenAI and Anthropic API key fields |
| `electron/main.js` | Modify | Inject `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` into `process.env` |
| `app/page.tsx` | Modify | Add openai/anthropic to `selectedModelByProvider`; save provider+model on send; restore on conversation select |

---

## Task 1: Install dependencies and verify TypeScript compiles

**Files:**
- Run: `npm install openai @anthropic-ai/sdk`
- Verify: `npx tsc --noEmit`

- [ ] **Step 1: Install the two SDKs**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
npm install openai @anthropic-ai/sdk
```

Expected output: `added N packages` with no errors.

- [ ] **Step 2: Verify existing TypeScript still compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (clean compile). If errors exist, do not proceed — fix them first.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install openai and @anthropic-ai/sdk"
```

---

## Task 2: Update types

**Files:**
- Modify: `types/index.ts`

- [ ] **Step 1: Extend `AIProvider` and `Conversation`**

Open `types/index.ts`. Make exactly these two changes:

Change line 2 from:
```ts
export type AIProvider = "groq" | "ollama" | "nim" | "openrouter";
```
To:
```ts
export type AIProvider = "groq" | "ollama" | "nim" | "openrouter" | "openai" | "anthropic";
```

Add `provider` and `model` fields to the `Conversation` interface (after `updatedAt`):
```ts
export interface Conversation {
  id: string;
  name: string;
  mode?: ConversationMode;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  provider?: AIProvider;   // ← add this
  model?: string;          // ← add this
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: errors about `Record<AIProvider, string>` not having `openai`/`anthropic` keys in `page.tsx`. That is expected — it will be fixed in Task 11. If there are other errors, fix them now.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat: add openai + anthropic to AIProvider, provider+model to Conversation"
```

---

## Task 3: Create `lib/openai.ts`

**Files:**
- Create: `lib/openai.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/openai.ts — server-side only (uses OPENAI_API_KEY from .env.local / Electron settings)

import OpenAI from "openai";
import type { HistoryMessage } from "@/types";

export const DEFAULT_MODEL = "gpt-4o-mini";

export const OPENAI_MODELS = [
  { name: "gpt-4o",       size: 0 },
  { name: "gpt-4o-mini",  size: 0 },
  { name: "gpt-4-turbo",  size: 0 },
  { name: "gpt-3.5-turbo", size: 0 },
];

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

/**
 * Returns a ReadableStream that streams tokens from OpenAI.
 * Usage data is appended at the end as: \n\n__USAGE__{...json}
 */
export function streamOpenAI(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set. Add it in Settings.");
  }

  const client = new OpenAI({ apiKey: key });
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
            ...messages,
          ],
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0.7,
        });

        let usageData: Record<string, number> | null = null;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) controller.enqueue(encoder.encode(delta));
          if (chunk.usage) {
            usageData = {
              prompt_tokens: chunk.usage.prompt_tokens ?? 0,
              completion_tokens: chunk.usage.completion_tokens ?? 0,
              total_tokens: chunk.usage.total_tokens ?? 0,
            };
          }
        }

        if (usageData) {
          controller.enqueue(
            encoder.encode(`\n\n__USAGE__${JSON.stringify(usageData)}`)
          );
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "lib/openai"
```

Expected: no output (no errors in this file).

- [ ] **Step 3: Commit**

```bash
git add lib/openai.ts
git commit -m "feat: add lib/openai.ts chat streaming"
```

---

## Task 4: Create `lib/anthropic.ts`

**Files:**
- Create: `lib/anthropic.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/anthropic.ts — server-side only (uses ANTHROPIC_API_KEY from .env.local / Electron settings)

import Anthropic from "@anthropic-ai/sdk";
import type { HistoryMessage } from "@/types";

export const DEFAULT_MODEL = "claude-sonnet-4-5";

export const ANTHROPIC_MODELS = [
  { name: "claude-opus-4-5",    size: 0 },
  { name: "claude-sonnet-4-5",  size: 0 },
  { name: "claude-haiku-3-5",   size: 0 },
];

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

/**
 * Returns a ReadableStream that streams tokens from Anthropic.
 * Usage data is appended at the end as: \n\n__USAGE__{...json}
 */
export function streamAnthropic(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it in Settings.");
  }

  const client = new Anthropic({ apiKey: key });
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model,
          max_tokens: 8192,
          system: systemPrompt ?? SYSTEM_PROMPT,
          messages: messages.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          temperature: 0.7 as unknown as undefined, // Anthropic accepts 0-1 but type says undefined
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }

        const finalMsg = await stream.finalMessage();
        if (finalMsg.usage) {
          const usageData = {
            prompt_tokens: finalMsg.usage.input_tokens ?? 0,
            completion_tokens: finalMsg.usage.output_tokens ?? 0,
            total_tokens:
              (finalMsg.usage.input_tokens ?? 0) +
              (finalMsg.usage.output_tokens ?? 0),
          };
          controller.enqueue(
            encoder.encode(`\n\n__USAGE__${JSON.stringify(usageData)}`)
          );
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "lib/anthropic"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/anthropic.ts
git commit -m "feat: add lib/anthropic.ts chat streaming"
```

---

## Task 5: Create `lib/agent/openai.ts`

**Files:**
- Create: `lib/agent/openai.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/agent/openai.ts — OpenAI agent step adapter

import OpenAI from "openai";
import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";

function toOpenAIMessages(
  messages: InternalMessage[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.flatMap((m) => {
    if (m.role === "system") {
      return [{ role: "system" as const, content: m.content }];
    }
    if (m.role === "user") {
      return [{ role: "user" as const, content: m.content }];
    }
    if (m.role === "assistant") {
      return [{ role: "assistant" as const, content: m.content }];
    }
    if (m.role === "assistant_tool_call") {
      return [
        {
          role: "assistant" as const,
          content: null,
          tool_calls: [
            {
              id: m.callId,
              type: "function" as const,
              function: {
                name: m.tool,
                arguments: JSON.stringify(m.args),
              },
            },
          ],
        },
      ];
    }
    if (m.role === "tool_result") {
      return [
        {
          role: "tool" as const,
          tool_call_id: m.callId,
          content: m.content,
        },
      ];
    }
    return [];
  });
}

export async function openaiAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set in Settings");

  const client = new OpenAI({ apiKey: key });

  const response = await client.chat.completions.create({
    model,
    messages: toOpenAIMessages(messages),
    tools: tools.map((t) => ({ type: "function" as const, function: t })),
    tool_choice: "auto",
    temperature: 0.2,
  });

  const choice = response.choices[0];

  if (
    choice.finish_reason === "tool_calls" &&
    choice.message.tool_calls?.length
  ) {
    const tc = choice.message.tool_calls[0];
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      /* ignore */
    }
    return { type: "tool_call", callId: tc.id, tool: tc.function.name, args };
  }

  return { type: "text", content: (choice.message.content ?? "").trim() };
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "agent/openai"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/openai.ts
git commit -m "feat: add lib/agent/openai.ts agent adapter"
```

---

## Task 6: Create `lib/agent/anthropic.ts`

**Files:**
- Create: `lib/agent/anthropic.ts`

- [ ] **Step 1: Create the file**

```ts
// lib/agent/anthropic.ts — Anthropic agent step adapter

import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";

/** Extract system prompt and convert remaining messages to Anthropic format. */
function toAnthropicMessages(messages: InternalMessage[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const systemMsg = messages.find((m) => m.role === "system");
  const system = systemMsg?.content ?? "";

  const converted: Anthropic.MessageParam[] = messages
    .filter((m) => m.role !== "system")
    .flatMap((m) => {
      if (m.role === "user") {
        return [{ role: "user" as const, content: m.content }];
      }
      if (m.role === "assistant") {
        return [{ role: "assistant" as const, content: m.content }];
      }
      if (m.role === "assistant_tool_call") {
        return [
          {
            role: "assistant" as const,
            content: [
              {
                type: "tool_use" as const,
                id: m.callId,
                name: m.tool,
                input: m.args,
              },
            ],
          },
        ];
      }
      if (m.role === "tool_result") {
        return [
          {
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: m.callId,
                content: m.content,
              },
            ],
          },
        ];
      }
      return [];
    });

  return { system, messages: converted };
}

export async function anthropicAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in Settings");

  const client = new Anthropic({ apiKey: key });
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system,
    messages: anthropicMessages,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    })),
  });

  // Check for tool use block first
  const toolUseBlock = response.content.find((b) => b.type === "tool_use");
  if (toolUseBlock && toolUseBlock.type === "tool_use") {
    return {
      type: "tool_call",
      callId: toolUseBlock.id,
      tool: toolUseBlock.name,
      args: toolUseBlock.input as Record<string, unknown>,
    };
  }

  // Text response
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
  return { type: "text", content: text.trim() };
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "agent/anthropic"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/anthropic.ts
git commit -m "feat: add lib/agent/anthropic.ts agent adapter"
```

---

## Task 7: Update `/api/models/route.ts`

**Files:**
- Modify: `app/api/models/route.ts`

- [ ] **Step 1: Add imports and new provider cases**

The full updated file content:

```ts
import { NextRequest, NextResponse } from "next/server";
import { GROQ_MODELS, DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "@/lib/groq";
import { fetchInstalledModels, DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL } from "@/lib/ollama";
import { NIM_MODELS, DEFAULT_MODEL as NIM_DEFAULT_MODEL } from "@/lib/nim";
import { OPENROUTER_MODELS, DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter";
import { OPENAI_MODELS, DEFAULT_MODEL as OPENAI_DEFAULT_MODEL } from "@/lib/openai";
import { ANTHROPIC_MODELS, DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from "@/lib/anthropic";

export async function GET(req: NextRequest) {
  const provider = (req.nextUrl.searchParams.get("provider") ?? "groq").toLowerCase();

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { provider: "openai", models: [], defaultModel: OPENAI_DEFAULT_MODEL, error: "No API key — add it in Settings" },
        { status: 401 }
      );
    }
    return NextResponse.json({ provider: "openai", models: OPENAI_MODELS, defaultModel: OPENAI_DEFAULT_MODEL });
  }

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { provider: "anthropic", models: [], defaultModel: ANTHROPIC_DEFAULT_MODEL, error: "No API key — add it in Settings" },
        { status: 401 }
      );
    }
    return NextResponse.json({ provider: "anthropic", models: ANTHROPIC_MODELS, defaultModel: ANTHROPIC_DEFAULT_MODEL });
  }

  if (provider === "nim") {
    if (!process.env.NIM_API_KEY) {
      return NextResponse.json(
        { provider: "nim", models: [], defaultModel: NIM_DEFAULT_MODEL, error: "No API key — add it in Settings" },
        { status: 401 }
      );
    }
    return NextResponse.json({ provider: "nim", models: NIM_MODELS, defaultModel: NIM_DEFAULT_MODEL });
  }

  if (provider === "ollama") {
    try {
      const models = await fetchInstalledModels();
      return NextResponse.json({
        provider: "ollama",
        models,
        defaultModel: models[0]?.name ?? OLLAMA_DEFAULT_MODEL,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not connect to Ollama.";
      return NextResponse.json(
        { provider: "ollama", models: [], defaultModel: OLLAMA_DEFAULT_MODEL, error: msg },
        { status: 503 }
      );
    }
  }

  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { provider: "openrouter", models: [], defaultModel: OPENROUTER_DEFAULT_MODEL, error: "No API key — add it in Settings" },
        { status: 401 }
      );
    }
    return NextResponse.json({ provider: "openrouter", models: OPENROUTER_MODELS, defaultModel: OPENROUTER_DEFAULT_MODEL });
  }

  // Groq (default)
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { provider: "groq", models: [], defaultModel: GROQ_DEFAULT_MODEL, error: "No API key — add it in Settings" },
      { status: 401 }
    );
  }
  return NextResponse.json({ provider: "groq", models: GROQ_MODELS, defaultModel: GROQ_DEFAULT_MODEL });
}
```

- [ ] **Step 2: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "api/models"
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/api/models/route.ts
git commit -m "feat: add openai + anthropic to models API route"
```

---

## Task 8: Update `/api/chat/route.ts`

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Add imports**

At the top of `app/api/chat/route.ts`, add two new imports after the existing ones:

```ts
import { streamOpenAI, DEFAULT_MODEL as OPENAI_DEFAULT_MODEL } from "@/lib/openai";
import { streamAnthropic, DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from "@/lib/anthropic";
```

- [ ] **Step 2: Add `openai` and `anthropic` to the default model selection**

Find this block (around line 16):
```ts
const defaultModel =
  provider === "ollama"      ? OLLAMA_DEFAULT_MODEL :
  provider === "nim"         ? NIM_DEFAULT_MODEL :
  provider === "openrouter"  ? OPENROUTER_DEFAULT_MODEL :
  GROQ_DEFAULT_MODEL;
```

Replace with:
```ts
const defaultModel =
  provider === "ollama"      ? OLLAMA_DEFAULT_MODEL :
  provider === "nim"         ? NIM_DEFAULT_MODEL :
  provider === "openrouter"  ? OPENROUTER_DEFAULT_MODEL :
  provider === "openai"      ? OPENAI_DEFAULT_MODEL :
  provider === "anthropic"   ? ANTHROPIC_DEFAULT_MODEL :
  GROQ_DEFAULT_MODEL;
```

- [ ] **Step 3: Add the two new provider streaming cases**

Find the comment `// 3. No command matched — send to selected provider` and add the two new cases before the Groq fallback. Insert these two blocks right after the `if (provider === "openrouter")` block and before the final Groq block:

```ts
  if (provider === "openai") {
    try {
      const history = messages.slice(-20);
      const stream = streamOpenAI(history, model, body.systemPrompt);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache",
          "Transfer-Encoding": "chunked",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error.";
      return NextResponse.json({ reply: `Marven couldn't reach OpenAI: ${msg}` }, { status: 503 });
    }
  }

  if (provider === "anthropic") {
    try {
      const history = messages.slice(-20);
      const stream = streamAnthropic(history, model, body.systemPrompt);
      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache",
          "Transfer-Encoding": "chunked",
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error.";
      return NextResponse.json({ reply: `Marven couldn't reach Anthropic: ${msg}` }, { status: 503 });
    }
  }
```

- [ ] **Step 4: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "api/chat"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: add openai + anthropic streaming to chat route"
```

---

## Task 9: Update `/api/agent/stream/route.ts`

**Files:**
- Modify: `app/api/agent/stream/route.ts`

- [ ] **Step 1: Add imports**

At the top, after the existing adapter imports, add:

```ts
import { openaiAgentStep } from "@/lib/agent/openai";
import { anthropicAgentStep } from "@/lib/agent/anthropic";
```

- [ ] **Step 2: Add default models for openai and anthropic**

Find:
```ts
const model = body.model ?? (
  provider === "groq" ? "llama-3.3-70b-versatile" :
  provider === "nim"  ? "mistralai/mistral-nemotron" :
  "qwen2.5-coder"
);
```

Replace with:
```ts
const model = body.model ?? (
  provider === "groq"       ? "llama-3.3-70b-versatile" :
  provider === "nim"        ? "mistralai/mistral-nemotron" :
  provider === "openai"     ? "gpt-4o-mini" :
  provider === "anthropic"  ? "claude-sonnet-4-5" :
  "qwen2.5-coder"
);
```

- [ ] **Step 3: Add the new adapters to the providerStep selection**

Find:
```ts
const providerStep =
  provider === "groq"       ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => groqAgentStep(msgs, tools, model) :
  provider === "nim"        ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => nimAgentStep(msgs, tools, model) :
  provider === "openrouter" ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => openrouterAgentStep(msgs, tools, model) :
  (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => ollamaAgentStep(msgs, tools, model);
```

Replace with:
```ts
const providerStep =
  provider === "groq"       ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => groqAgentStep(msgs, tools, model) :
  provider === "nim"        ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => nimAgentStep(msgs, tools, model) :
  provider === "openrouter" ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => openrouterAgentStep(msgs, tools, model) :
  provider === "openai"     ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => openaiAgentStep(msgs, tools, model) :
  provider === "anthropic"  ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => anthropicAgentStep(msgs, tools, model) :
  (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => ollamaAgentStep(msgs, tools, model);
```

- [ ] **Step 4: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep "agent/stream"
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add app/api/agent/stream/route.ts
git commit -m "feat: add openai + anthropic adapters to agent stream route"
```

---

## Task 10: UI wiring — dropdown, settings, Electron

**Files:**
- Modify: `app/components/marven/GroupedModelDropdown.tsx`
- Modify: `app/components/marven/SettingsModal.tsx`
- Modify: `electron/main.js`

- [ ] **Step 1: Add providers to `GroupedModelDropdown.tsx`**

Find:
```ts
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  groq: "Groq",
  ollama: "Ollama",
  nim: "NIM",
  openrouter: "OpenRouter",
};

const PROVIDERS: AIProvider[] = ["groq", "ollama", "nim", "openrouter"];
```

Replace with:
```ts
export const PROVIDER_LABELS: Record<AIProvider, string> = {
  groq: "Groq",
  ollama: "Ollama",
  nim: "NIM",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const PROVIDERS: AIProvider[] = ["groq", "ollama", "nim", "openrouter", "openai", "anthropic"];
```

- [ ] **Step 2: Add API key state fields in `SettingsModal.tsx`**

Find:
```ts
  const [groqKey, setGroqKey] = useState("");
  const [nimKey, setNimKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
```

Replace with:
```ts
  const [groqKey, setGroqKey] = useState("");
  const [nimKey, setNimKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
```

- [ ] **Step 3: Load OpenAI and Anthropic keys from Electron settings**

Find:
```ts
      if (s.groqApiKey)       setGroqKey(s.groqApiKey);
      if (s.nimApiKey)        setNimKey(s.nimApiKey);
      if (s.openrouterApiKey) setOpenrouterKey(s.openrouterApiKey);
      if (s.ollamaUrl)        setOllamaUrl(s.ollamaUrl);
```

Replace with:
```ts
      if (s.groqApiKey)       setGroqKey(s.groqApiKey);
      if (s.nimApiKey)        setNimKey(s.nimApiKey);
      if (s.openrouterApiKey) setOpenrouterKey(s.openrouterApiKey);
      if (s.openaiApiKey)     setOpenaiKey(s.openaiApiKey);
      if (s.anthropicApiKey)  setAnthropicKey(s.anthropicApiKey);
      if (s.ollamaUrl)        setOllamaUrl(s.ollamaUrl);
```

- [ ] **Step 4: Include OpenAI and Anthropic keys in `handleSaveKeys`**

Find:
```ts
    await electron.saveSettings({
      groqApiKey: groqKey.trim(),
      nimApiKey: nimKey.trim(),
      openrouterApiKey: openrouterKey.trim(),
      ollamaUrl: ollamaUrl.trim(),
    });
```

Replace with:
```ts
    await electron.saveSettings({
      groqApiKey: groqKey.trim(),
      nimApiKey: nimKey.trim(),
      openrouterApiKey: openrouterKey.trim(),
      openaiApiKey: openaiKey.trim(),
      anthropicApiKey: anthropicKey.trim(),
      ollamaUrl: ollamaUrl.trim(),
    });
```

- [ ] **Step 5: Add the two new input fields in the Settings UI**

Find the OpenRouter key input block (the `<div>` that contains "OpenRouter API Key"):
```tsx
              <div>
                <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
                  OpenRouter API Key
                </label>
                <input
                  type="password"
                  value={openrouterKey}
                  onChange={(e) => setOpenrouterKey(e.target.value)}
                  placeholder="sk-or-..."
                  disabled={!electron}
                  className={inputClass}
                />
                <p className="mt-1.5 font-mono text-[10px] text-[#555]">
                  Free at openrouter.ai — access Gemma, Llama, Mistral &amp; more at no cost.
                </p>
              </div>
```

After that closing `</div>`, add:
```tsx
              <div>
                <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
                  OpenAI API Key
                </label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                  disabled={!electron}
                  className={inputClass}
                />
                <p className="mt-1.5 font-mono text-[10px] text-[#555]">
                  Get yours at platform.openai.com — powers GPT-4o and GPT-4o mini.
                </p>
              </div>

              <div>
                <label className="block font-mono text-[9px] tracking-[0.2em] text-[#555] uppercase mb-2">
                  Anthropic API Key
                </label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-..."
                  disabled={!electron}
                  className={inputClass}
                />
                <p className="mt-1.5 font-mono text-[10px] text-[#555]">
                  Get yours at console.anthropic.com — powers Claude Sonnet, Haiku &amp; Opus.
                </p>
              </div>
```

- [ ] **Step 6: Update `electron/main.js` to inject the two new keys**

Find:
```js
function applySettings(settings) {
  if (settings.groqApiKey)       process.env.GROQ_API_KEY        = settings.groqApiKey;
  if (settings.ollamaUrl)        process.env.OLLAMA_URL          = settings.ollamaUrl;
  if (settings.nimApiKey)        process.env.NIM_API_KEY         = settings.nimApiKey;
  if (settings.openrouterApiKey) process.env.OPENROUTER_API_KEY  = settings.openrouterApiKey;
}
```

Replace with:
```js
function applySettings(settings) {
  if (settings.groqApiKey)       process.env.GROQ_API_KEY        = settings.groqApiKey;
  if (settings.ollamaUrl)        process.env.OLLAMA_URL          = settings.ollamaUrl;
  if (settings.nimApiKey)        process.env.NIM_API_KEY         = settings.nimApiKey;
  if (settings.openrouterApiKey) process.env.OPENROUTER_API_KEY  = settings.openrouterApiKey;
  if (settings.openaiApiKey)     process.env.OPENAI_API_KEY      = settings.openaiApiKey;
  if (settings.anthropicApiKey)  process.env.ANTHROPIC_API_KEY   = settings.anthropicApiKey;
}
```

- [ ] **Step 7: Verify compile**

```bash
npx tsc --noEmit 2>&1 | grep -E "GroupedModel|SettingsModal"
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add app/components/marven/GroupedModelDropdown.tsx \
        app/components/marven/SettingsModal.tsx \
        electron/main.js
git commit -m "feat: add openai + anthropic to dropdown, settings, and electron key injection"
```

---

## Task 11: Update `app/page.tsx` — state and conversation memory

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add `openai` and `anthropic` to `selectedModelByProvider` initial state**

Find:
```ts
  const [selectedModelByProvider, setSelectedModelByProvider] = useState<Record<AIProvider, string>>({
    groq: "",
    ollama: "",
    nim: "",
    openrouter: "",
  });
```

Replace with:
```ts
  const [selectedModelByProvider, setSelectedModelByProvider] = useState<Record<AIProvider, string>>({
    groq: "",
    ollama: "",
    nim: "",
    openrouter: "",
    openai: "",
    anthropic: "",
  });
```

- [ ] **Step 2: Restore provider + model when switching conversations**

Find:
```ts
  function handleSelectConversation(id: string) {
    setActiveConversationId(id);
  }
```

Replace with:
```ts
  function handleSelectConversation(id: string) {
    setActiveConversationId(id);
    const conv = conversations.find((c) => c.id === id);
    if (conv?.provider) {
      setProvider(conv.provider);
      if (conv.model) {
        setSelectedModelByProvider((prev) => ({
          ...prev,
          [conv.provider!]: conv.model!,
        }));
      }
    }
  }
```

- [ ] **Step 3: Stamp provider + model onto the conversation when the user sends a message**

Find `function addMessageToConversation`:
```ts
  function addMessageToConversation(convId: string, message: Message) {
    upsertConversation(convId, (conv) => ({
      ...conv,
      messages: [...conv.messages, message],
      updatedAt: new Date().toISOString(),
    }));
  }
```

Replace with:
```ts
  function addMessageToConversation(convId: string, message: Message, stamped?: { provider: AIProvider; model: string }) {
    upsertConversation(convId, (conv) => ({
      ...conv,
      messages: [...conv.messages, message],
      updatedAt: new Date().toISOString(),
      ...(stamped ?? {}),
    }));
  }
```

- [ ] **Step 4: Pass the stamp when the user sends a message in chat mode**

In `sendMessage`, find the first call to `addMessageToConversation` for the user's message in chat mode (not agent mode). It looks like:

```ts
    addMessageToConversation(convId, userMessage);
```

There are two calls (one for agent, one for chat). The chat one is in the `else` branch of the agent check. Update only the first user message call in the chat path:

```ts
    addMessageToConversation(convId, userMessage, { provider, model: selectedModel });
```

- [ ] **Step 5: Also stamp on the agent path**

In the agent branch of `sendMessage`, find:
```ts
      addMessageToConversation(convId, userMsg);
```

Replace with:
```ts
      addMessageToConversation(convId, userMsg, { provider, model: selectedModel });
```

- [ ] **Step 6: Verify compile cleanly**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output at all. If TypeScript errors remain, fix them before committing.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx
git commit -m "feat: per-conversation model memory — save + restore provider and model"
```

---

## Task 12: Final verification and version bump

- [ ] **Step 1: Run full TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no output.

- [ ] **Step 2: Start the dev server and manually verify**

```bash
npm run dev
```

Open the app and check:
- GroupedModelDropdown shows OpenAI and Anthropic in the left panel
- Clicking OpenAI/Anthropic with no key shows "unavailable" in the right panel
- Settings → API Keys tab shows fields for OpenAI and Anthropic
- After adding a key, the models appear in the dropdown
- Sending a message with OpenAI/Anthropic selected streams a response
- Switching to a different conversation restores its provider + model in the dropdown

- [ ] **Step 3: Bump version to 1.5.0**

In `package.json`, change `"version": "1.4.2"` to `"version": "1.5.0"`.

- [ ] **Step 4: Final commit and tag**

```bash
git add package.json
git commit -m "chore: bump version to 1.5.0 — Wave 1 providers complete"
git tag v1.5.0
git push origin master --tags
```
