# Marven v1.4.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenRouter as a free AI provider, color-code the UI, make agent panels resizable by dragging, and tighten the model dropdown to show ~5 models at a time.

**Architecture:** OpenRouter uses the OpenAI-compatible API (same shape as Groq), so a new `lib/openrouter.ts` and `lib/agent/openrouter.ts` slot in alongside the existing providers with minimal changes to routing. Resizable panels use a drag handle div + mouse event listeners in `AgentWorkspace.tsx`, with width stored in `localStorage`. Color changes are limited to Tailwind class updates in `ChatLayout.tsx` and one CSS addition in `globals.css`.

**Tech Stack:** Next.js 15, Electron 41, TypeScript, Tailwind CSS v4, OpenRouter API (OpenAI-compatible)

---

## File Map

| File | Action | Reason |
|------|--------|--------|
| `lib/openrouter.ts` | Create | Streaming chat client for OpenRouter |
| `lib/agent/openrouter.ts` | Create | Agent step for OpenRouter |
| `types/index.ts` | Modify line 2 | Add "openrouter" to AIProvider union |
| `app/api/models/route.ts` | Modify | Add openrouter case |
| `app/api/chat/route.ts` | Modify | Add openrouter streaming branch |
| `app/api/agent/stream/route.ts` | Modify | Wire openrouterAgentStep |
| `electron/main.js` | Modify | Store/apply openrouterApiKey in settings |
| `app/components/marven/SettingsModal.tsx` | Modify | Add OpenRouter API key field |
| `app/components/marven/ChatLayout.tsx` | Modify | Add OpenRouter button, color-code providers, shrink dropdown |
| `app/components/marven/AgentWorkspace.tsx` | Modify | Drag handle for resizable panels |
| `app/globals.css` | Modify | Add gold gradient utility |

---

## Task 1: OpenRouter Chat Library

**Files:**
- Create: `lib/openrouter.ts`

- [ ] **Step 1: Create `lib/openrouter.ts`**

```typescript
import type { HistoryMessage } from "@/types";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_MODEL = "google/gemma-3-27b-it:free";

export const OPENROUTER_MODELS = [
  { name: "google/gemma-3-27b-it:free", size: 0 },
  { name: "meta-llama/llama-3.1-8b-instruct:free", size: 0 },
  { name: "microsoft/phi-3-mini-128k-instruct:free", size: 0 },
  { name: "deepseek/deepseek-r1:free", size: 0 },
  { name: "mistralai/mistral-7b-instruct:free", size: 0 },
];

export async function streamOpenRouter(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): Promise<ReadableStream<Uint8Array>> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set in settings");

  const sysMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }]
    : [];

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://marven.app",
      "X-Title": "Marven",
    },
    body: JSON.stringify({
      model,
      messages: [...sysMessages, ...messages],
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter error (${res.status}): ${text || "unknown"}`);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      const reader = res.body!.getReader();
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.replace(/^data: /, "").trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const json = JSON.parse(trimmed);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
            if (json.usage) {
              usage = {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              };
            }
          } catch { /* ignore */ }
        }
      }

      controller.enqueue(
        encoder.encode(`\n\n__USAGE__${JSON.stringify(usage)}`)
      );
      controller.close();
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/openrouter.ts
git commit -m "feat: add OpenRouter streaming chat client"
```

---

## Task 2: OpenRouter Agent Step

**Files:**
- Create: `lib/agent/openrouter.ts`

- [ ] **Step 1: Create `lib/agent/openrouter.ts`**

```typescript
import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

function toOpenRouterMessages(
  messages: InternalMessage[]
): Array<Record<string, unknown>> {
  return messages.flatMap((m) => {
    if (m.role === "system") return [{ role: "system", content: m.content }];
    if (m.role === "user") return [{ role: "user", content: m.content }];
    if (m.role === "assistant") return [{ role: "assistant", content: m.content }];
    if (m.role === "assistant_tool_call") {
      return [{
        role: "assistant",
        content: null,
        tool_calls: [{
          id: m.callId,
          type: "function",
          function: { name: m.tool, arguments: JSON.stringify(m.args) },
        }],
      }] as Array<Record<string, unknown>>;
    }
    if (m.role === "tool_result") {
      return [{ role: "tool", tool_call_id: m.callId, content: m.content }];
    }
    return [];
  }) as Array<Record<string, unknown>>;
}

