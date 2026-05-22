# Adaptive Agent Lite Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Marven's agent work reliably with weak local models (7B–13B) by auto-detecting simple tasks and routing them through a reduced tool set, shorter system prompt, a stall-recovery retry, and context pruning.

**Architecture:** A new `classifyTask` heuristic detects "simple" tasks (style/rename tweaks, typo fixes) vs "standard". The route selects 4 tools + a 6-rule prompt for simple tasks, or all 13 tools + the full prompt for standard. The loop gains two new behaviours: a one-shot recovery prompt when the model outputs text mid-task, and truncation of old tool results when the context token estimate exceeds 3 000. A "Lite agent mode" settings toggle lets users override the auto-detection.

**Tech Stack:** TypeScript, Next.js App Router API routes, Vitest, React, Electron (schema-less JSON settings store)

**Spec:** `docs/superpowers/specs/2026-05-21-adaptive-agent-lite-mode-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `lib/agent/taskClassifier.ts` | **Create** | `classifyTask(prompt): AgentTier` heuristic |
| `lib/agent/taskClassifier.test.ts` | **Create** | Unit tests for classifier |
| `lib/agent/systemPrompts.ts` | **Create** | `makeLiteSystemPrompt` + `makeFullSystemPrompt` (extracted from loop.ts) |
| `lib/agent/systemPrompts.test.ts` | **Create** | Smoke tests: workspaceRoot present, memory prepended, lite < full |
| `lib/agent/loop.ts` | **Modify** | Add `systemPrompt?` param, retry-on-stall, context pruning |
| `lib/agent/loop.test.ts` | **Modify** | Tests for retry and pruning |
| `app/api/agent/stream/route.ts` | **Modify** | Classify task, select tier, pick tools + prompt, accept `liteAgentMode` |
| `hooks/useAgentStream.ts` | **Modify** | Accept `liteAgentMode?` option, include in fetch body |
| `app/components/marven/SettingsModal.tsx` | **Modify** | "Lite agent mode" toggle in General → Agent section |
| `app/page.tsx` | **Modify** | Read `liteAgentMode` from electron, pass to `useAgentStream` |
| `electron/main.js` | **No code change** | Store is schema-less JSON; `liteAgentMode` is persisted automatically via `saveSettings` |

---

## Task 1: Task Classifier

**Files:**
- Create: `lib/agent/taskClassifier.ts`
- Create: `lib/agent/taskClassifier.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/agent/taskClassifier.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyTask } from "./taskClassifier";

