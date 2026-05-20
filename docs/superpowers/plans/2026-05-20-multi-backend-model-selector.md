# Multi-Backend Model Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add LM Studio and llama-server as local AI backends and replace the cluttered provider dropdown with a clean Local/Cloud split UI backed by a Settings → AI Backends toggle panel.

**Architecture:** Two new backend modules (`lib/lmstudio.ts`, `lib/llamaserver.ts`) reuse the OpenAI SDK with a different `baseURL` — minimal new code. A new `ModelSelector` component replaces `GroupedModelDropdown` with a tabbed Local/Cloud UI that filters to only enabled providers. Provider toggles and local URLs live in a new "AI Backends" tab in `SettingsModal`, reading/writing the Electron Store like all other settings.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, OpenAI SDK (reused for local backends), Electron Store via IPC, Vitest.

---

## File map

| File | Action |
|------|--------|
| `types/index.ts` | Modify — add `"lmstudio" \| "llamaserver"` to `AIProvider` |
| `electron/main.js` | Modify — add `LM_STUDIO_URL` and `LLAMA_SERVER_URL` to `applySettings` |
| `lib/lmstudio.ts` | Create — stream + model listing for LM Studio |
| `lib/lmstudio.test.ts` | Create — unit tests |
| `lib/llamaserver.ts` | Create — stream + model listing for llama-server |
| `lib/llamaserver.test.ts` | Create — unit tests |
| `app/api/models/route.ts` | Modify — add lmstudio + llamaserver branches |
| `app/api/chat/route.ts` | Modify — add lmstudio + llamaserver branches |
| `app/components/marven/ModelSelector.tsx` | Create — replaces GroupedModelDropdown |
| `app/components/marven/GroupedModelDropdown.tsx` | Delete |
| `app/components/marven/InputBar.tsx` | Modify — swap import, add `enabledProviders` prop |
| `app/components/marven/SettingsModal.tsx` | Modify — add "AI Backends" tab |

---

## Task 1: Extend AIProvider type

**Files:**
- Modify: `types/index.ts:2`

- [ ] **Step 1: Update the AIProvider union type**

In `types/index.ts`, line 2, change:

```ts
export type AIProvider = "groq" | "ollama" | "nim" | "openrouter" | "openai" | "anthropic";
```

to:

```ts
export type AIProvider = "groq" | "ollama" | "nim" | "openrouter" | "openai" | "anthropic" | "lmstudio" | "llamaserver";
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors (the new values are additive; nothing breaks).

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "feat(types): add lmstudio and llamaserver to AIProvider"
```

---

## Task 2: Electron — expose LM Studio + llama-server URLs as env vars

**Files:**
- Modify: `electron/main.js:130-137`

The `applySettings` function (lines 130-137) reads settings and writes them to `process.env` so the Next.js API routes can access them. Add two lines for the new local backend URLs.

- [ ] **Step 1: Add two lines to `applySettings`**

In `electron/main.js`, find `applySettings` (line 130). The current function body ends with:

```js
  if (settings.anthropicApiKey)  process.env.ANTHROPIC_API_KEY   = settings.anthropicApiKey;
}
```

Change it to:

```js
  if (settings.anthropicApiKey)  process.env.ANTHROPIC_API_KEY   = settings.anthropicApiKey;
  if (settings.lmStudioUrl)      process.env.LM_STUDIO_URL       = settings.lmStudioUrl;
  if (settings.llamaServerUrl)   process.env.LLAMA_SERVER_URL    = settings.llamaServerUrl;
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/main.js
git commit -m "feat(electron): expose LM_STUDIO_URL and LLAMA_SERVER_URL env vars"
```

---

## Task 3: LM Studio backend library + tests

**Files:**
- Create: `lib/lmstudio.test.ts`
- Create: `lib/lmstudio.ts`

LM Studio runs a local server that speaks the OpenAI REST API. We reuse the `openai` npm package with a custom `baseURL` — identical to `lib/openai.ts` except no API key is required.

- [ ] **Step 1: Write the failing tests**

