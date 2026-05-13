# Marven Agent Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the basic one-shot file-editing agent with a full tool-use loop (like Claude Code) that streams each step live, supports opening any folder as a workspace, and has a redesigned Obsidian+Sand UI — all without touching existing chat mode.

**Architecture:** Server-side tool-use loop runs in a Next.js SSE route handler, emitting `tool_call`/`tool_result`/`text_delta`/`done`/`error` events. Groq uses its native function-calling API; Ollama uses `/api/chat` with `tools` field and emits a clear error if the model doesn't support it. The client subscribes via a `useAgentStream` hook and renders each event live.

**Tech Stack:** Next.js 15, React 19, TypeScript 6, Tailwind CSS v4, Groq REST API (fetch, no SDK), Ollama REST API, Vitest for unit tests, Node.js `fs/promises` + `child_process` for tool execution.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `types/index.ts` | Modify | Add `AgentEvent`, `ToolDefinition`, `InternalMessage`, `WorkspaceSession` |
| `lib/agent/tools.ts` | Create | 5 tool definitions + sandboxed executor |
| `lib/agent/groq.ts` | Create | Groq function-calling adapter |
| `lib/agent/ollama.ts` | Create | Ollama tool-calling adapter + capability check |
| `lib/agent/loop.ts` | Create | Provider-agnostic tool-use loop |
| `app/api/agent/stream/route.ts` | Create | SSE streaming endpoint |
| `app/api/workspace/files/route.ts` | Modify | Add `PATCH` for setting workspace root |
| `hooks/useAgentStream.ts` | Create | SSE client hook → dispatches events into state |
| `app/components/marven/WorkspaceBar.tsx` | Create | Folder path + "Open" button + model/provider pill |
| `app/components/marven/ToolCallCard.tsx` | Create | Single tool call: pending → running → done/error |
| `app/components/marven/AgentPanel.tsx` | Create | Left panel: conversation + live tool stream + input |
| `app/components/marven/EditorPanel.tsx` | Create | Right panel: file tabs + editor textarea + terminal |
| `app/components/marven/AgentWorkspace.tsx` | Rewrite | Compose `AgentPanel` + `EditorPanel`, Obsidian+Sand |
| `app/page.tsx` | Modify | Wire `useAgentStream`, `workspaceRoot` state, new handlers |

**Unchanged:** all chat-mode components, `/api/chat`, `/api/system`, `/api/weather`, `/api/news`, `/api/vision`, `/api/tts`, `/api/stt`, `/api/models`, `lib/groq.ts`, `lib/ollama.ts`, `lib/commandParser.ts`, `lib/executeCommand.ts`, `lib/speak.ts`, `lib/storage.ts`, `lib/userProfile.ts`, `lib/workspace.ts`, `hooks/useVoice.ts`.

---

## Task 1: Vitest Setup + Type Extensions

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Modify: `types/index.ts`

- [ ] **Step 1: Install Vitest**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
npm install -D vitest
```

- [ ] **Step 2: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: { environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

- [ ] **Step 3: Add test script to package.json**

Open `package.json` and add to `"scripts"`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add new types to types/index.ts**

Append to the end of `types/index.ts`:

```ts
// ─── Agent tool-use loop types ────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/** A message inside the running tool-use loop (not the same as HistoryMessage) */
export type InternalMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "assistant_tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { role: "tool_result"; callId: string; content: string };

export type AgentEventType = "tool_call" | "tool_result" | "text_delta" | "done" | "error";

export interface AgentEvent {
  type: AgentEventType;
  // tool_call
  callId?: string;
  tool?: string;
  args?: Record<string, unknown>;
  // tool_result
  output?: string;
  truncated?: boolean;
  // text_delta
  delta?: string;
  // done
  toolCallCount?: number;
  // error
  code?: string;
  message?: string;
  suggestions?: string[];
}

export interface WorkspaceSession {
  root: string;
  name: string;
}

/** A message in the agent conversation panel */
export interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallState[];
}

/** Per-tool-call UI state rendered by ToolCallCard */
export interface ToolCallState {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "done" | "error";
  output?: string;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git init && git add vitest.config.ts package.json types/index.ts && git commit -m "feat: add vitest + agent type definitions"
```

---

## Task 2: Tool Definitions & Executor

**Files:**
- Create: `lib/agent/tools.ts`
- Create: `lib/agent/tools.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/agent/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeTool, TOOL_DEFINITIONS } from "./tools";
import fs from "fs/promises";
import os from "os";
import path from "path";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "marven-test-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("TOOL_DEFINITIONS", () => {
  it("exports 5 tools", () => {
    expect(TOOL_DEFINITIONS).toHaveLength(5);
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toContain("list_files");
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("run_command");
    expect(names).toContain("search_files");
  });
});

describe("executeTool – write_file + read_file", () => {
  it("writes then reads a file", async () => {
    await executeTool("write_file", { path: "hello.txt", content: "world" }, tmpDir);
    const result = await executeTool("read_file", { path: "hello.txt" }, tmpDir);
    expect(result).toBe("world");
  });
});

describe("executeTool – list_files", () => {
  it("lists files in workspace root", async () => {
    await fs.writeFile(path.join(tmpDir, "a.ts"), "");
    await fs.writeFile(path.join(tmpDir, "b.ts"), "");
    const result = await executeTool("list_files", {}, tmpDir);
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
  });
});

describe("executeTool – path escape guard", () => {
  it("rejects paths that escape workspace", async () => {
    await expect(
      executeTool("read_file", { path: "../../etc/passwd" }, tmpDir)
    ).rejects.toThrow("escapes the workspace");
  });
});

describe("executeTool – run_command blocks dangerous patterns", () => {
  it("blocks sudo", async () => {
    const result = await executeTool("run_command", { command: "sudo ls" }, tmpDir);
    expect(result).toMatch(/blocked/i);
  });

  it("blocks rm -rf /", async () => {
    const result = await executeTool("run_command", { command: "rm -rf /" }, tmpDir);
    expect(result).toMatch(/blocked/i);
  });

  it("runs safe commands", async () => {
    const result = await executeTool("run_command", { command: "echo hello" }, tmpDir);
    expect(result).toBe("hello");
  });
});