describe("classifyTask", () => {
  it("classifies 'change the button color to red' as simple", () => {
    expect(classifyTask("change the button color to red")).toBe("simple");
  });

  it("classifies 'build a new authentication feature' as standard", () => {
    expect(classifyTask("build a new authentication feature")).toBe("standard");
  });

  it("classifies 'fix the typo in the header' as simple", () => {
    expect(classifyTask("fix the typo in the header")).toBe("simple");
  });

  it("classifies 'install the react-router package' as standard", () => {
    expect(classifyTask("install the react-router package")).toBe("standard");
  });

  it("classifies prompt over 120 words as standard", () => {
    // 121 words: "change " repeated 121 times each word counted
    const long = Array.from({ length: 121 }, () => "change").join(" ");
    expect(classifyTask(long)).toBe("standard");
  });

  it("classifies prompt with no signal words as standard", () => {
    expect(classifyTask("make it work properly")).toBe("standard");
  });

  it("classifies 'add a border to the button' as standard (add is a complexity word)", () => {
    expect(classifyTask("add a border to the button")).toBe("standard");
  });

  it("is case-insensitive", () => {
    expect(classifyTask("CHANGE the Color")).toBe("simple");
  });

  it("classifies 'update the margin' as simple", () => {
    expect(classifyTask("update the margin")).toBe("simple");
  });

  it("classifies 'refactor the color utility' as standard (refactor is a complexity word)", () => {
    expect(classifyTask("refactor the color utility")).toBe("standard");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
npx vitest run lib/agent/taskClassifier.test.ts 2>&1 | tail -10
```

Expected: error about `taskClassifier` not found.

- [ ] **Step 3: Implement taskClassifier.ts**

Create `lib/agent/taskClassifier.ts`:

```ts
export type AgentTier = "simple" | "standard";

const SIGNAL_WORDS = [
  "change", "color", "colour", "rename", "fix", "replace", "update", "typo",
  "style", "font", "size", "margin", "padding", "border", "background", "text",
];

const COMPLEXITY_WORDS = [
  "create", "build", "install", "feature", "refactor", "add", "connect",
  "all files", "multiple", "across",
];

/**
 * Classifies a user prompt as "simple" (single-file style tweak) or
 * "standard" (anything requiring more reasoning or multiple files).
 *
 * A prompt is "simple" when ALL of:
 *  - word count ≤ 120
 *  - contains at least one SIGNAL word
 *  - contains no COMPLEXITY word
 */
export function classifyTask(prompt: string): AgentTier {
  const lower = prompt.toLowerCase();
  const wordCount = lower.trim().split(/\s+/).length;

  if (wordCount > 120) return "standard";

  const hasSignal = SIGNAL_WORDS.some((w) => lower.includes(w));
  if (!hasSignal) return "standard";

  const hasComplexity = COMPLEXITY_WORDS.some((w) => lower.includes(w));
  if (hasComplexity) return "standard";

  return "simple";
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/agent/taskClassifier.test.ts 2>&1 | tail -10
```

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/taskClassifier.ts lib/agent/taskClassifier.test.ts
git commit -m "feat(agent): add task classifier (simple vs standard tier)"
```

---

## Task 2: System Prompts Module

**Files:**
- Create: `lib/agent/systemPrompts.ts`
- Create: `lib/agent/systemPrompts.test.ts`

- [ ] **Step 1: Write failing tests**

Create `lib/agent/systemPrompts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeLiteSystemPrompt, makeFullSystemPrompt } from "./systemPrompts";

describe("makeLiteSystemPrompt", () => {
  it("includes workspaceRoot", () => {
    const p = makeLiteSystemPrompt("/my/workspace");
    expect(p).toContain("/my/workspace");
  });

  it("prepends memory block when provided", () => {
    const p = makeLiteSystemPrompt("/ws", "remember this");
    expect(p.startsWith("### Memory")).toBe(true);
    expect(p).toContain("remember this");
  });

  it("omits memory block when not provided", () => {
    const p = makeLiteSystemPrompt("/ws");
    expect(p).not.toContain("### Memory");
  });

  it("omits memory block when memory is empty string", () => {
    const p = makeLiteSystemPrompt("/ws", "");
    expect(p).not.toContain("### Memory");
  });
});

describe("makeFullSystemPrompt", () => {
  it("includes workspaceRoot", () => {
    const p = makeFullSystemPrompt("/my/workspace");
    expect(p).toContain("/my/workspace");
  });

  it("prepends memory block when provided", () => {
    const p = makeFullSystemPrompt("/ws", "remember this");
    expect(p.startsWith("### Memory")).toBe(true);
    expect(p).toContain("remember this");
  });

  it("omits memory block when not provided", () => {
    const p = makeFullSystemPrompt("/ws");
    expect(p).not.toContain("### Memory");
  });
});

describe("prompt length comparison", () => {
  it("lite prompt is shorter than full prompt for same inputs", () => {
    const lite = makeLiteSystemPrompt("/ws");
    const full = makeFullSystemPrompt("/ws");
    expect(lite.length).toBeLessThan(full.length);
  });

  it("lite prompt with memory is shorter than full prompt with memory", () => {
    const mem = "remember the user prefers TypeScript";
    const lite = makeLiteSystemPrompt("/ws", mem);
    const full = makeFullSystemPrompt("/ws", mem);
    expect(lite.length).toBeLessThan(full.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run lib/agent/systemPrompts.test.ts 2>&1 | tail -10
```

Expected: error about `systemPrompts` not found.

- [ ] **Step 3: Implement systemPrompts.ts**

Create `lib/agent/systemPrompts.ts`. `makeFullSystemPrompt` is the current `makeSystemPrompt` body from `lib/agent/loop.ts` moved verbatim:

```ts
/**
 * Short prompt for simple single-file tasks (style tweaks, typo fixes).
 * Used by the "lite" tier to reduce noise for weak local models.
 */
export function makeLiteSystemPrompt(workspaceRoot: string, memory?: string): string {
  let base = `You are Marven Agent. The workspace is at: ${workspaceRoot}

Your job: make exactly the change the user asked for. Nothing more.

RULES:
- Always call list_files or search_files first to find the right file.
- Call read_file before editing any file.
- Call write_file to save your change. Put the FULL file content in "content".
- Make ONE change at a time. Call one tool per response.
- Do NOT describe what you are doing — just call the tool.
- When done, say "Done." in one sentence.`;

  if (memory && memory.trim()) {
    base = `### Memory\n${memory.trim()}\n\n---\n\n` + base;
  }
  return base;
}

/**
 * Full prompt for standard tasks. This is the current makeSystemPrompt content
 * from loop.ts, moved here verbatim so the loop can receive it externally.
 */
export function makeFullSystemPrompt(workspaceRoot: string, memory?: string): string {
  let base = `You are Marven Agent, an expert software engineer. The user's workspace is at: ${workspaceRoot}

CRITICAL — TOOL CALLING:
You MUST invoke the appropriate tool to actually do work. NEVER describe a tool call as text — invoke the tool directly using the function-calling protocol.

Failure patterns to AVOID:
- Writing "I would call write_file with content..." instead of CALLING write_file
- Returning the file contents in a markdown code block (e.g., \`\`\`html ... \`\`\`) instead of calling write_file with that content as the "content" argument
- Saying "Here's the component:" followed by code, when the user asked you to add/create/build it
- Saying "Run: npm start" instead of calling run_command({ command: "npm start" })
- Listing a tool name like "list_files()" as text in your reply

If the user asks you to create, add, build, write, modify, or fix a file: CALL write_file. The code goes inside the tool's "content" argument — not in your message text.
If the user asks you to run, start, open, install, build (as a verb): CALL run_command.
If the user asks about the project or its files: CALL list_files / read_file first.

IMPORTANT RULES:
- When the user mentions their project, files, or asks you to analyze/modify something, ALWAYS call list_files first to discover what exists — never ask the user for a file path you can find yourself.
- Use read_file to inspect files before modifying them.
- Use apply_patch for SMALL/MEDIUM EDITS to existing files. Each edit is a search/replace pair — only send the snippets that change, not the whole file. Prefer this over write_file whenever you're modifying a file that already exists; it's faster, cheaper, and less risky than rewriting the entire file. CRITICAL apply_patch rule: every 'search' string MUST be unique within the file. If the exact text appears more than once (e.g. "color: #fff;" in a CSS file), expand the search to include 1-2 surrounding lines to make it unique — e.g. "header {\n    background-color: #333;\n    color: #fff;". Never retry with the same ambiguous search string after a uniqueness error; always add context. For very small files (under ~60 lines) that you have already read in full, it is acceptable to use write_file to replace the entire content.
- Use write_file to create NEW files or to fully replace a file's contents. The full file contents go in the "content" argument. Do NOT also echo the code in your reply.
- Use run_command to install dependencies, run builds, start servers, etc. — invoke it, do not narrate it.
- When a run_command output contains "Live URL:" or "SERVER READY", you MUST surface that exact URL back to the user as a clickable link (e.g., "Your site is live at http://localhost:3000"). Never tell the user "the port may vary" — the URL is in the tool output.
- Use web_search to look up documentation, APIs, or current information.
- Use fetch_url to read a specific webpage, README, or raw file from the internet.
- Use remember to save important facts about the user's project or preferences for future sessions.
- After your tools complete, be precise and concise in your final reply. Do not repeat what the tools already wrote.`;

  if (memory && memory.trim()) {
    base = `### Memory\n${memory.trim()}\n\n---\n\n` + base;
  }
  return base;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run lib/agent/systemPrompts.test.ts 2>&1 | tail -10
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/agent/systemPrompts.ts lib/agent/systemPrompts.test.ts
git commit -m "feat(agent): add systemPrompts module (lite + full prompts)"
```

---

## Task 3: Loop Enhancements — systemPrompt param, retry on stall, context pruning

**Files:**
- Modify: `lib/agent/loop.ts`
- Modify: `lib/agent/loop.test.ts`

### 3a: Write failing tests first

- [ ] **Step 1: Add tests for retry on stall and context pruning to loop.test.ts**

Open `lib/agent/loop.test.ts` and append the following two `describe` blocks after the closing `});` of the existing `describe("requireWriteApproval", ...)` block (after line 212):

```ts
  describe("retry on stall", () => {
    it("sends a recovery message when model returns text mid-task with no terminal phrase", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "c1", tool: "echo", args: { text: "hi" } })
        .mockResolvedValueOnce({ type: "text", content: "I will now write the file." })  // stall — no terminal phrase
        .mockResolvedValueOnce({ type: "text", content: "Done." });                      // terminal after retry

      const mockExec = vi.fn().mockResolvedValue("hi");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "do something" }],
        tools: [echoTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
      })) {
        events.push(event);
      }

      // providerStep called 3 times: tool call, stall, recovery result
      expect(mockStep).toHaveBeenCalledTimes(3);
      // Final text_delta should be "Done."
      const lastDelta = events.filter((e) => e.type === "text_delta").at(-1);
      expect(lastDelta?.type === "text_delta" && lastDelta.delta).toBe("Done.");
    });

    it("does NOT retry when the model text contains a terminal phrase", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "c1", tool: "echo", args: { text: "hi" } })
        .mockResolvedValueOnce({ type: "text", content: "All done, the file is updated." });

      const mockExec = vi.fn().mockResolvedValue("hi");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "do something" }],
        tools: [echoTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
      })) {
        events.push(event);
      }

      // Only 2 calls — no retry
      expect(mockStep).toHaveBeenCalledTimes(2);
    });

    it("does NOT retry twice — stall after recovery ends the loop normally", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "c1", tool: "echo", args: { text: "hi" } })
        .mockResolvedValueOnce({ type: "text", content: "I will write the file now." })   // stall → retry
        .mockResolvedValueOnce({ type: "text", content: "I will write the file now." });  // stall again → no second retry

      const mockExec = vi.fn().mockResolvedValue("hi");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "do something" }],
        tools: [echoTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
      })) {
        events.push(event);
      }

      // 3 calls total — retried once, then fell through on second stall
      expect(mockStep).toHaveBeenCalledTimes(3);
      // Ends with done event (not error)
      expect(events.some((e) => e.type === "done")).toBe(true);
    });

    it("does NOT retry when i === 0 (model never saw a tool result)", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "text", content: "I will write the file now." });

      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "do something" }],
        tools: [echoTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
      })) {
        events.push(event);
      }

      // Only 1 call — no retry on first response
      expect(mockStep).toHaveBeenCalledTimes(1);
    });
  });

  describe("context pruning", () => {
    it("truncates old tool_result content when token estimate exceeds 3000", async () => {
      // Build a 4000-char tool result (> 3000 estimated tokens when chars/4)
      // 1 char = 0.25 tokens → 12001 chars = 3001 tokens
      const bigOutput = "x".repeat(12_004);

      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "c1", tool: "echo", args: { text: "a" } })
        .mockResolvedValueOnce({ type: "tool_call", callId: "c2", tool: "echo", args: { text: "b" } })
        .mockResolvedValueOnce({ type: "tool_call", callId: "c3", tool: "echo", args: { text: "c" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });

      // First two tool results are large; third is small
      const mockExec = vi.fn()
        .mockResolvedValueOnce(bigOutput)
        .mockResolvedValueOnce("small result")
        .mockResolvedValueOnce("tiny");

      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "do work" }],
        tools: [echoTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
      })) {
        events.push(event);
      }

      // The first tool_result output emitted via yield is still the full value
      // (pruning happens to history, not to the already-yielded event).
      // What we can observe: providerStep was called with a truncated history.
      // Check via the last providerStep call's messages argument.
      const lastCallMessages = mockStep.mock.calls[3][0] as Array<{ role: string; content?: string }>;
      const toolResults = lastCallMessages.filter((m) => m.role === "tool_result");
      // We have 3 tool_results; the first (not last 2) should be truncated
      expect(toolResults.length).toBe(3);
      // The first result (bigOutput) was pruned
      expect(toolResults[0].content).toMatch(/\[…truncated\]$/);
      // The last 2 results are untouched
      expect(toolResults[1].content).toBe("small result");
      expect(toolResults[2].content).toBe("tiny");
    });

    it("keeps last 2 tool_results intact regardless of size", async () => {
      const bigOutput = "x".repeat(12_004);

      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "c1", tool: "echo", args: { text: "a" } })
        .mockResolvedValueOnce({ type: "tool_call", callId: "c2", tool: "echo", args: { text: "b" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });

      // Both results are large; only 2 results total, so both are "last 2" → neither pruned
      const mockExec = vi.fn()
        .mockResolvedValueOnce(bigOutput)
        .mockResolvedValueOnce(bigOutput);

      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "do work" }],
        tools: [echoTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
      })) {
        events.push(event);
      }

      const lastCallMessages = mockStep.mock.calls[2][0] as Array<{ role: string; content?: string }>;
      const toolResults = lastCallMessages.filter((m) => m.role === "tool_result");
      expect(toolResults.length).toBe(2);
      // Both are last-2, so neither should end with truncation marker
      expect(toolResults[0].content).not.toMatch(/\[…truncated\]$/);
      expect(toolResults[1].content).not.toMatch(/\[…truncated\]$/);
    });
  });