Create `lib/lmstudio.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn(() => ({ models: { list: mockList } })),
}));

import OpenAI from "openai";
import { getLMStudioModels } from "./lmstudio";

describe("getLMStudioModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] on connection failure", async () => {
    mockList.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await getLMStudioModels("http://localhost:1234");
    expect(result).toEqual([]);
  });

  it("maps model IDs to { name, size } objects", async () => {
    mockList.mockResolvedValue({
      data: [{ id: "llama-3.2-3b" }, { id: "mistral-7b" }],
    });
    const result = await getLMStudioModels("http://localhost:1234");
    expect(result).toEqual([
      { name: "llama-3.2-3b", size: 0 },
      { name: "mistral-7b", size: 0 },
    ]);
  });

  it("constructs baseURL from the provided URL", async () => {
    mockList.mockResolvedValue({ data: [] });
    await getLMStudioModels("http://localhost:9999");
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://localhost:9999/v1" })
    );
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx vitest run lib/lmstudio.test.ts 2>&1
```

Expected: FAIL — `Cannot find module './lmstudio'`

- [ ] **Step 3: Implement `lib/lmstudio.ts`**

```ts
// lib/lmstudio.ts — LM Studio local backend (OpenAI-compatible API)
// LM Studio exposes /v1/... endpoints identical to the OpenAI REST API.

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { HistoryMessage } from "@/types";

export const DEFAULT_MODEL = "local-model";

/**
 * Returns the list of models currently loaded in LM Studio.
 * Returns [] if the server is not running or returns an error.
 */
export async function getLMStudioModels(
  baseUrl: string
): Promise<{ name: string; size: number }[]> {
  try {
    const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "lm-studio" });
    const response = await client.models.list();
    return response.data.map((m) => ({ name: m.id, size: 0 }));
  } catch {
    return [];
  }
}

/**
 * Returns a ReadableStream that streams tokens from LM Studio.
 * Reads LM_STUDIO_URL from env (set by Electron's applySettings).
 */
export function streamLMStudio(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const baseUrl = process.env.LM_STUDIO_URL ?? "http://localhost:1234";
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "lm-studio" });
  const encoder = new TextEncoder();

  const SYSTEM_PROMPT =
    "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

  const msgs: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
    ...messages.map((m): ChatCompletionMessageParam => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model,
          messages: msgs,
          stream: true,
          temperature: 0.7,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) controller.enqueue(encoder.encode(delta));
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx vitest run lib/lmstudio.test.ts 2>&1
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/lmstudio.ts lib/lmstudio.test.ts
git commit -m "feat(backend): add LM Studio local backend module"
```

---

## Task 4: llama-server backend library + tests

**Files:**
- Create: `lib/llamaserver.test.ts`
- Create: `lib/llamaserver.ts`

llama-server (the HTTP server in llama.cpp) also exposes an OpenAI-compatible API. Identical pattern to LM Studio.

- [ ] **Step 1: Write the failing tests**

Create `lib/llamaserver.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn(() => ({ models: { list: mockList } })),
}));

import OpenAI from "openai";
import { getLlamaServerModels } from "./llamaserver";

describe("getLlamaServerModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] on connection failure", async () => {
    mockList.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await getLlamaServerModels("http://localhost:8080");
    expect(result).toEqual([]);
  });

  it("maps model IDs to { name, size } objects", async () => {
    mockList.mockResolvedValue({
      data: [{ id: "llama-3.2-3b-q4" }, { id: "mistral-7b-q4" }],
    });
    const result = await getLlamaServerModels("http://localhost:8080");
    expect(result).toEqual([
      { name: "llama-3.2-3b-q4", size: 0 },
      { name: "mistral-7b-q4", size: 0 },
    ]);
  });

  it("constructs baseURL from the provided URL", async () => {
    mockList.mockResolvedValue({ data: [] });
    await getLlamaServerModels("http://localhost:7777");
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://localhost:7777/v1" })
    );
  });
});
```

- [ ] **Step 2: Run to confirm they fail**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx vitest run lib/llamaserver.test.ts 2>&1
```

Expected: FAIL — `Cannot find module './llamaserver'`

- [ ] **Step 3: Implement `lib/llamaserver.ts`**

```ts
// lib/llamaserver.ts — llama-server (llama.cpp HTTP server) backend
// llama-server exposes /v1/... endpoints compatible with the OpenAI REST API.

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { HistoryMessage } from "@/types";

export const DEFAULT_MODEL = "local-model";