describe("executeTool – search_files", () => {
  it("finds matching content", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "export function hello() {}");
    const result = await executeTool("search_files", { query: "hello" }, tmpDir);
    expect(result).toContain("hello");
  });

  it("returns no-matches message when nothing found", async () => {
    await fs.writeFile(path.join(tmpDir, "app.ts"), "nothing here");
    const result = await executeTool("search_files", { query: "zzznomatch" }, tmpDir);
    expect(result).toMatch(/no matches/i);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module './tools'`

- [ ] **Step 3: Create lib/agent/tools.ts**

```ts
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import type { ToolDefinition } from "@/types";

const execAsync = promisify(exec);

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_files",
    description: "List files and directories in the workspace or a subdirectory.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path within workspace. Defaults to root." },
      },
      required: [],
    },
  },
  {
    name: "read_file",
    description: "Read the full contents of a file in the workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite a file. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file." },
        content: { type: "string", description: "Full file contents to write." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_command",
    description: "Run a shell command inside the workspace. Use for npm, git, tests, etc.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run." },
        cwd: { type: "string", description: "Optional relative subdirectory to run in." },
      },
      required: ["command"],
    },
  },
  {
    name: "search_files",
    description: "Search for a string across workspace source files.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "String to search for." },
        path: { type: "string", description: "Optional subdirectory to scope the search." },
      },
      required: ["query"],
    },
  },
];