```

Note: these tests must be inside the outer `describe("runAgentLoop", ...)` block. Add them before its closing `});`.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run lib/agent/loop.test.ts 2>&1 | tail -15
```

Expected: the 7 new tests fail (retry/pruning behaviour not yet implemented).

### 3b: Implement the loop changes

- [ ] **Step 3: Add import for makeFullSystemPrompt and estimateTokens helper to loop.ts**

At the top of `lib/agent/loop.ts`, add after the existing imports:

```ts
import { makeFullSystemPrompt } from "./systemPrompts";
```

Then add this function at module level, just before the `interface LoopOptions` declaration (around line 50):

```ts
/** Rough token estimate: 1 token ≈ 4 characters. */
function estimateTokens(messages: InternalMessage[]): number {
  return messages.reduce((sum, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + Math.ceil(text.length / 4);
  }, 0);
}
```

- [ ] **Step 4: Add `systemPrompt?` to LoopOptions and use it**

In the `LoopOptions` interface (currently around line 50), add `systemPrompt?: string;` as a new field:

```ts
interface LoopOptions {
  messages: InternalMessage[];
  tools: ToolDefinition[];
  workspaceRoot: string;
  memory?: string;
  systemPrompt?: string;   // ← ADD THIS
  providerStep: (
    messages: InternalMessage[],
    tools: ToolDefinition[],
  ) => Promise<ProviderStepResult>;
  executeToolFn?: typeof executeTool;
  onProgress?: (callId: string, chunk: string) => void;
  requireWriteApproval?: boolean;
  planMode?: boolean;
  /** Internal test-only: when set, resolves every registerApproval with this value instead of blocking. */
  _testApprovalResult?: boolean;
}
```