export async function openrouterAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set in settings");

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://marven.app",
      "X-Title": "Marven",
    },
    body: JSON.stringify({
      model,
      messages: toOpenRouterMessages(messages),
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter error (${res.status}): ${text || "unknown"}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (choice?.finish_reason === "tool_calls" && choice.message?.tool_calls?.length) {
    const tc = choice.message.tool_calls[0];
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
    return { type: "tool_call", callId: tc.id, tool: tc.function.name, args };
  }

  return { type: "text", content: (choice?.message?.content as string ?? "").trim() };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/openrouter.ts
git commit -m "feat: add OpenRouter agent step"
```

---

## Task 3: Wire OpenRouter into Types + API Routes

**Files:**
- Modify: `types/index.ts` (line 2)
- Modify: `app/api/models/route.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/agent/stream/route.ts`

- [ ] **Step 1: Update `types/index.ts` line 2** — change:

```typescript
export type AIProvider = "groq" | "ollama" | "nim";
```

to:

```typescript
export type AIProvider = "groq" | "ollama" | "nim" | "openrouter";
```

- [ ] **Step 2: Update `app/api/models/route.ts`** — add import and openrouter case:

Add to imports (after line 4):
```typescript
import { OPENROUTER_MODELS, DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter";
```

Add before the final `return NextResponse.json({ provider: "groq" ... })` (before line 39):
```typescript
  if (provider === "openrouter") {
    return NextResponse.json({
      provider: "openrouter",
      models: OPENROUTER_MODELS,
      defaultModel: OPENROUTER_DEFAULT_MODEL,
    });
  }
```

- [ ] **Step 3: Update `app/api/chat/route.ts`** — add import and openrouter branch:

Add to imports (after line 6):
```typescript
import { streamOpenRouter, DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter";
```

Update the defaultModel line (line 23) — change:
```typescript
  const defaultModel = provider === "ollama" ? OLLAMA_DEFAULT_MODEL : provider === "nim" ? NIM_DEFAULT_MODEL : GROQ_DEFAULT_MODEL;
```
to:
```typescript
  const defaultModel =
    provider === "ollama" ? OLLAMA_DEFAULT_MODEL :
    provider === "nim"    ? NIM_DEFAULT_MODEL :
    provider === "openrouter" ? OPENROUTER_DEFAULT_MODEL :
    GROQ_DEFAULT_MODEL;
```

Add before the final `// 4. Groq` comment (before line 92):
```typescript
  if (provider === "openrouter") {
    try {
      const history = messages.slice(-20);
      const stream = await streamOpenRouter(history, model, body.systemPrompt);
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
      return NextResponse.json({ reply: `Marven couldn't reach OpenRouter: ${msg}` }, { status: 503 });
    }
  }
```

- [ ] **Step 4: Update `app/api/agent/stream/route.ts`** — add import and route:

Add to imports (after line 6):
```typescript
import { openrouterAgentStep } from "@/lib/agent/openrouter";
```

Update the `providerStep` assignment (lines 57-60) — change:
```typescript
  const providerStep =
    provider === "groq" ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => groqAgentStep(msgs, tools, model) :
    provider === "nim"  ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => nimAgentStep(msgs, tools, model) :
    (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => ollamaAgentStep(msgs, tools, model);
```
to:
```typescript
  const providerStep =
    provider === "groq"        ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => groqAgentStep(msgs, tools, model) :
    provider === "nim"         ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => nimAgentStep(msgs, tools, model) :
    provider === "openrouter"  ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => openrouterAgentStep(msgs, tools, model) :
    (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => ollamaAgentStep(msgs, tools, model);
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all 13 tests pass.

- [ ] **Step 6: Commit**

```bash
git add types/index.ts app/api/models/route.ts app/api/chat/route.ts app/api/agent/stream/route.ts
git commit -m "feat: wire OpenRouter into API routes and types"
```

---

## Task 4: Settings — OpenRouter API Key

**Files:**
- Modify: `electron/main.js`
- Modify: `app/components/marven/SettingsModal.tsx`

- [ ] **Step 1: Update `electron/main.js` `applySettings` function**

Find the `applySettings` function (around line 90):
```javascript
function applySettings(settings) {
  if (settings.groqApiKey)  process.env.GROQ_API_KEY = settings.groqApiKey;
  if (settings.ollamaUrl)   process.env.OLLAMA_URL   = settings.ollamaUrl;
  if (settings.nimApiKey)   process.env.NIM_API_KEY  = settings.nimApiKey;
}
```

Change to:
```javascript
function applySettings(settings) {
  if (settings.groqApiKey)       process.env.GROQ_API_KEY        = settings.groqApiKey;
  if (settings.ollamaUrl)        process.env.OLLAMA_URL          = settings.ollamaUrl;
  if (settings.nimApiKey)        process.env.NIM_API_KEY         = settings.nimApiKey;
  if (settings.openrouterApiKey) process.env.OPENROUTER_API_KEY  = settings.openrouterApiKey;
}
```

- [ ] **Step 2: Update `app/components/marven/SettingsModal.tsx` state**

Find the API Keys tab state block (lines 82–85):
```typescript
  const [groqKey, setGroqKey] = useState("");
  const [nimKey, setNimKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [keysSaved, setKeysSaved] = useState(false);
```

Change to:
```typescript
  const [groqKey, setGroqKey] = useState("");
  const [nimKey, setNimKey] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [keysSaved, setKeysSaved] = useState(false);
```

- [ ] **Step 3: Update `SettingsModal.tsx` `useEffect` settings load (lines 93–97)**

Change:
```typescript
    electron.getSettings().then((s: any) => {
      if (s.groqApiKey) setGroqKey(s.groqApiKey);
      if (s.nimApiKey)  setNimKey(s.nimApiKey);
      if (s.ollamaUrl)  setOllamaUrl(s.ollamaUrl);
    });
```

to:
```typescript
    electron.getSettings().then((s: any) => {
      if (s.groqApiKey)       setGroqKey(s.groqApiKey);
      if (s.nimApiKey)        setNimKey(s.nimApiKey);
      if (s.openrouterApiKey) setOpenrouterKey(s.openrouterApiKey);
      if (s.ollamaUrl)        setOllamaUrl(s.ollamaUrl);
    });
```

- [ ] **Step 4: Update `handleSaveKeys` in `SettingsModal.tsx` (line 119)**

Change:
```typescript
    await electron.saveSettings({ groqApiKey: groqKey.trim(), nimApiKey: nimKey.trim(), ollamaUrl: ollamaUrl.trim() });
```

to:
```typescript
    await electron.saveSettings({
      groqApiKey: groqKey.trim(),
      nimApiKey: nimKey.trim(),
      openrouterApiKey: openrouterKey.trim(),
      ollamaUrl: ollamaUrl.trim(),
    });
```

- [ ] **Step 5: Add OpenRouter key input to `SettingsModal.tsx` API keys tab**

After the NIM block (after the closing `</div>` of the NIM section, around line 480), add:

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
                  Free at openrouter.ai — access Gemma, Llama, Mistral & more at no cost.
                </p>
              </div>
```

- [ ] **Step 6: Commit**

```bash
git add electron/main.js app/components/marven/SettingsModal.tsx
git commit -m "feat: add OpenRouter API key to settings"
```

---

## Task 5: Provider Button + Model Dropdown (ChatLayout.tsx)

**Files:**
- Modify: `app/components/marven/ChatLayout.tsx`

- [ ] **Step 1: Add OpenRouter to the provider toggle buttons (lines 335–369)**

Replace the entire `{/* Provider toggle */}` block:
```tsx
                {/* Provider toggle */}
                <div className="inline-flex rounded-lg bg-[#252525] border border-[#383838] p-0.5">
                  <button
                    type="button"
                    onClick={() => onProviderChange("groq")}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                      provider === "groq"
                        ? "bg-[#333] text-[#d4d4d4]"
                        : "text-[#777] hover:text-[#ccc]"
                    }`}
                  >
                    Cloud
                  </button>
                  <button
                    type="button"
                    onClick={() => onProviderChange("ollama")}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                      provider === "ollama"
                        ? "bg-[#333] text-[#d4d4d4]"
                        : "text-[#777] hover:text-[#ccc]"
                    }`}
                  >
                    Ollama
                  </button>
                  <button
                    type="button"
                    onClick={() => onProviderChange("nim")}
                    className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                      provider === "nim"
                        ? "bg-[#333] text-[#d4d4d4]"
                        : "text-[#777] hover:text-[#ccc]"
                    }`}
                  >
                    NIM
                  </button>
                </div>
```

with:
```tsx
                {/* Provider toggle */}
                <div className="inline-flex rounded-lg bg-[#252525] border border-[#383838] p-0.5">
                  {(
                    [
                      { id: "groq",        label: "Groq",        color: "#9333ea" },
                      { id: "ollama",      label: "Ollama",      color: "#3b82f6" },
                      { id: "nim",         label: "NIM",         color: "#22c55e" },
                      { id: "openrouter",  label: "OpenRouter",  color: "#06b6d4" },
                    ] as const
                  ).map(({ id, label, color }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onProviderChange(id)}
                      style={provider === id ? { color } : undefined}
                      className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
                        provider === id
                          ? "bg-[#333] font-medium"
                          : "text-[#777] hover:text-[#ccc]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
```

- [ ] **Step 2: Shrink model dropdown height**

In `ModelDropdown` component (line 151), change `max-h-64` to `max-h-[160px]` so only ~5 models show at a time before scrolling:

```tsx
        <div className="absolute left-0 top-full z-50 mt-1 max-h-[160px] w-64 overflow-y-auto rounded-lg border border-[#383838] bg-[#1e1e1e] py-1 shadow-xl">
```

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/ChatLayout.tsx
git commit -m "feat: add OpenRouter provider button, color-coded providers, shrink model dropdown"
```

---

## Task 6: Resizable Panels (AgentWorkspace.tsx)

**Files:**
- Modify: `app/components/marven/AgentWorkspace.tsx`

- [ ] **Step 1: Add `agentWidth` state and drag logic to `AgentWorkspace`**

Add to the existing imports at the top (already has `useState, useRef, useEffect`):

Replace the `AgentWorkspace` component opening (lines 103–130) with:

```typescript
export function AgentWorkspace({
  messages,
  input,
  isRunning,
  error,
  provider,
  model,
  workspaceRoot,
  files,
  selectedFilePath,
  fileContent,
  isFileLoading,
  isFileDirty,
  terminalOutput,
  onInputChange,
  onSend,
  onStop,
  onSlashCommand,
  onOpenFolder,
  onSelectFile,
  onFileContentChange,
  onSaveFile,
  onRefreshFiles,
}: AgentWorkspaceProps) {
  const [showAgent, setShowAgent] = useState(true);
  const [showEditor, setShowEditor] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);

  const [agentWidth, setAgentWidth] = useState(() => {
    if (typeof window === "undefined") return 320;
    return Number(localStorage.getItem("marven-agent-width") ?? 320);
  });
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!isDragging.current) return;
      const delta = e.clientX - dragStartX.current;
      const next = Math.min(600, Math.max(200, dragStartWidth.current + delta));
      setAgentWidth(next);
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("marven-agent-width", String(agentWidth));
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [agentWidth]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = agentWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }
```

- [ ] **Step 2: Update the panel layout JSX in `AgentWorkspace` (lines 145–190)**

Replace the three-column layout `<div className="flex min-h-0 flex-1 overflow-hidden">` block with:

```tsx
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left — Agent panel */}
        {showAgent && (
          <div
            className="flex flex-col border-r border-[#333]"
            style={{ width: showEditor ? agentWidth : undefined, minWidth: showEditor ? agentWidth : undefined, flex: showEditor ? "none" : 1 }}
          >
            <WorkspaceBar
              workspaceRoot={workspaceRoot}
              provider={provider}
              model={model}
              onOpenFolder={onOpenFolder}
            />
            <div className="min-h-0 flex-1">
              <AgentPanel
                messages={messages}
                input={input}
                isRunning={isRunning}
                error={error}
                onInputChange={onInputChange}
                onSend={onSend}
                onStop={onStop}
                onSlashCommand={onSlashCommand}
              />
            </div>
          </div>
        )}

        {/* Drag handle — only shown when both panels are visible */}
        {showAgent && showEditor && (
          <div
            onMouseDown={startDrag}
            className="group relative z-10 -ml-px w-1 cursor-col-resize bg-transparent hover:bg-[#d19a66]/40 active:bg-[#d19a66]/60 transition-colors"
            title="Drag to resize"
          >
            {/* Visual pill indicator */}
            <div className="absolute inset-y-0 left-0 right-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="h-8 w-0.5 rounded-full bg-[#d19a66]/60" />
            </div>
          </div>
        )}

        {/* Right — Editor panel */}
        {showEditor && (
          <div className="min-h-0 min-w-0 flex-1">
            <EditorPanel
              files={files}
              workspaceRoot={workspaceRoot}
              selectedFilePath={selectedFilePath}
              fileContent={fileContent}
              isFileLoading={isFileLoading}
              isFileDirty={isFileDirty}
              terminalOutput={terminalOutput}
              showTerminal={showTerminal}
              onToggleTerminal={() => setShowTerminal((v) => !v)}
              onSelectFile={onSelectFile}
              onFileContentChange={onFileContentChange}
              onSaveFile={onSaveFile}
              onRefreshFiles={onRefreshFiles}
            />
          </div>
        )}
      </div>
```

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/AgentWorkspace.tsx
git commit -m "feat: resizable agent/editor panels with drag handle"
```

---

## Task 7: Color Improvements

**Files:**
- Modify: `app/globals.css`
- Modify: `app/components/marven/ChatLayout.tsx`

- [ ] **Step 1: Add gold gradient utility to `app/globals.css`**

After the existing `.cursor-blink` block (around line 72), add:

```css
/* Gold gradient header accent */
.gold-gradient {
  background: linear-gradient(
    135deg,
    rgba(209, 154, 102, 0.08) 0%,
    rgba(209, 154, 102, 0.03) 50%,
    transparent 100%
  );
}
```

- [ ] **Step 2: Apply gold gradient to the chat header in `ChatLayout.tsx`**

Find the `<header>` element (line 297):
```tsx
          <header className="bg-[#1e1e1e] border-b border-[#333] px-6 pb-3 pt-3 sm:px-8">
```

Change to:
```tsx
          <header className="gold-gradient bg-[#1e1e1e] border-b border-[#333] px-6 pb-3 pt-3 sm:px-8">
```

- [ ] **Step 3: Add warm tint to user message bubbles in `app/components/marven/Message.tsx`**

First read `app/components/marven/Message.tsx` to find where user messages are styled (look for `role === "user"`). Find the user message container and add a warm border-left or background tint. 

In the user message branch, find the container class and add `border-l border-[#d19a66]/15` alongside the existing border styling to give a subtle gold left-edge accent.

- [ ] **Step 4: Commit**

```bash
git add app/globals.css app/components/marven/ChatLayout.tsx app/components/marven/Message.tsx
git commit -m "feat: gold gradient header, color-coded provider buttons, warm message tint"
```

---

## Task 8: Bump Version to 1.4.0

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update version in `package.json`**

Change line 4:
```json
  "version": "1.3.1",
```
to:
```json
  "version": "1.4.0",
```

- [ ] **Step 2: Commit and tag**

```bash
git add package.json
git commit -m "chore: bump version to 1.4.0"
git tag v1.4.0
git push && git push origin v1.4.0
```

Expected: GitHub Actions "Build Desktop App" workflow triggers and builds Mac + Windows + Linux artifacts automatically.

---

## Self-Review

**Spec coverage:**
- ✅ Model selector — shrunk to max-h-[160px] (Task 5)
- ✅ More colors — color-coded providers (Task 5), gold gradient header (Task 7)
- ✅ Resizable panels — drag handle with localStorage persistence (Task 6)
- ✅ OpenRouter free models — library + agent + routing + settings (Tasks 1–4)

**Placeholder scan:** No TBDs or incomplete steps found.

**Type consistency:** `AIProvider` updated in Task 3 Step 1 before being used in Task 5 (ChatLayout). `openrouterAgentStep` defined in Task 2 and imported in Task 3 Step 4. `openrouterKey` state defined in Task 4 Step 2 before Step 4 references it.

---