const BLOCKED = [/sudo/, /rm\s+-rf\s+\//, /mkfs/, /dd\s+if=/, />\s*\/dev\//];

export function assertSafePath(workspaceRoot: string, relPath: string): string {
  const resolved = path.resolve(workspaceRoot, relPath);
  if (!resolved.startsWith(workspaceRoot + path.sep) && resolved !== workspaceRoot) {
    throw new Error(`Path "${relPath}" escapes the workspace`);
  }
  return resolved;
}

const MAX_READ = 8_000;

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot: string
): Promise<string> {
  switch (name) {
    case "list_files": {
      const rel = (args.path as string | undefined) ?? ".";
      const dir = assertSafePath(workspaceRoot, rel);
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .map((e) => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`)
        .join("\n") || "(empty directory)";
    }

    case "read_file": {
      const abs = assertSafePath(workspaceRoot, args.path as string);
      const content = await fs.readFile(abs, "utf-8");
      if (content.length > MAX_READ) {
        return content.slice(0, MAX_READ) + `\n\n[truncated — ${content.length - MAX_READ} more chars]`;
      }
      return content;
    }

    case "write_file": {
      const abs = assertSafePath(workspaceRoot, args.path as string);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, args.content as string, "utf-8");
      return `Written: ${args.path}`;
    }

    case "run_command": {
      const cmd = args.command as string;
      for (const pattern of BLOCKED) {
        if (pattern.test(cmd)) {
          return `Blocked: command matches unsafe pattern "${pattern.source}"`;
        }
      }
      const cwd = args.cwd
        ? assertSafePath(workspaceRoot, args.cwd as string)
        : workspaceRoot;
      try {
        const { stdout, stderr } = await execAsync(cmd, { cwd, timeout: 30_000 });
        return (stdout + stderr).trim() || "(no output)";
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    }

    case "search_files": {
      const query = (args.query as string).replace(/"/g, '\\"');
      const searchPath = args.path
        ? assertSafePath(workspaceRoot, args.path as string)
        : workspaceRoot;
      try {
        const { stdout } = await execAsync(
          `grep -r --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.json" --include="*.md" -n "${query}" .`,
          { cwd: searchPath }
        );
        return stdout.trim() || "No matches found";
      } catch {
        return "No matches found";
      }
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```

Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/tools.ts lib/agent/tools.test.ts && git commit -m "feat: agent tool definitions and executor"
```

---

## Task 3: Groq Agent Adapter

**Files:**
- Create: `lib/agent/groq.ts`

The Groq API is already used in `lib/groq.ts` via fetch. This adapter adds function-calling support for the agent loop only — it does not modify `lib/groq.ts`.

- [ ] **Step 1: Create lib/agent/groq.ts**

```ts
import type { ToolDefinition, InternalMessage } from "@/types";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export type ProviderStepResult =
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "text"; content: string };

/** Convert internal loop messages to the Groq (OpenAI-compatible) format. */
function toGroqMessages(
  messages: InternalMessage[]
): Record<string, unknown>[] {
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
      }];
    }
    if (m.role === "tool_result") {
      return [{ role: "tool", tool_call_id: m.callId, content: m.content }];
    }
    return [];
  });
}

export async function groqAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set in .env.local");

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: toGroqMessages(messages),
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq error (${res.status}): ${text || "unknown"}`);
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

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/groq.ts && git commit -m "feat: Groq agent adapter with native tool calling"
```

---

## Task 4: Ollama Agent Adapter

**Files:**
- Create: `lib/agent/ollama.ts`

Note: `lib/ollama.ts` uses `/api/generate` which does not support tool calling. This new adapter uses `/api/chat` with the `tools` field.

- [ ] **Step 1: Create lib/agent/ollama.ts**

```ts
import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";

const OLLAMA_BASE = "http://localhost:11434";

/** Models known to support tool calling in Ollama */
export const OLLAMA_TOOL_CAPABLE_MODELS = [
  "llama3.1",
  "llama3.2",
  "qwen2.5-coder",
  "mistral-nemo",
  "mistral",
  "hermes3",
];

function toOllamaMessages(messages: InternalMessage[]): Record<string, unknown>[] {
  return messages.flatMap((m) => {
    if (m.role === "system") return [{ role: "system", content: m.content }];
    if (m.role === "user") return [{ role: "user", content: m.content }];
    if (m.role === "assistant") return [{ role: "assistant", content: m.content }];
    if (m.role === "assistant_tool_call") {
      return [{
        role: "assistant",
        content: "",
        tool_calls: [{
          function: { name: m.tool, arguments: m.args },
        }],
      }];
    }
    if (m.role === "tool_result") {
      return [{ role: "tool", content: m.content }];
    }
    return [];
  });
}

export class OllamaToolsNotSupportedError extends Error {
  constructor(model: string) {
    super(
      `Model "${model}" does not support tool use. ` +
      `Compatible Ollama models: ${OLLAMA_TOOL_CAPABLE_MODELS.join(", ")}.`
    );
    this.name = "OllamaToolsNotSupportedError";
  }
}

export async function ollamaAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: toOllamaMessages(messages),
        tools: tools.map((t) => ({ type: "function", function: t })),
        stream: false,
      }),
    });
  } catch {
    throw new Error("Could not connect to Ollama. Make sure it is running: ollama serve");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 400 && text.toLowerCase().includes("tool")) {
      throw new OllamaToolsNotSupportedError(model);
    }
    throw new Error(`Ollama error (${res.status}): ${text || "unknown"}`);
  }

  const data = await res.json();
  const msg = data.message;

  if (msg?.tool_calls?.length) {
    const tc = msg.tool_calls[0];
    const args = tc.function?.arguments ?? {};
    const callId = `ollama-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { type: "tool_call", callId, tool: tc.function.name, args };
  }

  // If no tool_calls but model returned empty content, likely doesn't support tools
  if (!msg?.content && !msg?.tool_calls) {
    throw new OllamaToolsNotSupportedError(model);
  }

  return { type: "text", content: (msg.content as string ?? "").trim() };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/agent/ollama.ts && git commit -m "feat: Ollama agent adapter with tool-calling and capability detection"
```

---

## Task 5: Agent Loop

**Files:**
- Create: `lib/agent/loop.ts`
- Create: `lib/agent/loop.test.ts`

- [ ] **Step 1: Write failing test**

Create `lib/agent/loop.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { runAgentLoop } from "./loop";
import type { AgentEvent, ToolDefinition, InternalMessage } from "@/types";

const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo the input",
  parameters: { type: "object", properties: { text: { type: "string", description: "text" } }, required: ["text"] },
};

describe("runAgentLoop", () => {
  it("yields text event when provider returns text immediately", async () => {
    const mockStep = vi.fn().mockResolvedValue({ type: "text", content: "hello" });
    const events: AgentEvent[] = [];

    for await (const event of runAgentLoop({
      messages: [{ role: "user", content: "say hello" }],
      tools: [echoTool],
      workspaceRoot: "/tmp",
      providerStep: mockStep,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "text_delta" && e.delta === "hello")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("executes a tool call then gets text response", async () => {
    const mockStep = vi.fn()
      .mockResolvedValueOnce({ type: "tool_call", callId: "c1", tool: "echo", args: { text: "hi" } })
      .mockResolvedValueOnce({ type: "text", content: "done" });

    // Mock tool executor — returns the echoed text
    const mockExecuteTool = vi.fn().mockResolvedValue("hi");
    const events: AgentEvent[] = [];

    for await (const event of runAgentLoop({
      messages: [{ role: "user", content: "echo hi" }],
      tools: [echoTool],
      workspaceRoot: "/tmp",
      providerStep: mockStep,
      executeToolFn: mockExecuteTool,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "tool_call" && e.tool === "echo")).toBe(true);
    expect(events.some((e) => e.type === "tool_result" && e.output === "hi")).toBe(true);
    expect(events.some((e) => e.type === "done" && e.toolCallCount === 1)).toBe(true);
  });

  it("emits error event when provider throws OllamaToolsNotSupportedError-shaped error", async () => {
    const err = new Error('Model "phi3" does not support tool use. Compatible Ollama models: llama3.1');
    err.name = "OllamaToolsNotSupportedError";
    const mockStep = vi.fn().mockRejectedValue(err);
    const events: AgentEvent[] = [];

    for await (const event of runAgentLoop({
      messages: [{ role: "user", content: "hello" }],
      tools: [echoTool],
      workspaceRoot: "/tmp",
      providerStep: mockStep,
    })) {
      events.push(event);
    }

    expect(events.some((e) => e.type === "error" && e.code === "tools_not_supported")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test lib/agent/loop.test.ts
```

Expected: FAIL — `Cannot find module './loop'`

- [ ] **Step 3: Create lib/agent/loop.ts**

```ts
import type { AgentEvent, InternalMessage, ToolDefinition } from "@/types";
import { executeTool } from "./tools";
import type { ProviderStepResult } from "./groq";

const MAX_ITERATIONS = 20;

const AGENT_SYSTEM_PROMPT = `You are Marven Agent, an expert software engineer. You have tools to read, write, and run code in the user's workspace. Always inspect relevant files before making changes. Be precise and concise in your final reply.`;

interface LoopOptions {
  messages: InternalMessage[];
  tools: ToolDefinition[];
  workspaceRoot: string;
  providerStep: (
    messages: InternalMessage[],
    tools: ToolDefinition[],
  ) => Promise<ProviderStepResult>;
  executeToolFn?: typeof executeTool;
}

export async function* runAgentLoop(
  options: LoopOptions
): AsyncGenerator<AgentEvent> {
  const { tools, workspaceRoot, providerStep } = options;
  const exec = options.executeToolFn ?? executeTool;

  const history: InternalMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...options.messages,
  ];

  let toolCallCount = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let result: ProviderStepResult;
    try {
      result = await providerStep(history, tools);
    } catch (err) {
      const error = err as Error;
      if (error.name === "OllamaToolsNotSupportedError") {
        const msg = error.message;
        const suggestionsMatch = msg.match(/Compatible Ollama models: (.+)$/);
        const suggestions = suggestionsMatch
          ? suggestionsMatch[1].split(", ")
          : ["qwen2.5-coder", "llama3.1", "mistral-nemo"];
        yield {
          type: "error",
          code: "tools_not_supported",
          message: msg,
          suggestions,
        };
        return;
      }
      yield { type: "error", code: "provider_error", message: error.message };
      return;
    }

    if (result.type === "text") {
      yield { type: "text_delta", delta: result.content };
      yield { type: "done", toolCallCount };
      return;
    }

    // Tool call
    toolCallCount++;
    yield {
      type: "tool_call",
      callId: result.callId,
      tool: result.tool,
      args: result.args,
    };

    history.push({
      role: "assistant_tool_call",
      callId: result.callId,
      tool: result.tool,
      args: result.args,
    });

    let output: string;
    try {
      output = await exec(result.tool, result.args, workspaceRoot);
    } catch (err) {
      output = `Error executing tool: ${(err as Error).message}`;
    }

    const truncated = output.length > 4_000;
    const trimmed = truncated ? output.slice(0, 4_000) + "\n[truncated]" : output;

    yield {
      type: "tool_result",
      callId: result.callId,
      output: trimmed,
      truncated,
    };

    history.push({ role: "tool_result", callId: result.callId, content: trimmed });
  }

  yield {
    type: "error",
    code: "max_iterations",
    message: `Agent stopped after ${MAX_ITERATIONS} iterations.`,
  };
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/loop.ts lib/agent/loop.test.ts && git commit -m "feat: agent tool-use loop with SSE event generator"
```

---

## Task 6: SSE Streaming API Route

**Files:**
- Create: `app/api/agent/stream/route.ts`

This replaces `app/api/agent/route.ts`. The old route can stay (it won't be called by the new UI) or be deleted — delete it to keep things clean.

- [ ] **Step 1: Delete the old agent route**

```bash
rm "/Users/ahomsi/Development/Personal Projects/Marven/app/api/agent/route.ts"
```

- [ ] **Step 2: Create app/api/agent/stream/route.ts**

```ts
import { NextRequest } from "next/server";
import { runAgentLoop } from "@/lib/agent/loop";
import { groqAgentStep } from "@/lib/agent/groq";
import { ollamaAgentStep } from "@/lib/agent/ollama";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import type { AIProvider, InternalMessage, HistoryMessage } from "@/types";