Then in the history initialization inside `runAgentLoop` (currently line 73), change:

```ts
  const history: InternalMessage[] = [
    { role: "system", content: makeSystemPrompt(workspaceRoot, options.memory) },
    ...options.messages,
  ];
```

to:

```ts
  const history: InternalMessage[] = [
    {
      role: "system",
      content: options.systemPrompt ?? makeFullSystemPrompt(workspaceRoot, options.memory),
    },
    ...options.messages,
  ];
```

- [ ] **Step 5: Add retry-on-stall logic**

Add `let retryCount = 0;` immediately after `let toolCallCount = 0;` (currently line 101).

Then replace the existing text-result handling block:

```ts
    if (result.type === "text") {
      yield { type: "text_delta", delta: result.content };
      yield { type: "done", toolCallCount };
      return;
    }
```

with:

```ts
    if (result.type === "text") {
      // Retry on stall: when the model outputs text mid-task without a terminal phrase,
      // push a single recovery prompt and continue.
      const TERMINAL_PHRASES = ["done", "complete", "finished", "here is", "here's", "all done"];
      const lower = result.content.toLowerCase();
      const isTerminal = TERMINAL_PHRASES.some((p) => lower.includes(p));

      if (i > 0 && retryCount < 1 && !isTerminal) {
        const toolNames = tools.map((t) => t.name).join(", ");
        history.push({
          role: "user",
          content: `You must call a tool next. Do not describe what you will do — call the tool directly. Available tools: ${toolNames}.`,
        });
        retryCount++;
        continue;
      }

      yield { type: "text_delta", delta: result.content };
      yield { type: "done", toolCallCount };
      return;
    }
```