/**
 * Returns the list of models available from llama-server.
 * Returns [] if the server is not running or returns an error.
 */
export async function getLlamaServerModels(
  baseUrl: string
): Promise<{ name: string; size: number }[]> {
  try {
    const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "llama-server" });
    const response = await client.models.list();
    return response.data.map((m) => ({ name: m.id, size: 0 }));
  } catch {
    return [];
  }
}

/**
 * Returns a ReadableStream that streams tokens from llama-server.
 * Reads LLAMA_SERVER_URL from env (set by Electron's applySettings).
 */
export function streamLlamaServer(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const baseUrl = process.env.LLAMA_SERVER_URL ?? "http://localhost:8080";
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "llama-server" });
  const encoder = new TextEncoder();

  const SYSTEM_PROMPT =
    "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

  const msgs: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
    ...messages.map((m): ChatCompletionMessageParam => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model,
          messages: msgs,
          stream: true,
          temperature: 0.7,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) controller.enqueue(encoder.encode(delta));
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx vitest run lib/llamaserver.test.ts 2>&1
```

Expected: 3 tests PASS.

- [ ] **Step 5: Run all tests to confirm nothing broke**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npm test 2>&1
```

Expected: all existing tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/llamaserver.ts lib/llamaserver.test.ts
git commit -m "feat(backend): add llama-server backend module"
```

---

## Task 5: Wire new backends into API routes

**Files:**
- Modify: `app/api/models/route.ts`
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Update `app/api/models/route.ts`**

Add these two imports at the top, after the existing imports:

```ts
import { getLMStudioModels, DEFAULT_MODEL as LMSTUDIO_DEFAULT_MODEL } from "@/lib/lmstudio";
import { getLlamaServerModels, DEFAULT_MODEL as LLAMASERVER_DEFAULT_MODEL } from "@/lib/llamaserver";
```

Then add these two blocks inside the `GET` handler, right before the final Groq fallback block (before `// Groq (default)`):

```ts
  if (provider === "lmstudio") {
    const url = process.env.LM_STUDIO_URL ?? "http://localhost:1234";
    const models = await getLMStudioModels(url);
    return NextResponse.json({
      provider: "lmstudio",
      models,
      defaultModel: models[0]?.name ?? LMSTUDIO_DEFAULT_MODEL,
    });
  }

  if (provider === "llamaserver") {
    const url = process.env.LLAMA_SERVER_URL ?? "http://localhost:8080";
    const models = await getLlamaServerModels(url);
    return NextResponse.json({
      provider: "llamaserver",
      models,
      defaultModel: models[0]?.name ?? LLAMASERVER_DEFAULT_MODEL,
    });
  }
```

- [ ] **Step 2: Update `app/api/chat/route.ts`**

Add these two imports at the top, after the existing imports:

```ts
import { streamLMStudio, DEFAULT_MODEL as LMSTUDIO_DEFAULT_MODEL } from "@/lib/lmstudio";
import { streamLlamaServer, DEFAULT_MODEL as LLAMASERVER_DEFAULT_MODEL } from "@/lib/llamaserver";
```

In the `defaultModel` ternary (lines 27-33), add two new cases:

```ts
  const defaultModel =
    provider === "ollama"       ? OLLAMA_DEFAULT_MODEL :
    provider === "nim"          ? NIM_DEFAULT_MODEL :
    provider === "openrouter"   ? OPENROUTER_DEFAULT_MODEL :
    provider === "openai"       ? OPENAI_DEFAULT_MODEL :
    provider === "anthropic"    ? ANTHROPIC_DEFAULT_MODEL :
    provider === "lmstudio"     ? LMSTUDIO_DEFAULT_MODEL :
    provider === "llamaserver"  ? LLAMASERVER_DEFAULT_MODEL :
    GROQ_DEFAULT_MODEL;
```

Then add these two blocks inside the handler, right before the final Groq fallback (before `// 4. Groq`):