interface StreamRequestBody {
  prompt?: string;
  history?: HistoryMessage[];
  model?: string;
  provider?: AIProvider;
  workspaceRoot?: string;
}

export async function POST(req: NextRequest) {
  let body: StreamRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? "";
  const workspaceRoot = body.workspaceRoot?.trim() ?? "";

  if (!prompt) {
    return new Response("prompt is required", { status: 400 });
  }
  if (!workspaceRoot) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `event: error\ndata: ${JSON.stringify({ code: "workspace_not_set", message: "No workspace folder open. Click 'Open Folder' to get started." })}\n\n`
        ));
        controller.close();
      },
    });
    return new Response(stream, { headers: sseHeaders() });
  }

  const provider = (body.provider ?? "groq") as AIProvider;
  const model = body.model ?? (provider === "groq" ? "llama-3.3-70b-versatile" : "qwen2.5-coder");

  const history: InternalMessage[] = (body.history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  history.push({ role: "user", content: prompt });

  const providerStep = provider === "groq"
    ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => groqAgentStep(msgs, tools, model)
    : (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => ollamaAgentStep(msgs, tools, model);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        ));
      };

      try {
        for await (const event of runAgentLoop({
          messages: history,
          tools: TOOL_DEFINITIONS,
          workspaceRoot,
          providerStep,
        })) {
          emit(event.type, event);
        }
      } catch (err) {
        emit("error", {
          code: "unexpected",
          message: (err as Error).message,
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Smoke test with curl** (requires `GROQ_API_KEY` in `.env.local` and `npm run dev` running)

In a separate terminal, start the dev server:
```bash
npm run dev
```

Then in another terminal:
```bash
curl -N -X POST http://localhost:3000/api/agent/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt":"list the files in the workspace","provider":"groq","model":"llama-3.3-70b-versatile","workspaceRoot":"/tmp"}'
```

Expected: SSE events streaming, ending with `event: done`.

- [ ] **Step 5: Commit**

```bash
git add app/api/agent/stream/route.ts && git commit -m "feat: SSE streaming agent route"
```

---

## Task 7: Workspace API — Add Folder Support

**Files:**
- Modify: `app/api/workspace/files/route.ts`

Add a `PATCH` handler that accepts `{ root: string }` to let the client tell the server which folder is active. Also serve the current root back on `GET`.

- [ ] **Step 1: Modify app/api/workspace/files/route.ts**

Replace the entire file:

```ts
import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

// Module-level workspace root — set by PATCH, read by GET/POST/PUT
let activeWorkspaceRoot: string | null = null;

function getRoot(): string {
  if (!activeWorkspaceRoot) throw new Error("No workspace folder open.");
  return activeWorkspaceRoot;
}

async function listRecursive(dir: string, base: string): Promise<{ path: string; name: string }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: { path: string; name: string }[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const rel = path.relative(base, path.join(dir, entry.name));
    if (entry.isDirectory()) {
      const nested = await listRecursive(path.join(dir, entry.name), base);
      results.push(...nested);
    } else {
      results.push({ path: rel, name: entry.name });
    }
  }
  return results;
}

export async function GET() {
  if (!activeWorkspaceRoot) {
    return NextResponse.json({ root: null, files: [] });
  }
  try {
    const files = await listRecursive(activeWorkspaceRoot, activeWorkspaceRoot);
    return NextResponse.json({ root: activeWorkspaceRoot, files });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load files.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const root = typeof body.root === "string" ? body.root.trim() : "";
    if (!root) return NextResponse.json({ error: "root is required" }, { status: 400 });

    const stat = await fs.stat(root).catch(() => null);
    if (!stat?.isDirectory()) {
      return NextResponse.json({ error: `"${root}" is not a valid directory` }, { status: 400 });
    }
    activeWorkspaceRoot = root;
    return NextResponse.json({ ok: true, root });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const targetPath = typeof body.path === "string" ? body.path : "";
    if (!targetPath.trim()) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const root = getRoot();
    const abs = path.resolve(root, targetPath);
    if (!abs.startsWith(root)) return NextResponse.json({ error: "Path outside workspace" }, { status: 400 });

    const content = await fs.readFile(abs, "utf-8");
    return NextResponse.json({ path: targetPath, content });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const targetPath = typeof body.path === "string" ? body.path : "";
    const content = typeof body.content === "string" ? body.content : "";
    if (!targetPath.trim()) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const root = getRoot();
    const abs = path.resolve(root, targetPath);
    if (!abs.startsWith(root)) return NextResponse.json({ error: "Path outside workspace" }, { status: 400 });

    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf-8");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not write file.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/workspace/files/route.ts && git commit -m "feat: workspace API supports dynamic root via PATCH"
```

---

## Task 8: useAgentStream Hook

**Files:**
- Create: `hooks/useAgentStream.ts`

- [ ] **Step 1: Create hooks/useAgentStream.ts**

```ts
import { useState, useRef, useCallback } from "react";
import type { AgentEvent, ToolCallState, AIProvider } from "@/types";

interface AgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallState[];
}

interface UseAgentStreamOptions {
  provider: AIProvider;
  model: string;
  workspaceRoot: string | null;
}

export function useAgentStream({ provider, model, workspaceRoot }: UseAgentStreamOptions) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addMessage = (msg: AgentMessage) =>
    setMessages((prev) => [...prev, msg]);

  const updateLastAssistant = (updater: (msg: AgentMessage) => AgentMessage) =>
    setMessages((prev) => {
      const next = [...prev];
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === "assistant") {
          next[i] = updater(next[i]);
          break;
        }
      }
      return next;
    });

  const send = useCallback(async (prompt: string) => {
    if (!prompt.trim() || isRunning) return;
    setError(null);
    setIsRunning(true);

    const userMsg: AgentMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: prompt,
    };
    addMessage(userMsg);

    const assistantMsg: AgentMessage = {
      id: `a-${Date.now()}`,
      role: "assistant",
      content: "",
      toolCalls: [],
    };
    addMessage(assistantMsg);

    const history = messages
      .concat(userMsg)
      .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
      .map((m) => ({ role: m.role, content: m.content }));

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch("/api/agent/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, history, provider, model, workspaceRoot }),
        signal: abort.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.trim().split("\n");
          let eventType = "";
          let dataLine = "";
          for (const line of lines) {
            if (line.startsWith("event: ")) eventType = line.slice(7);
            if (line.startsWith("data: ")) dataLine = line.slice(6);
          }
          if (!eventType || !dataLine) continue;

          let event: AgentEvent;
          try { event = JSON.parse(dataLine); } catch { continue; }

          if (event.type === "tool_call") {
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: [
                ...(msg.toolCalls ?? []),
                {
                  callId: event.callId!,
                  tool: event.tool!,
                  args: event.args ?? {},
                  status: "running",
                },
              ],
            }));
          }

          if (event.type === "tool_result") {
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls ?? []).map((tc) =>
                tc.callId === event.callId
                  ? { ...tc, status: "done", output: event.output }
                  : tc
              ),
            }));
          }

          if (event.type === "text_delta") {
            updateLastAssistant((msg) => ({
              ...msg,
              content: msg.content + (event.delta ?? ""),
            }));
          }

          if (event.type === "error") {
            setError(event.message ?? "Agent error");
            updateLastAssistant((msg) => ({
              ...msg,
              toolCalls: (msg.toolCalls ?? []).map((tc) =>
                tc.status === "running" ? { ...tc, status: "error" } : tc
              ),
            }));
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, messages, provider, model, workspaceRoot]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return { messages, isRunning, error, send, stop, clearMessages };
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add hooks/useAgentStream.ts && git commit -m "feat: useAgentStream hook for SSE client"
```

---

## Task 9: WorkspaceBar Component

**Files:**
- Create: `app/components/marven/WorkspaceBar.tsx`

Theme: Obsidian + Sand. Background `#0a0a0a`, border `#1a1a1a`, accent `#d19a66`.

- [ ] **Step 1: Create app/components/marven/WorkspaceBar.tsx**

```tsx
"use client";

interface WorkspaceBarProps {
  workspaceRoot: string | null;
  provider: string;
  model: string;
  onOpenFolder: () => void;
}

export function WorkspaceBar({ workspaceRoot, provider, model, onOpenFolder }: WorkspaceBarProps) {
  const folderName = workspaceRoot?.split("/").filter(Boolean).pop() ?? null;

  return (
    <div className="flex flex-col gap-2 border-b border-[#1a1a1a] bg-[#0a0a0a] px-3 py-3">
      <button
        type="button"
        onClick={onOpenFolder}
        className="flex w-full items-center gap-2 rounded-md border border-[#1a1a1a] bg-[#111] px-3 py-2 text-left transition-colors hover:border-[#2a2a2a]"
      >
        <svg className="h-3.5 w-3.5 shrink-0 text-[#d19a66]" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v8.25" />
        </svg>
        {folderName ? (
          <span className="truncate text-[11px] text-[#aaa]">{folderName}</span>
        ) : (
          <span className="text-[11px] text-[#444]">Open Folder...</span>
        )}
        {workspaceRoot && (
          <span className="ml-auto shrink-0 text-[9px] text-[#333]">change</span>
        )}
      </button>

      <div className="flex items-center gap-2">
        <span className="rounded border border-[#1a1a1a] bg-[#111] px-2 py-1 text-[9px] text-[#444] uppercase tracking-wider">
          {provider}
        </span>
        <span className="truncate text-[10px] text-[#333]">{model}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/WorkspaceBar.tsx && git commit -m "feat: WorkspaceBar component"
```

---

## Task 10: ToolCallCard Component

**Files:**
- Create: `app/components/marven/ToolCallCard.tsx`

- [ ] **Step 1: Create app/components/marven/ToolCallCard.tsx**

```tsx
"use client";

import type { ToolCallState } from "@/types";

const TOOL_ICONS: Record<string, string> = {
  list_files: "📂",
  read_file: "📄",
  write_file: "✏️",
  run_command: "⚡",
  search_files: "🔍",
};

interface ToolCallCardProps {
  toolCall: ToolCallState;
}

function ArgSummary({ tool, args }: { tool: string; args: Record<string, unknown> }) {
  if (tool === "read_file" || tool === "write_file") {
    return <span className="text-[#555]">{String(args.path ?? "")}</span>;
  }
  if (tool === "run_command") {
    return <span className="text-[#555] font-mono">{String(args.command ?? "").slice(0, 40)}</span>;
  }
  if (tool === "search_files") {
    return <span className="text-[#555]">"{String(args.query ?? "")}"</span>;
  }
  if (tool === "list_files") {
    return <span className="text-[#555]">{String(args.path ?? ".")}</span>;
  }
  return null;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const { tool, args, status, output } = toolCall;
  const icon = TOOL_ICONS[tool] ?? "🔧";

  const isActive = status === "running";
  const isDone = status === "done";
  const isError = status === "error";

  return (
    <div
      className={`overflow-hidden rounded-md border transition-colors ${
        isActive
          ? "border-[#2a2a1a] bg-[rgba(209,154,102,0.04)]"
          : "border-[#1a1a1a] bg-[#0d0d0d]"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="text-[11px]">{icon}</span>
        <span
          className={`font-mono text-[11px] ${
            isActive ? "text-[#d19a66]" : isDone ? "text-[#666]" : "text-[#444]"
          }`}
        >
          {tool}
        </span>
        <ArgSummary tool={tool} args={args} />
        <div className="ml-auto flex items-center gap-1.5">
          {isActive && (
            <span className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block h-1 w-1 rounded-full bg-[#d19a66]"
                  style={{ opacity: 1 - i * 0.3 }}
                />
              ))}
            </span>
          )}
          {isDone && <span className="text-[10px] text-[#444]">✓</span>}
          {isError && <span className="text-[10px] text-red-800">✗</span>}
        </div>
      </div>

      {output && (
        <div className="border-t border-[#1a1a1a] px-3 py-1.5">
          <p className="font-mono text-[10px] text-[#333] leading-5 whitespace-pre-wrap break-all line-clamp-3">
            {output}
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/ToolCallCard.tsx && git commit -m "feat: ToolCallCard component (pending/running/done)"
```

---

## Task 11: AgentPanel Component

**Files:**
- Create: `app/components/marven/AgentPanel.tsx`

- [ ] **Step 1: Create app/components/marven/AgentPanel.tsx**

```tsx
"use client";

import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ToolCallCard } from "./ToolCallCard";

import type { AgentMessage } from "@/types";

interface AgentPanelProps {
  messages: AgentMessage[];
  input: string;
  isRunning: boolean;
  error: string | null;
  onInputChange: (value: string) => void;
  onSend: () => void;
}

export function AgentPanel({
  messages,
  input,
  isRunning,
  error,
  onInputChange,
  onSend,
}: AgentPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isRunning]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Message stream */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isRunning && (
          <p className="text-[12px] text-[#2a2a2a]">
            Open a folder and describe what you want to build or change.
          </p>
        )}

        <div className="flex flex-col gap-4">
          {messages.map((msg) => (
            <div key={msg.id}>
              {msg.role === "user" ? (
                <div className="rounded-md bg-[#111] border border-[#1a1a1a] px-3 py-2 text-[12px] text-[#888]">
                  {msg.content}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {/* Tool calls */}
                  {(msg.toolCalls ?? []).map((tc) => (
                    <ToolCallCard key={tc.callId} toolCall={tc} />
                  ))}
                  {/* Assistant text */}
                  {msg.content && (
                    <div className="prose prose-invert prose-sm max-w-none text-[12px] text-[#888] [&_code]:bg-[#111] [&_code]:text-[#d19a66] [&_pre]:bg-[#0d0d0d] [&_pre]:border [&_pre]:border-[#1a1a1a]">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {isRunning && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex items-center gap-2 text-[11px] text-[#2a2a2a]">
              <span>Agent running</span>
              {[0, 1, 2].map((i) => (
                <span key={i} className="inline-block h-1 w-1 rounded-full bg-[#2a2a2a]" />
              ))}
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-900/30 bg-red-950/20 px-3 py-2 text-[11px] text-red-700">
              {error}
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-[#1a1a1a] bg-[#0a0a0a] px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isRunning}
            rows={1}
            placeholder="Describe what to build or change..."
            className="min-h-[36px] flex-1 resize-none rounded-md border border-[#1a1a1a] bg-[#0d0d0d] px-3 py-2 text-[12px] text-[#aaa] placeholder-[#2a2a2a] outline-none transition-colors focus:border-[#2a2a2a] disabled:opacity-40"
            style={{ maxHeight: 120, overflowY: "auto" }}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={!input.trim() || isRunning}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-[#1a1a1a] bg-[#111] text-[#d19a66] transition-colors hover:border-[#d19a66]/30 disabled:opacity-30"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/AgentPanel.tsx && git commit -m "feat: AgentPanel with live tool call stream"
```

---

## Task 12: EditorPanel Component

**Files:**
- Create: `app/components/marven/EditorPanel.tsx`

- [ ] **Step 1: Create app/components/marven/EditorPanel.tsx**

```tsx
"use client";

import { useState } from "react";
import type { WorkspaceFile } from "@/types";

interface EditorPanelProps {
  files: WorkspaceFile[];
  workspaceRoot: string | null;
  selectedFilePath: string | null;
  fileContent: string;
  isFileLoading: boolean;
  isFileDirty: boolean;
  terminalOutput: string;
  onSelectFile: (path: string) => void;
  onFileContentChange: (value: string) => void;
  onSaveFile: () => void;
  onRefreshFiles: () => void;
}

export function EditorPanel({
  files,
  workspaceRoot,
  selectedFilePath,
  fileContent,
  isFileLoading,
  isFileDirty,
  terminalOutput,
  onSelectFile,
  onFileContentChange,
  onSaveFile,
  onRefreshFiles,
}: EditorPanelProps) {
  const [showTerminal, setShowTerminal] = useState(true);
  const activeFileName = selectedFilePath?.split("/").pop() ?? null;
  const projectName = workspaceRoot?.split("/").filter(Boolean).pop() ?? "workspace";

  return (
    <div className="flex h-full min-w-0 flex-col bg-[#0d0d0d]">
      {/* File explorer + editor split */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* File explorer */}
        <div className="flex w-[220px] min-w-[220px] flex-col border-r border-[#1a1a1a] bg-[#0a0a0a]">
          <div className="flex items-center justify-between border-b border-[#1a1a1a] px-3 py-2">
            <span className="text-[9px] uppercase tracking-[0.2em] text-[#2a2a2a]">{projectName}</span>
            <button
              type="button"
              onClick={onRefreshFiles}
              className="text-[9px] text-[#333] hover:text-[#555] transition-colors"
            >
              ↻
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {files.length === 0 && (
              <p className="px-3 py-2 text-[10px] text-[#222]">No files</p>
            )}
            {files.map((file) => {
              const isActive = file.path === selectedFilePath;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => onSelectFile(file.path)}
                  title={file.path}
                  className={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left transition-colors ${
                    isActive
                      ? "border-[#d19a66] bg-[rgba(209,154,102,0.05)] text-[#d19a66]"
                      : "border-transparent text-[#444] hover:bg-[#111] hover:text-[#666]"
                  }`}
                >
                  <span className="truncate text-[11px] font-mono">{file.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Tab bar */}
          <div className="flex items-stretch border-b border-[#1a1a1a] bg-[#0a0a0a]">
            {activeFileName ? (
              <div className="flex items-center gap-2 border-r border-[#1a1a1a] bg-[#0d0d0d] px-4 py-2 text-[11px] font-mono text-[#666]">
                {activeFileName}
                {isFileDirty && <span className="text-[#d19a66] text-[10px]">●</span>}
              </div>
            ) : (
              <div className="px-4 py-2 text-[11px] text-[#222]">No file open</div>
            )}
            <div className="ml-auto flex items-center gap-2 px-3">
              {isFileDirty && (
                <button
                  type="button"
                  onClick={onSaveFile}
                  className="rounded border border-[#1a1a1a] px-2 py-1 text-[10px] text-[#444] transition-colors hover:border-[#2a2a2a] hover:text-[#666]"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          {/* Code textarea */}
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="w-10 shrink-0 select-none border-r border-[#141414] bg-[#0a0a0a] py-3 text-right font-mono text-[11px] leading-7 text-[#222] pr-2">
              {fileContent.split("\n").slice(0, 50).map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              value={isFileLoading ? "Loading..." : fileContent}
              onChange={(e) => onFileContentChange(e.target.value)}
              disabled={!selectedFilePath || isFileLoading}
              spellCheck={false}
              className="agent-editor h-full min-h-full w-full resize-none border-0 bg-[#0d0d0d] px-4 py-3 font-mono text-[12px] leading-7 text-[#888] outline-none disabled:opacity-40"
            />
          </div>
        </div>
      </div>

      {/* Terminal */}
      <div className={`border-t border-[#1a1a1a] bg-[#080808] ${showTerminal ? "h-[120px]" : "h-7"} flex flex-col shrink-0 transition-all`}>
        <div
          className="flex h-7 cursor-pointer items-center gap-3 border-b border-[#141414] px-3"
          onClick={() => setShowTerminal((v) => !v)}
        >
          <span className="text-[9px] uppercase tracking-[0.2em] text-[#2a2a2a]">Terminal</span>
          <span className="text-[9px] text-[#1a1a1a]">{showTerminal ? "▾" : "▸"}</span>
        </div>
        {showTerminal && (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-6 text-[#444] whitespace-pre-wrap">
            {terminalOutput || <span className="text-[#1a1a1a]">No output yet.</span>}
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between border-t border-[#1a1a1a] bg-[#0a0a0a] px-3 py-1 font-mono text-[9px] text-[#222]">
        <span>{projectName}</span>
        <div className="flex gap-4">
          <span>{activeFileName ?? "—"}</span>
          <span className="text-[#d19a66]/30">TypeScript</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/EditorPanel.tsx && git commit -m "feat: EditorPanel with file explorer, editor, and terminal"
```

---

## Task 13: AgentWorkspace Rewrite

**Files:**
- Rewrite: `app/components/marven/AgentWorkspace.tsx`

This replaces the current implementation entirely.

- [ ] **Step 1: Replace app/components/marven/AgentWorkspace.tsx**

```tsx
"use client";

import type { WorkspaceFile } from "@/types";
import type { VoiceState } from "@/hooks/useVoice";
import { WorkspaceBar } from "./WorkspaceBar";
import { AgentPanel } from "./AgentPanel";
import { EditorPanel } from "./EditorPanel";

import type { AgentMessage } from "@/types";

interface AgentWorkspaceProps {
  messages: AgentMessage[];
  input: string;
  isRunning: boolean;
  error: string | null;
  provider: string;
  model: string;
  workspaceRoot: string | null;
  files: WorkspaceFile[];
  selectedFilePath: string | null;
  fileContent: string;
  isFileLoading: boolean;
  isFileDirty: boolean;
  terminalOutput: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onOpenFolder: () => void;
  onSelectFile: (path: string) => void;
  onFileContentChange: (value: string) => void;
  onSaveFile: () => void;
  onRefreshFiles: () => void;
}

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
  onOpenFolder,
  onSelectFile,
  onFileContentChange,
  onSaveFile,
  onRefreshFiles,
}: AgentWorkspaceProps) {
  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-[#0a0a0a]">
      {/* Left — Agent panel */}
      <div className="flex w-[320px] min-w-[320px] flex-col border-r border-[#1a1a1a]">
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
          />
        </div>
      </div>

      {/* Right — Editor panel */}
      <div className="min-h-0 min-w-0 flex-1">
        <EditorPanel
          files={files}
          workspaceRoot={workspaceRoot}
          selectedFilePath={selectedFilePath}
          fileContent={fileContent}
          isFileLoading={isFileLoading}
          isFileDirty={isFileDirty}
          terminalOutput={terminalOutput}
          onSelectFile={onSelectFile}
          onFileContentChange={onFileContentChange}
          onSaveFile={onSaveFile}
          onRefreshFiles={onRefreshFiles}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/marven/AgentWorkspace.tsx && git commit -m "feat: AgentWorkspace rewrite — Obsidian+Sand layout B"
```

---

## Task 14: Wire page.tsx

**Files:**
- Modify: `app/page.tsx`

Replace the agent-mode state and handlers in `page.tsx` to use `useAgentStream` and the new workspace PATCH endpoint. Chat mode code stays untouched.

- [ ] **Step 1: Add useAgentStream import and state to page.tsx**

In `app/page.tsx`, add the import at the top (after existing imports):

```ts
import { useAgentStream } from "@/hooks/useAgentStream";
```

- [ ] **Step 2: Replace agent workspace state in page.tsx**

Find the `// ─── Agent workspace ────` block (lines ~166–171) and replace the individual state variables with the hook:

```ts
// ─── Agent workspace ────────────────────────────────────────────────────────
const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
const [selectedAgentFilePath, setSelectedAgentFilePath] = useState<string | null>(null);
const [selectedAgentFileContent, setSelectedAgentFileContent] = useState("");
const [isAgentFileLoading, setIsAgentFileLoading] = useState(false);
const [isAgentFileDirty, setIsAgentFileDirty] = useState(false);
const [agentTerminalOutput, setAgentTerminalOutput] = useState("");
const [agentInput, setAgentInput] = useState("");

const agentStream = useAgentStream({
  provider,
  model: selectedModel,
  workspaceRoot,
});
```

- [ ] **Step 3: Replace workspace loading functions**

Replace `loadWorkspaceFiles` and `loadAgentFile` / `saveAgentFile` with:

```ts
async function openWorkspaceFolder(folderPath: string) {
  const res = await fetch("/api/workspace/files", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root: folderPath }),
  });
  if (res.ok) {
    setWorkspaceRoot(folderPath);
    await loadWorkspaceFiles();
  }
}

async function loadWorkspaceFiles() {
  const res = await fetch("/api/workspace/files");
  const data = await res.json();
  setWorkspaceFiles(data.files ?? []);
}

async function loadAgentFile(path: string) {
  setIsAgentFileLoading(true);
  try {
    const res = await fetch("/api/workspace/files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await res.json();
    setSelectedAgentFileContent(data.content ?? "");
    setIsAgentFileDirty(false);
  } finally {
    setIsAgentFileLoading(false);
  }
}

async function saveAgentFile() {
  if (!selectedAgentFilePath) return;
  await fetch("/api/workspace/files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: selectedAgentFilePath, content: selectedAgentFileContent }),
  });
  setIsAgentFileDirty(false);
}

function handleOpenFolder() {
  // Electron: use dialog; web: prompt for path
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electron = (window as any).marvenElectron;
  if (electron?.openFolderDialog) {
    electron.openFolderDialog().then((folderPath: string | null) => {
      if (folderPath) openWorkspaceFolder(folderPath);
    });
  } else {
    const folderPath = window.prompt("Enter the full folder path:");
    if (folderPath) openWorkspaceFolder(folderPath);
  }
}
```

- [ ] **Step 4: Update the AgentWorkspace usage in the JSX**

Find where `<AgentWorkspace>` (or `<ChatLayout>` with agent mode) is rendered and update its props to use the new hook and state. In the `<ChatLayout>` JSX, update the agent-related props:

```tsx
// Replace old agent props:
agentFiles={workspaceFiles}
workspaceRoot={workspaceRoot}
selectedAgentFilePath={selectedAgentFilePath}
selectedAgentFileContent={selectedAgentFileContent}
isAgentFileLoading={isAgentFileLoading}
isAgentFileDirty={isAgentFileDirty}
// Add new props consumed by AgentWorkspace:
agentMessages={agentStream.messages}
agentInput={agentInput}
isAgentRunning={agentStream.isRunning}
agentError={agentStream.error}
agentTerminalOutput={agentTerminalOutput}
onAgentInputChange={setAgentInput}
onAgentSend={() => { agentStream.send(agentInput); setAgentInput(""); }}
onOpenFolder={handleOpenFolder}
```

- [ ] **Step 5: Update ChatLayout props interface and AgentWorkspace call**

In `app/components/marven/ChatLayout.tsx`:

**Replace the `AgentWorkspace`-related props in `ChatLayoutProps` interface** (remove old ones, add new ones):

```ts
// REMOVE these from ChatLayoutProps:
//   agentFiles, selectedAgentFilePath, selectedAgentFileContent,
//   isAgentFileLoading, isAgentFileDirty,
//   onSelectAgentFile, onAgentFileContentChange, onSaveAgentFile, onRefreshAgentFiles

// ADD these to ChatLayoutProps:
agentMessages: import("@/types").AgentMessage[];
agentInput: string;
isAgentRunning: boolean;
agentError: string | null;
agentTerminalOutput: string;
agentFiles: import("@/types").WorkspaceFile[];
workspaceRoot: string | null;
onAgentInputChange: (v: string) => void;
onAgentSend: () => void;
onOpenFolder: () => void;
onSelectAgentFile: (path: string) => void;
onAgentFileContentChange: (value: string) => void;
onSaveAgentFile: () => void;
onRefreshAgentFiles: () => void;
```

**Replace the `<AgentWorkspace>` call** (around line 337) with:

```tsx
<AgentWorkspace
  messages={agentMessages}
  input={agentInput}
  isRunning={isAgentRunning}
  error={agentError}
  provider={provider}
  model={selectedModel}
  workspaceRoot={workspaceRoot}
  files={agentFiles}
  selectedFilePath={selectedAgentFilePath ?? null}
  fileContent={selectedAgentFileContent ?? ""}
  isFileLoading={isAgentFileLoading ?? false}
  isFileDirty={isAgentFileDirty ?? false}
  terminalOutput={agentTerminalOutput}
  onInputChange={onAgentInputChange}
  onSend={onAgentSend}
  onOpenFolder={onOpenFolder}
  onSelectFile={onSelectAgentFile}
  onFileContentChange={onAgentFileContentChange}
  onSaveFile={onSaveAgentFile}
  onRefreshFiles={onRefreshAgentFiles}
/>
```

Also remove unused `isLoading`, `isVoiceSupported`, `voiceState`, `onVoiceClick`, `onSlashCommand` from the `AgentWorkspace` call — the new `AgentWorkspace` doesn't need them.

- [ ] **Step 6: Verify TypeScript and run dev server**

```bash
npx tsc --noEmit
npm run dev
```

Open http://localhost:3000. Agent mode should now show the new Obsidian+Sand layout. Chat mode should be unchanged.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/components/marven/ChatLayout.tsx && git commit -m "feat: wire useAgentStream and new AgentWorkspace into page"
```

---

## Task 15: Final Smoke Test & Cleanup

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test — Agent mode**

1. Start dev server: `npm run dev`
2. Open http://localhost:3000
3. Switch to Agent mode
4. Click "Open Folder" — enter any local folder path (e.g. `/tmp`)
5. Type: "list the files in this folder"
6. Watch: `list_files` tool call card appears → turns to done → assistant replies
7. Type: "create a hello.txt file with 'hello world'"
8. Watch: `write_file` card appears → done → file visible in explorer

- [ ] **Step 4: Manual smoke test — Chat mode**

1. Switch to Chat mode
2. Send "what time is it?" — should respond with time (no tools, no change)
3. Confirm voice, weather, slash commands still work

- [ ] **Step 5: Add .gitignore entry for brainstorm artifacts**

```bash
echo ".superpowers/" >> .gitignore
git add .gitignore && git commit -m "chore: ignore superpowers brainstorm dir"
```

- [ ] **Step 6: Final commit**

```bash
git add -A && git commit -m "feat: Marven agent refactor complete — tool-use loop, SSE streaming, Obsidian+Sand UI"
```