- [ ] **Step 6: Add context pruning**

After the existing line (currently ~line 288):

```ts
    history.push({ role: "tool_result", callId: result.callId, content: trimmed });
```

add:

```ts
    // Context pruning: when history grows large, truncate old tool_result content
    // to keep the model's context window manageable for weak local models.
    const nonSysMessages = history.filter((m) => m.role !== "system");
    if (estimateTokens(nonSysMessages) > 3_000) {
      const toolResults = history.filter(
        (m): m is Extract<InternalMessage, { role: "tool_result" }> => m.role === "tool_result",
      );
      const toTruncate = toolResults.slice(0, -2); // preserve last 2
      for (const msg of toTruncate) {
        if (!msg.content.endsWith("[…truncated]")) {
          msg.content = msg.content.slice(0, 200) + " […truncated]";
        }
      }
    }
```

- [ ] **Step 7: Remove the now-unused internal makeSystemPrompt function**

Delete the entire `makeSystemPrompt` function from `loop.ts` (lines 15–48). It has been replaced by `makeFullSystemPrompt` in `systemPrompts.ts`.

The final imports section at the top of `loop.ts` should now include:

```ts
import { makeFullSystemPrompt } from "./systemPrompts";
```

And the `makeSystemPrompt` function definition should be gone.