```ts
  if (provider === "lmstudio") {
    try {
      const history = messages.slice(-20);
      const stream = streamLMStudio(history, model, body.systemPrompt);
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
      return NextResponse.json(
        { reply: `LM Studio is not running. Start it and try again. (${msg})` },
        { status: 503 }
      );
    }
  }

  if (provider === "llamaserver") {
    try {
      const history = messages.slice(-20);
      const stream = streamLlamaServer(history, model, body.systemPrompt);
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
      return NextResponse.json(
        { reply: `llama-server is not running. Start it and try again. (${msg})` },
        { status: 503 }
      );
    }
  }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/models/route.ts app/api/chat/route.ts
git commit -m "feat(api): wire lmstudio and llamaserver into chat and models routes"
```

---

## Task 6: ModelSelector component

**Files:**
- Create: `app/components/marven/ModelSelector.tsx`

This replaces `GroupedModelDropdown`. The pill button in the input bar is visually identical. The popup is rebuilt with a Cloud/Local tab bar, provider chips, and a model list.

- [ ] **Step 1: Create `app/components/marven/ModelSelector.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { AIProvider } from "@/types";

// Re-export so InputBar can keep the same import path for shortModelName
export function shortModelName(name: string): string {
  const base = name.includes("/") ? name.split("/").pop()! : name;
  return base.replace(/-instruct.*$/, "").replace(/-\d{4}$/, "");
}

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  groq:        "Groq",
  ollama:      "Ollama",
  nim:         "NIM",
  openrouter:  "OpenRouter",
  openai:      "OpenAI",
  anthropic:   "Anthropic",
  lmstudio:    "LM Studio",
  llamaserver: "llama-server",
};

const CLOUD_PROVIDERS: AIProvider[] = ["groq", "openai", "anthropic", "nim", "openrouter"];
const LOCAL_PROVIDERS: AIProvider[] = ["ollama", "lmstudio", "llamaserver"];

const DEFAULT_ENABLED: Record<AIProvider, boolean> = {
  groq: true, openai: true, ollama: true,
  anthropic: false, nim: false, openrouter: false,
  lmstudio: false, llamaserver: false,
};

interface ModelSelectorProps {
  provider: AIProvider;
  selectedModel: string;
  direction?: "up" | "down";
  onProviderChange: (p: AIProvider) => void;
  onModelChange: (m: string) => void;
}

export function ModelSelector({
  provider,
  selectedModel,
  direction = "up",
  onProviderChange,
  onModelChange,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"cloud" | "local">(
    LOCAL_PROVIDERS.includes(provider) ? "local" : "cloud"
  );
  const [hoveredProvider, setHoveredProvider] = useState<AIProvider>(provider);
  const [enabledProviders, setEnabledProviders] = useState<Record<AIProvider, boolean>>(DEFAULT_ENABLED);
  const [models, setModels] = useState<Record<AIProvider, string[]>>({
    groq: [], ollama: [], nim: [], openrouter: [], openai: [],
    anthropic: [], lmstudio: [], llamaserver: [],
  });
  const [loadingProvider, setLoadingProvider] = useState<AIProvider | null>(null);
  const [errors, setErrors] = useState<Record<AIProvider, string | null>>({
    groq: null, ollama: null, nim: null, openrouter: null, openai: null,
    anthropic: null, lmstudio: null, llamaserver: null,
  });
  const loadedRef = useRef<Set<AIProvider>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  // Load enabledProviders from Electron settings on mount
  useEffect(() => {
    const win = window as Window & {
      electron?: { getSettings?: () => Promise<Record<string, unknown>> };
    };
    win.electron?.getSettings?.().then((s) => {
      if (s.enabledProviders && typeof s.enabledProviders === "object") {
        setEnabledProviders({
          ...DEFAULT_ENABLED,
          ...(s.enabledProviders as Record<AIProvider, boolean>),
        });
      }
    });
  }, []);

  const loadModels = useCallback(async (p: AIProvider) => {
    if (loadedRef.current.has(p)) return;
    setLoadingProvider(p);
    try {
      const res = await fetch(`/api/models?provider=${p}`);
      const data = await res.json();
      if (data.error) {
        setErrors((prev) => ({ ...prev, [p]: data.error }));
      } else {
        setModels((prev) => ({
          ...prev,
          [p]: (data.models ?? []).map((m: { name: string }) => m.name),
        }));
        loadedRef.current.add(p);
      }
    } catch {
      setErrors((prev) => ({ ...prev, [p]: "Unavailable" }));
    } finally {
      setLoadingProvider(null);
    }
  }, []);

  // On open: sync tab to current provider, load its models
  useEffect(() => {
    if (!open) return;
    const newTab = LOCAL_PROVIDERS.includes(provider) ? "local" : "cloud";
    setTab(newTab);
    setHoveredProvider(provider);
    loadModels(provider);
  }, [open, provider, loadModels]);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;
    function onMouse(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const tabProviders = (tab === "cloud" ? CLOUD_PROVIDERS : LOCAL_PROVIDERS).filter(
    (p) => enabledProviders[p]
  );

  const popoverPos =
    direction === "up"
      ? "absolute bottom-full left-0 mb-1"
      : "absolute top-full left-0 mt-1";

  return (
    <div ref={ref} className="relative">
      {/* Trigger pill */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-all hover:bg-[#2e2e2e]"
      >
        <span className="text-[#d19a66]">{PROVIDER_LABELS[provider]}</span>
        <span className="text-[#383838]">·</span>
        <span className="max-w-[120px] truncate text-[#666]">
          {selectedModel ? shortModelName(selectedModel) : "Select"}
        </span>
        <svg className="h-2.5 w-2.5 text-[#333]" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {open && (
        <div
          className={`${popoverPos} z-50 w-[280px] overflow-hidden rounded-lg border border-[#252525] bg-[#161616] shadow-xl`}
        >
          {/* Tab bar */}
          <div className="flex border-b border-[#1e1e1e] bg-[#131313]">
            {(["cloud", "local"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  const first = (t === "cloud" ? CLOUD_PROVIDERS : LOCAL_PROVIDERS).find(
                    (p) => enabledProviders[p]
                  );
                  if (first) {
                    setHoveredProvider(first);
                    loadModels(first);
                  }
                }}
                className={`flex-1 py-2 text-[11px] font-medium border-b-2 transition-colors ${
                  tab === t
                    ? "border-[#d19a66] text-[#d19a66]"
                    : "border-transparent text-[#555] hover:text-[#888]"
                }`}
              >
                {t === "cloud" ? "☁ Cloud" : "⬡ Local"}
              </button>
            ))}
          </div>

          {tabProviders.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-[#555]">
              Enable backends in Settings → AI Backends
            </div>
          ) : (
            <>
              {/* Provider chips */}
              <div className="flex flex-wrap gap-1.5 border-b border-[#1e1e1e] px-2.5 py-2">
                {tabProviders.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onMouseEnter={() => {
                      setHoveredProvider(p);
                      loadModels(p);
                    }}
                    onClick={() => {
                      setHoveredProvider(p);
                      loadModels(p);
                    }}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
                      hoveredProvider === p
                        ? "border-[rgba(209,154,102,0.4)] bg-[rgba(209,154,102,0.12)] text-[#d19a66]"
                        : "border-[#2d2d2d] bg-[#222] text-[#888] hover:text-[#ccc]"
                    }`}
                  >
                    {PROVIDER_LABELS[p]}
                  </button>
                ))}
              </div>

              {/* Model list */}
              <div className="max-h-[140px] overflow-y-auto py-1">
                {loadingProvider === hoveredProvider ? (
                  <div className="px-3 py-2 text-[10px] text-[#444]">Loading…</div>
                ) : errors[hoveredProvider] ? (
                  <div className="px-3 py-2">
                    <div className="text-[11px] text-[#555]">
                      {PROVIDER_LABELS[hoveredProvider]} unavailable
                    </div>
                    <div className="mt-0.5 text-[10px] text-[#383838]">
                      {errors[hoveredProvider]}
                    </div>
                  </div>
                ) : models[hoveredProvider].length === 0 ? (
                  <div className="px-3 py-2 text-[10px] text-[#383838]">No models found</div>
                ) : (
                  models[hoveredProvider].map((m) => {
                    const isActive = m === selectedModel && hoveredProvider === provider;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          onProviderChange(hoveredProvider);
                          onModelChange(m);
                          localStorage.setItem("marven_last_provider", hoveredProvider);
                          localStorage.setItem("marven_last_model", m);
                          close();
                        }}
                        className={`flex w-full items-center gap-2 px-3 py-[6px] text-left transition-colors hover:bg-[#1c1c1c] ${
                          isActive ? "bg-[#1c1c1c]" : ""
                        }`}
                      >
                        <span
                          className={`h-[5px] w-[5px] shrink-0 rounded-full ${
                            isActive ? "bg-[#d19a66]" : "bg-[#2e2e2e]"
                          }`}
                        />
                        <span
                          className={`truncate text-[11px] ${
                            isActive ? "text-[#d19a66]" : "text-[#777]"
                          }`}
                        >
                          {shortModelName(m)}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/ModelSelector.tsx
git commit -m "feat(ui): add ModelSelector component with Local/Cloud tab design"
```

---

## Task 7: Update InputBar to use ModelSelector

**Files:**
- Modify: `app/components/marven/InputBar.tsx:7` and `app/components/marven/InputBar.tsx:351-356`
- Delete: `app/components/marven/GroupedModelDropdown.tsx`

- [ ] **Step 1: Update the import in `InputBar.tsx`**

In `app/components/marven/InputBar.tsx`, line 7, change:

```ts
import { GroupedModelDropdown } from "@/app/components/marven/GroupedModelDropdown";
```

to:

```ts
import { ModelSelector } from "@/app/components/marven/ModelSelector";
```

- [ ] **Step 2: Update the JSX usage in `InputBar.tsx`**

In `app/components/marven/InputBar.tsx`, lines 351-356, change:

```tsx
          <GroupedModelDropdown
            provider={provider}
            selectedModel={selectedModel}
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
          />
```

to:

```tsx
          <ModelSelector
            provider={provider}
            selectedModel={selectedModel}
            onProviderChange={onProviderChange}
            onModelChange={onModelChange}
          />
```

- [ ] **Step 3: Delete the old component**

```bash
rm "/Users/ahomsi/Development/Personal Projects/Marven/app/components/marven/GroupedModelDropdown.tsx"
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors. If there are errors about `PROVIDER_LABELS` or `shortModelName` being used elsewhere, update those imports to point to `ModelSelector` instead of `GroupedModelDropdown`.

- [ ] **Step 5: Commit**

```bash
git add app/components/marven/InputBar.tsx
git rm app/components/marven/GroupedModelDropdown.tsx
git commit -m "feat(ui): replace GroupedModelDropdown with ModelSelector in InputBar"
```

---

## Task 8: Settings — AI Backends panel

**Files:**
- Modify: `app/components/marven/SettingsModal.tsx`

Add a new "AI Backends" tab to `SettingsModal`. It shows an integrations-list-style panel with toggle rows for each provider plus URL inputs for local backends.

- [ ] **Step 1: Add `"ai-backends"` to the `SettingsPage` type**

In `app/components/marven/SettingsModal.tsx`, find lines 38-47:

```ts
type SettingsPage =
  | "general"
  | "api-keys"
  | "connectors"
  | "browser"
  | "shortcuts"
  | "keyboard"
  | "templates"
  | "commands"
  | "about";
```

Change to:

```ts
type SettingsPage =
  | "general"
  | "ai-backends"
  | "api-keys"
  | "connectors"
  | "browser"
  | "shortcuts"
  | "keyboard"
  | "templates"
  | "commands"
  | "about";
```

- [ ] **Step 2: Add "AI Backends" to the SECTIONS array**

In `app/components/marven/SettingsModal.tsx`, find the SECTIONS array. The "Integrations" heading block looks like:

```ts
  {
    heading: "Integrations",
    items: [
      { id: "api-keys", label: "API Keys" },
```

Add `"ai-backends"` as the first item under Integrations:

```ts
  {
    heading: "Integrations",
    items: [
      { id: "ai-backends", label: "AI Backends" },
      { id: "api-keys", label: "API Keys" },
```

- [ ] **Step 3: Add state variables for AI Backends**

In `app/components/marven/SettingsModal.tsx`, find the component's state declarations (near the top of the `SettingsModal` function body). Add these after the existing state declarations:

```ts
  // AI Backends state
  const [enabledProviders, setEnabledProviders] = useState<Record<string, boolean>>({
    groq: true, openai: true, ollama: true,
    anthropic: false, nim: false, openrouter: false,
    lmstudio: false, llamaserver: false,
  });
  const [lmStudioUrl, setLmStudioUrl] = useState("http://localhost:1234");
  const [llamaServerUrl, setLlamaServerUrl] = useState("http://localhost:8080");
  const [backendStatus, setBackendStatus] = useState<Record<string, "live" | "down" | "checking">>({
    ollama: "checking", lmstudio: "checking", llamaserver: "checking",
  });
```

- [ ] **Step 4: Load AI Backends settings on mount**

In `app/components/marven/SettingsModal.tsx`, find the `useEffect` that loads settings with `electron.getSettings()`. It looks like:

```ts
  useEffect(() => {
    if (!electron) return;
    electron.getSettings().then((s: any) => {
      if (s.groqApiKey) setGroqKey(s.groqApiKey);
      // ... other keys ...
```

Add these lines inside that `.then` callback, after the existing assignments:

```ts
      if (s.enabledProviders) setEnabledProviders((prev) => ({ ...prev, ...(s.enabledProviders as Record<string, boolean>) }));
      if (s.lmStudioUrl) setLmStudioUrl(s.lmStudioUrl);
      if (s.llamaServerUrl) setLlamaServerUrl(s.llamaServerUrl);
```

- [ ] **Step 5: Add status-check effect for AI Backends page**

In `app/components/marven/SettingsModal.tsx`, add this `useEffect` after the existing load effect:

```ts
  useEffect(() => {
    if (page !== "ai-backends") return;
    const localProviders = ["ollama", "lmstudio", "llamaserver"] as const;
    localProviders.forEach(async (p) => {
      setBackendStatus((prev) => ({ ...prev, [p]: "checking" }));
      try {
        const res = await fetch(`/api/models?provider=${p}`);
        const data = await res.json();
        setBackendStatus((prev) => ({
          ...prev,
          [p]: data.models && data.models.length > 0 ? "live" : "down",
        }));
      } catch {
        setBackendStatus((prev) => ({ ...prev, [p]: "down" }));
      }
    });
  }, [page]);
```

- [ ] **Step 6: Add helper to save AI Backends settings**

In `app/components/marven/SettingsModal.tsx`, add this helper function inside the component, near the other save handlers:

```ts
  async function saveBackendSettings(patch: Record<string, unknown>) {
    if (!electron) return;
    const current = await electron.getSettings();
    await electron.saveSettings({ ...current, ...patch });
  }
```

- [ ] **Step 7: Add the AI Backends render block**

In `app/components/marven/SettingsModal.tsx`, find the section where different pages are rendered — there will be a series of `{page === "general" && (...)}` blocks. Add the following block alongside them:

```tsx
        {page === "ai-backends" && (
          <div className="flex flex-col gap-0">
            {/* Cloud providers */}
            <div className="mb-1 px-1 pt-1 text-[9px] font-bold uppercase tracking-widest text-[var(--m-text-faint)]">
              Cloud
            </div>
            {([
              { id: "groq",       label: "Groq",       icon: "⚡", meta: "5 models", badge: "cloud" },
              { id: "openai",     label: "OpenAI",     icon: "◈", meta: "4 models", badge: "cloud" },
              { id: "anthropic",  label: "Anthropic",  icon: "✦", meta: "3 models", badge: "cloud" },
              { id: "nim",        label: "NIM",        icon: "◈", meta: "5 models", badge: "cloud" },
              { id: "openrouter", label: "OpenRouter", icon: "◉", meta: "5 models", badge: "cloud" },
            ] as const).map(({ id, label, icon, meta, badge }) => (
              <div
                key={id}
                className="flex items-center gap-3 border-b border-[var(--m-border-subtle)] py-2.5"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--m-surface-raised)] text-base">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] font-semibold text-[var(--m-text)]">{label}</span>
                    <span className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-widest bg-[rgba(97,175,239,0.1)] text-[#61afef]">
                      {badge}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--m-text-faint)]">{meta}</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const next = { ...enabledProviders, [id]: !enabledProviders[id] };
                    setEnabledProviders(next);
                    await saveBackendSettings({ enabledProviders: next });
                  }}
                  className={`relative h-[17px] w-[32px] shrink-0 rounded-full transition-colors ${
                    enabledProviders[id] ? "bg-[#d19a66]" : "bg-[#333]"
                  }`}
                  aria-label={enabledProviders[id] ? `Disable ${label}` : `Enable ${label}`}
                >
                  <span
                    className={`absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all ${
                      enabledProviders[id] ? "left-[17px]" : "left-[2px]"
                    }`}
                  />
                </button>
              </div>
            ))}

            {/* Local backends */}
            <div className="mb-1 mt-4 px-1 text-[9px] font-bold uppercase tracking-widest text-[var(--m-text-faint)]">
              Local
            </div>
            {([
              { id: "ollama",      label: "Ollama",      icon: "🦙", badge: "local", hasUrl: false },
              { id: "lmstudio",    label: "LM Studio",   icon: "◉",  badge: "local", hasUrl: true  },
              { id: "llamaserver", label: "llama-server", icon: "⬡", badge: "local", hasUrl: true  },
            ] as const).map(({ id, label, icon, badge, hasUrl }) => (
              <div
                key={id}
                className="flex flex-col border-b border-[var(--m-border-subtle)] py-2.5 gap-1.5"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--m-surface-raised)] text-base">
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] font-semibold text-[var(--m-text)]">{label}</span>
                      <span className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-widest bg-[rgba(152,195,121,0.1)] text-[#98c379]">
                        {badge}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--m-text-faint)]">
                      {backendStatus[id] === "checking" && "Checking…"}
                      {backendStatus[id] === "live"     && <span className="text-[#98c379]">● running</span>}
                      {backendStatus[id] === "down"     && <span className="text-[#555]">✗ not running</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const next = { ...enabledProviders, [id]: !enabledProviders[id] };
                      setEnabledProviders(next);
                      await saveBackendSettings({ enabledProviders: next });
                    }}
                    className={`relative h-[17px] w-[32px] shrink-0 rounded-full transition-colors ${
                      enabledProviders[id] ? "bg-[#d19a66]" : "bg-[#333]"
                    }`}
                    aria-label={enabledProviders[id] ? `Disable ${label}` : `Enable ${label}`}
                  >
                    <span
                      className={`absolute top-[2px] h-[13px] w-[13px] rounded-full bg-white transition-all ${
                        enabledProviders[id] ? "left-[17px]" : "left-[2px]"
                      }`}
                    />
                  </button>
                </div>
                {hasUrl && (
                  <input
                    type="text"
                    value={id === "lmstudio" ? lmStudioUrl : llamaServerUrl}
                    onChange={(e) => {
                      if (id === "lmstudio") setLmStudioUrl(e.target.value);
                      else setLlamaServerUrl(e.target.value);
                    }}
                    onBlur={async (e) => {
                      const val = e.target.value.trim();
                      try {
                        new URL(val);
                        const key = id === "lmstudio" ? "lmStudioUrl" : "llamaServerUrl";
                        await saveBackendSettings({ [key]: val });
                      } catch {
                        // revert invalid URL
                        if (id === "lmstudio") setLmStudioUrl(lmStudioUrl);
                        else setLlamaServerUrl(llamaServerUrl);
                      }
                    }}
                    className="ml-11 rounded border border-[var(--m-border)] bg-[var(--m-surface-raised)] px-2 py-1 font-mono text-[11px] text-[var(--m-text-muted)] focus:outline-none focus:border-[var(--m-accent)]"
                    spellCheck={false}
                  />
                )}
              </div>
            ))}
          </div>
        )}
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add app/components/marven/SettingsModal.tsx
git commit -m "feat(ui): add AI Backends settings panel with provider toggles"
```

---

## Task 9: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npm test 2>&1
```

Expected: all tests PASS (including the 6 new tests for lmstudio and llamaserver).

- [ ] **Step 2: TypeScript full check**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Smoke test in dev mode**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven" && npm run electron:dev
```

Verify manually:
- The input bar shows the `Provider · model ▾` pill as before
- Clicking it opens the new popup with Cloud / Local tabs
- Cloud tab shows only enabled providers (Groq, OpenAI, Ollama by default)
- Local tab shows Ollama; enabling LM Studio in Settings → AI Backends makes it appear
- Settings → AI Backends panel shows all providers with toggles and live status for local ones
- LM Studio URL field saves on blur and persists after restart

- [ ] **Step 4: Commit (if any last-minute fixes were needed)**

```bash
git add -p
git commit -m "fix: final adjustments from smoke test"
```