- [ ] **Step 8: Run all loop tests to verify they pass**

```bash
npx vitest run lib/agent/loop.test.ts 2>&1 | tail -15
```

Expected: all tests PASS (existing + 7 new).

- [ ] **Step 9: Commit**

```bash
git add lib/agent/loop.ts lib/agent/loop.test.ts
git commit -m "feat(agent): add systemPrompt param, retry-on-stall, context pruning to loop"
```

---

## Task 4: Route — Tier Wiring

**Files:**
- Modify: `app/api/agent/stream/route.ts`

This task wires the classifier, tool-set selection, and prompt selection into the route. No new tests are needed here — the classifier and loop already have unit tests; route integration is covered by manual smoke-testing.

- [ ] **Step 1: Add imports to route.ts**

At the top of `app/api/agent/stream/route.ts`, add after the existing imports:

```ts
import { classifyTask, type AgentTier } from "@/lib/agent/taskClassifier";
import { makeLiteSystemPrompt, makeFullSystemPrompt } from "@/lib/agent/systemPrompts";
```

- [ ] **Step 2: Add `liteAgentMode` to StreamRequestBody**

In the `StreamRequestBody` interface, add:

```ts
  liteAgentMode?: boolean; // true = force lite, false = force standard, undefined = auto
```

The updated interface becomes:

```ts
interface StreamRequestBody {
  prompt?: string;
  history?: HistoryMessage[];
  model?: string;
  provider?: AIProvider;
  workspaceRoot?: string;
  memory?: string;
  mcpServers?: MCPServer[];
  requireWriteApproval?: boolean;
  planMode?: boolean;
  attachments?: ImageAttachment[];
  liteAgentMode?: boolean;
}
```

- [ ] **Step 3: Add SIMPLE_TOOL_NAMES constant**

Below the existing imports (before the `interface StreamRequestBody` declaration), add:

```ts
const SIMPLE_TOOL_NAMES = ["list_files", "read_file", "write_file", "search_files"] as const;
const LOCAL_PROVIDERS = ["ollama", "lmstudio", "llamaserver"] as const;
```

- [ ] **Step 4: Compute tier and select tools + system prompt**

Inside the `POST` handler, after the line `const provider = (body.provider ?? "groq") as AIProvider;` and before the `const history: InternalMessage[]` block, add:

```ts
  // ── Tier selection ────────────────────────────────────────────────────────
  // Override rules (per spec):
  //   liteAgentMode === true  → always "simple"
  //   liteAgentMode === false → always "standard"
  //   liteAgentMode === undefined (auto) → local: classifier result; cloud: "standard"
  const isLocalProvider = (LOCAL_PROVIDERS as ReadonlyArray<string>).includes(provider);

  let tier: AgentTier;
  if (body.liteAgentMode === true) {
    tier = "simple";
  } else if (body.liteAgentMode === false) {
    tier = "standard";
  } else {
    // auto
    tier = isLocalProvider ? classifyTask(prompt) : "standard";
  }

  const systemPrompt =
    tier === "simple"
      ? makeLiteSystemPrompt(workspaceRoot, body.memory)
      : makeFullSystemPrompt(workspaceRoot, body.memory);
```

- [ ] **Step 5: Select base tool set based on tier**

Find the existing line:

```ts
  const allTools = [...TOOL_DEFINITIONS];
```

Replace it with:

```ts
  const baseToolDefs =
    tier === "simple"
      ? TOOL_DEFINITIONS.filter((t) => (SIMPLE_TOOL_NAMES as ReadonlyArray<string>).includes(t.name))
      : [...TOOL_DEFINITIONS];
  const allTools = [...baseToolDefs];
```

- [ ] **Step 6: Pass systemPrompt to runAgentLoop**

In the `runAgentLoop({...})` call inside the stream's `start` function, add `systemPrompt` to the options object:

```ts
        for await (const event of runAgentLoop({
          messages: history,
          tools: allTools,
          workspaceRoot,
          memory: body.memory,
          systemPrompt,          // ← ADD THIS
          providerStep,
          onProgress,
          requireWriteApproval: body.requireWriteApproval ?? false,
          planMode: body.planMode ?? false,
          executeToolFn: async (name, args, root, onProgressCb) => {
```

- [ ] **Step 7: Build the project to check for TypeScript errors**

```bash
cd "/Users/ahomsi/Development/Personal Projects/Marven"
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. Fix any type errors before continuing.

- [ ] **Step 8: Commit**

```bash
git add app/api/agent/stream/route.ts
git commit -m "feat(agent): wire tier selection (tools + prompt) into stream route"
```

---

## Task 5: Settings Toggle + Client Wiring

**Files:**
- Modify: `app/components/marven/SettingsModal.tsx`
- Modify: `hooks/useAgentStream.ts`
- Modify: `app/page.tsx`

### 5a: SettingsModal — "Lite agent mode" toggle

- [ ] **Step 1: Add liteAgentMode state to SettingsModal**

In `app/components/marven/SettingsModal.tsx`, find the block where `requireWriteApproval` state is declared (around line 255):

```ts
  const [requireWriteApproval, setRequireWriteApprovalState] = useState<boolean>(false);
```

Add directly after it:

```ts
  const [liteAgentMode, setLiteAgentModeState] = useState<boolean>(false);
```

- [ ] **Step 2: Load liteAgentMode from electron settings on mount**

Find the existing useEffect that loads settings (the one that calls `electron.getSettings()` and sets `requireWriteApproval` and other settings — it calls `setRequireWriteApprovalState`). Inside that effect's `.then` callback, add:

```ts
      if (typeof s.liteAgentMode === "boolean") {
        setLiteAgentModeState(s.liteAgentMode);
      }
```

(Place it alongside the existing `setRequireWriteApprovalState` call in that effect.)

- [ ] **Step 3: Add the toggle block to the General tab**

In `app/components/marven/SettingsModal.tsx`, find the closing of the General tab section — it ends with the "Require approval before writing files" block around line 977–1006:

```tsx
            {/* Require write approval toggle */}
            <div className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
              ...
            </div>
          </div>
        )}
```

Add the following new block immediately after the "Require write approval" div closing tag and before the `</div>\n        )}` that closes the General section:

```tsx
            {/* Agent section heading */}
            <h3 className="text-[13px] font-medium text-[var(--m-text)]">Agent</h3>

            {/* Lite agent mode toggle */}
            <div className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-[13px] font-medium text-[var(--m-text)]">Lite agent mode</h3>
                  <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">
                    Automatically uses a reduced tool set and shorter instructions.
                    On by default for local models.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={liteAgentMode}
                  onClick={async () => {
                    const next = !liteAgentMode;
                    setLiteAgentModeState(next);
                    await saveBackendSettings({ liteAgentMode: next });
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    liteAgentMode ? "bg-[#d19a66]" : "bg-[var(--m-border)]"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      liteAgentMode ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
```

Note: `saveBackendSettings` already exists in SettingsModal (added in the AI Backends task). It handles the electron read-modify-write with in-flight guard.

- [ ] **Step 4: Verify the toggle renders correctly**

Start the app locally and open Settings → General. Confirm the "Lite agent mode" toggle appears below "Require approval before writing files". Toggle it on and off; verify the electron settings file (`~/Library/Application Support/Marven/settings.json` on macOS) is updated.

### 5b: useAgentStream — pass liteAgentMode in fetch body

- [ ] **Step 5: Add liteAgentMode to UseAgentStreamOptions**

In `hooks/useAgentStream.ts`, find the `UseAgentStreamOptions` interface:

```ts
interface UseAgentStreamOptions {
  provider: AIProvider;
  model: string;
  workspaceRoot: string | null;
  memory?: string;
  mcpServers?: MCPServer[];
  requireWriteApproval?: boolean;
  planMode?: boolean;
}
```

Add `liteAgentMode?: boolean;` to it:

```ts
interface UseAgentStreamOptions {
  provider: AIProvider;
  model: string;
  workspaceRoot: string | null;
  memory?: string;
  mcpServers?: MCPServer[];
  requireWriteApproval?: boolean;
  planMode?: boolean;
  liteAgentMode?: boolean;
}
```

- [ ] **Step 6: Destructure and include liteAgentMode in fetch body**

In the same file, find the `useAgentStream` function signature:

```ts
export function useAgentStream({ provider, model, workspaceRoot, memory, mcpServers, requireWriteApproval, planMode }: UseAgentStreamOptions) {
```

Add `liteAgentMode` to the destructuring:

```ts
export function useAgentStream({ provider, model, workspaceRoot, memory, mcpServers, requireWriteApproval, planMode, liteAgentMode }: UseAgentStreamOptions) {
```

Then find the `fetch("/api/agent/stream", ...)` call (around line 124) and its `body: JSON.stringify({...})`. Add `liteAgentMode` to the serialized object:

```ts
        body: JSON.stringify({
          prompt,
          history,
          provider,
          model,
          workspaceRoot,
          memory,
          mcpServers: (mcpServers ?? []).filter((s) => s.enabled),
          requireWriteApproval: requireWriteApproval ?? false,
          planMode: effectivePlanMode,
          attachments: attachments ?? [],
          liteAgentMode,          // ← ADD THIS
        }),
```

### 5c: app/page.tsx — read liteAgentMode from electron, pass to hook

- [ ] **Step 7: Add liteAgentMode state to page.tsx**

In `app/page.tsx`, find where `planMode` state is declared (around line 268):

```ts
  const [planMode, setPlanModeState] = useState<boolean>(() => getPlanMode());
```

Add directly after it:

```ts
  const [liteAgentMode, setLiteAgentModeLocal] = useState<boolean | undefined>(undefined);
```

- [ ] **Step 8: Read liteAgentMode from electron on mount**

In `app/page.tsx`, find the existing useEffect that reads `notifyTaskComplete` from electron (around line 468–484). Below that, add a new useEffect to read `liteAgentMode`:

```ts
  // Read liteAgentMode from electron settings and keep in sync.
  useEffect(() => {
    const el = typeof window !== "undefined"
      ? (window as any).marvenElectron  // eslint-disable-line @typescript-eslint/no-explicit-any
      : null;
    if (!el?.getSettings) return;
    el.getSettings()
      .then((s: { liteAgentMode?: boolean }) => {
        if (typeof s.liteAgentMode === "boolean") {
          setLiteAgentModeLocal(s.liteAgentMode);
        }
      })
      .catch(() => {});
    const onChange = () => {
      el.getSettings()
        .then((s: { liteAgentMode?: boolean }) => {
          if (typeof s.liteAgentMode === "boolean") {
            setLiteAgentModeLocal(s.liteAgentMode);
          }
        })
        .catch(() => {});
    };
    window.addEventListener("marven:settings-changed", onChange);
    return () => window.removeEventListener("marven:settings-changed", onChange);
  }, []);
```

- [ ] **Step 9: Pass liteAgentMode to useAgentStream**

Find the `useAgentStream({...})` call (around line 282):

```ts
  } = useAgentStream({
    provider,
    model: selectedModel,
    workspaceRoot,
    memory: memories.length > 0 ? memories.map((m) => `- ${m}`).join("\n") : undefined,
    mcpServers,
    requireWriteApproval: getRequireWriteApproval(),
    planMode,
  });
```

Add `liteAgentMode`:

```ts
  } = useAgentStream({
    provider,
    model: selectedModel,
    workspaceRoot,
    memory: memories.length > 0 ? memories.map((m) => `- ${m}`).join("\n") : undefined,
    mcpServers,
    requireWriteApproval: getRequireWriteApproval(),
    planMode,
    liteAgentMode,          // ← ADD THIS
  });
```

- [ ] **Step 10: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 11: TypeScript check**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 12: Commit**

```bash
git add app/components/marven/SettingsModal.tsx hooks/useAgentStream.ts app/page.tsx
git commit -m "feat(agent): wire lite mode toggle + liteAgentMode client→route"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Run full test suite one last time**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all tests pass (0 failures).

- [ ] **Step 2: Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds, no TypeScript or lint errors.

- [ ] **Step 3: Smoke test — local model simple task**

With a local Ollama model selected, send: "change the background color to red"

Expected:
- The route classifies this as `"simple"` (or respects `liteAgentMode` toggle)
- Agent receives only 4 tools (`list_files`, `read_file`, `write_file`, `search_files`)
- Agent receives the short 6-rule system prompt

To verify classification, temporarily add a `console.log("tier:", tier)` in `route.ts` and check the dev console.

- [ ] **Step 4: Smoke test — cloud model not affected**

With Groq selected, send the same message.

Expected:
- Route classifies as `"standard"` (cloud providers always standard unless liteAgentMode = true)
- Agent receives all 13 tools and the full system prompt

- [ ] **Step 5: Smoke test — retry on stall**

With a model known to sometimes stall (e.g. `phi3` via Ollama), observe that a single recovery message is injected when the model outputs text instead of calling a tool mid-task.

- [ ] **Step 6: Final commit**

```bash
git add -u
git commit -m "feat: adaptive agent lite mode — complete implementation"
```
