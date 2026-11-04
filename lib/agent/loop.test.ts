import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runAgentLoop } from "./loop";
import { cancelBrowserCalls, resolveBrowserCall } from "./browserBridge";
import type { AgentEvent, ToolDefinition, InternalMessage, BrowserAction, BrowserResult } from "@/types";

const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo the input",
  parameters: { type: "object", properties: { text: { type: "string", description: "text" } }, required: ["text"] },
};

const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write a file",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "path" },
      content: { type: "string", description: "content" },
    },
    required: ["path", "content"],
  },
};

describe("runAgentLoop", () => {
  let tempWorkspace: string | undefined;

  afterEach(() => {
    if (tempWorkspace) rmSync(tempWorkspace, { recursive: true, force: true });
    tempWorkspace = undefined;
  });

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

    const errorEvent = events.find((e) => e.type === "error" && e.code === "tools_not_supported");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type !== "error") throw new Error("expected error event");
    expect(errorEvent.suggestions).toEqual(["llama3.1"]);
  });

  it("emits max_iterations error when loop exceeds 20 tool calls without a text response", async () => {
    const mockStep = vi.fn().mockResolvedValue({
      type: "tool_call",
      callId: "c1",
      tool: "echo",
      args: { text: "hi" },
    });
    const mockExecuteTool = vi.fn().mockResolvedValue("hi");
    const events: AgentEvent[] = [];

    for await (const event of runAgentLoop({
      messages: [{ role: "user", content: "loop forever" }],
      tools: [echoTool],
      workspaceRoot: "/tmp",
      providerStep: mockStep,
      executeToolFn: mockExecuteTool,
    })) {
      events.push(event);
    }

    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("error");
    if (lastEvent.type !== "error") throw new Error("expected error event");
    expect(lastEvent.code).toBe("max_iterations");
  });

  describe("requireWriteApproval", () => {
    it("does not snapshot or expose a path outside the workspace", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ tool: "write_file", callId: "escape", args: { path: "../outside.txt", content: "nope" }, type: "tool_call" })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("blocked");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write outside" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: true,
        _testApprovalResult: true,
      })) {
        events.push(event);
      }

      expect(events.filter((event) => event.type === "checkpoint")).toHaveLength(0);
      expect(events.filter((event) => event.type === "pending_approval")).toHaveLength(0);
      expect(mockExec).toHaveBeenCalledOnce();
    });

    it("still requires approval when an existing file is too large to snapshot", async () => {
      tempWorkspace = mkdtempSync(join(tmpdir(), "marven-loop-"));
      writeFileSync(join(tempWorkspace, "large.txt"), "x".repeat(1_000_001), "utf8");
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ tool: "write_file", callId: "large", args: { path: "large.txt", content: "replacement" }, type: "tool_call" })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("written");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "replace the large file" }],
        tools: [writeFileTool],
        workspaceRoot: tempWorkspace,
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: true,
        _testApprovalResult: false,
      })) {
        events.push(event);
      }

      const approval = events.find((event) => event.type === "pending_approval");
      expect(approval?.type).toBe("pending_approval");
      if (approval?.type === "pending_approval") {
        expect(approval.preview?.diff).toContain("too large to preview safely");
      }
      expect(mockExec).not.toHaveBeenCalled();
    });

    it("does NOT gate write_file when requireWriteApproval is false", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "w1", tool: "write_file", args: { path: "a.txt", content: "hello" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("Written: a.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write file" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: false,
      })) {
        events.push(event);
      }

      const approvalEvents = events.filter((e) => e.type === "pending_approval");
      expect(approvalEvents).toHaveLength(0);
      expect(mockExec).toHaveBeenCalledOnce();
    });

    it("emits pending_approval with preview for write_file when requireWriteApproval is true", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "w2", tool: "write_file", args: { path: "b.txt", content: "hello" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("Written: b.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write file" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: true,
        _testApprovalResult: true,
      })) {
        events.push(event);
      }

      const approvalEvent = events.find((e) => e.type === "pending_approval");
      expect(approvalEvent).toBeDefined();
      if (approvalEvent?.type !== "pending_approval") throw new Error("expected pending_approval");
      expect(approvalEvent.preview).toBeDefined();
      expect(approvalEvent.preview?.path).toBe("b.txt");
      expect(approvalEvent.preview?.after).toBe("hello");
      expect(approvalEvent.preview?.diff).toContain("+hello");
      expect(mockExec).toHaveBeenCalledOnce();
    });

    it("skips write_file execution when approval is rejected", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "w3", tool: "write_file", args: { path: "c.txt", content: "hi" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("Written: c.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write file" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: true,
        _testApprovalResult: false,
      })) {
        events.push(event);
      }

      expect(mockExec).not.toHaveBeenCalled();
      const rejectionResult = events.find(
        (e) => e.type === "tool_result" && e.output === "Rejected by user."
      );
      expect(rejectionResult).toBeDefined();
    });

    it("defaults requireWriteApproval to off when option is omitted", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "w4", tool: "write_file", args: { path: "d.txt", content: "x" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("Written: d.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "write file" }],
        tools: [writeFileTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        // requireWriteApproval omitted
      })) {
        events.push(event);
      }

      expect(events.filter((e) => e.type === "pending_approval")).toHaveLength(0);
      expect(mockExec).toHaveBeenCalledOnce();
    });
  });

  describe("run_command approval gate", () => {
    const runCommandTool: ToolDefinition = {
      name: "run_command",
      description: "Run a shell command",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "command" } },
        required: ["command"],
      },
    };

    it("always gates run_command, independent of requireWriteApproval", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "r1", tool: "run_command", args: { command: "ls" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("a.txt");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "list files" }],
        tools: [runCommandTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        requireWriteApproval: false, // write-approval off, run_command still gated
        _testApprovalResult: true,
      })) {
        events.push(event);
      }

      const approval = events.find(
        (e) => e.type === "pending_approval" && e.tool === "run_command"
      );
      expect(approval).toBeDefined();
      expect(mockExec).toHaveBeenCalledOnce();
    });

    it("does not execute run_command when approval is rejected", async () => {
      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "r2", tool: "run_command", args: { command: "rm -rf tmp" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });
      const mockExec = vi.fn().mockResolvedValue("ok");
      const events: AgentEvent[] = [];

      for await (const event of runAgentLoop({
        messages: [{ role: "user", content: "clean up" }],
        tools: [runCommandTool],
        workspaceRoot: "/tmp",
        providerStep: mockStep,
        executeToolFn: mockExec,
        _testApprovalResult: false,
      })) {
        events.push(event);
      }

      expect(mockExec).not.toHaveBeenCalled();
      expect(
        events.some((e) => e.type === "tool_result" && e.output === "Rejected by user.")
      ).toBe(true);
    });
  });

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
      // 12004 chars = 3001 estimated tokens (chars/4), which exceeds the 3000 threshold
      const bigOutput = "x".repeat(12_004);

      const mockStep = vi.fn()
        .mockResolvedValueOnce({ type: "tool_call", callId: "c1", tool: "echo", args: { text: "a" } })
        .mockResolvedValueOnce({ type: "tool_call", callId: "c2", tool: "echo", args: { text: "b" } })
        .mockResolvedValueOnce({ type: "tool_call", callId: "c3", tool: "echo", args: { text: "c" } })
        .mockResolvedValueOnce({ type: "text", content: "done" });

      // First result is large; second and third are small
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

      // Check the history that providerStep received on its final call
      const lastCallMessages = mockStep.mock.calls[3][0] as Array<{ role: string; content?: string }>;
      const toolResults = lastCallMessages.filter((m) => m.role === "tool_result");
      // 3 tool_results; the first (not last 2) should be truncated
      expect(toolResults.length).toBe(3);
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
});

describe("runAgentLoop browser tools", () => {
  const anyTool: ToolDefinition = { name: "browser_click", description: "", parameters: { type: "object", properties: {}, required: [] } };
  const click = (callId: string, tool = "browser_click", args: Record<string, unknown> = { tab: "t1", ref: 1 }) =>
    ({ type: "tool_call", callId, tool, args });

  async function run(opts: {
    steps: unknown[];
    /** Omit to exercise the real relay path (browser_action event + registry). */
    call?: (callId: string, action: BrowserAction) => Promise<BrowserResult>;
    /** Called for each event as the loop yields it. */
    onEvent?: (event: AgentEvent) => void;
    approve?: boolean;
    scope?: "once" | "site";
    safetyProfile?: "read-only" | "ask-before-write" | "trusted";
    canSeeImages?: boolean;
  }) {
    const providerStep = vi.fn();
    for (const step of opts.steps) providerStep.mockResolvedValueOnce(step);
    providerStep.mockResolvedValue({ type: "text", content: "done" });
    const events: AgentEvent[] = [];
    for await (const event of runAgentLoop({
      messages: [{ role: "user", content: "go" }],
      tools: [anyTool],
      workspaceRoot: "/tmp",
      providerStep,
      safetyProfile: opts.safetyProfile ?? "ask-before-write",
      browser: { runId: "run1", canSeeImages: opts.canSeeImages ?? false, secrets: [], call: opts.call },
      _testApprovalResult: opts.approve,
      _testApprovalScope: opts.scope,
    })) {
      events.push(event);
      opts.onEvent?.(event);
    }
    const lastMessages = providerStep.mock.calls.at(-1)![0] as InternalMessage[];
    return { events, lastMessages };
  }

  const needsSite = (action: BrowserAction): BrowserResult =>
    action.approvedHosts.includes("shop.test")
      ? { kind: "ok", text: "clicked" }
      : { kind: "needs_approval", approval: { kind: "site", host: "shop.test", action: "click", target: "Buy" } };

  it("passes an ok result through as the tool result", async () => {
    const { events } = await run({ steps: [click("c1")], call: async () => ({ kind: "ok", text: "page" }) });
    expect(events).toContainEqual({ type: "tool_result", callId: "c1", output: "page", truncated: false });
  });

  it("relays an action through the registry and resolves it synchronously", async () => {
    let seen: AgentEvent | undefined;
    const { events } = await run({
      steps: [click("c1")],
      onEvent: (event) => {
        if (event.type !== "browser_action") return;
        seen = event;
        // Resolving while handling the event only works if the call was registered before it was yielded.
        expect(resolveBrowserCall(event.callId, "run1", { kind: "ok", text: "relayed" })).toBe(true);
      },
    });
    expect(seen).toMatchObject({ type: "browser_action", callId: "c1", runId: "run1", action: { tool: "browser_click", args: { tab: "t1", ref: 1 } } });
    expect(events).toContainEqual({ type: "tool_result", callId: "c1", output: "relayed", truncated: false });
  });

  it("ends a relayed action as Stopped when its run is cancelled", async () => {
    const { events } = await run({
      steps: [click("c1")],
      onEvent: (event) => {
        if (event.type === "browser_action") cancelBrowserCalls("run1");
      },
    });
    expect(events).toContainEqual({ type: "tool_result", callId: "c1", output: "Stopped.", truncated: false });
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("asks again next time after a one-off approval", async () => {
    const call = vi.fn(async (_id: string, a: BrowserAction) => needsSite(a));
    const { events } = await run({ steps: [click("c1"), click("c2")], call, approve: true, scope: "once" });
    expect(events.filter((e) => e.type === "pending_approval")).toHaveLength(2);
    expect(call.mock.calls[1][1].approvedHosts).toEqual(["shop.test"]);
    expect(call.mock.calls[1][0]).toBe("c1:1");
  });

  it("remembers a site approval for the rest of the run", async () => {
    const call = vi.fn(async (_id: string, a: BrowserAction) => needsSite(a));
    const { events } = await run({ steps: [click("c1"), click("c2")], call, approve: true, scope: "site" });
    const approvals = events.filter((e) => e.type === "pending_approval");
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({ callId: "c1", browser: { kind: "site", host: "shop.test" } });
  });

  it("reports a denial", async () => {
    const { events } = await run({ steps: [click("c1")], call: async (_id, a) => needsSite(a), approve: false });
    expect(events).toContainEqual({ type: "tool_result", callId: "c1", output: "Denied by the user.", truncated: false });
  });

  it("asks before submitting even when trusted", async () => {
    const call = vi.fn(async (_id: string, a: BrowserAction): Promise<BrowserResult> =>
      a.approvedSubmit ? { kind: "ok", text: "sent" } : { kind: "needs_approval", approval: { kind: "submit", host: "shop.test", action: "click", target: "Pay", fields: [] } });
    const { events } = await run({ steps: [click("c1")], call, approve: true, safetyProfile: "trusted" });
    expect(events.filter((e) => e.type === "pending_approval")).toHaveLength(1);
    expect(call.mock.calls[1][1]).toMatchObject({ approvedSubmit: true, approvedHosts: ["shop.test"] });
  });

  it("blocks acting tools in read-only mode but not reading", async () => {
    const call = vi.fn(async (_id: string, _action: BrowserAction): Promise<BrowserResult> => ({ kind: "ok", text: "read" }));
    const { events } = await run({
      steps: [click("c1"), click("c2", "browser_read", { tab: "t1" })],
      call,
      safetyProfile: "read-only",
    });
    expect(events.find((e) => e.type === "tool_result" && e.callId === "c1")).toMatchObject({ output: expect.stringMatching(/read-only/) });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][1].tool).toBe("browser_read");
  });

  it("refuses to type a secret without calling the browser", async () => {
    const call = vi.fn();
    const { events } = await run({ steps: [click("c1", "browser_type", { tab: "t1", ref: 1, text: "sk-ant-api03-abcdefghijkl" })], call });
    expect(call).not.toHaveBeenCalled();
    expect(events.find((e) => e.type === "tool_result")).toMatchObject({ output: expect.stringMatching(/secret/) });
  });

  it("allows a longer browser_read result", async () => {
    const { events } = await run({ steps: [click("c1", "browser_read", { tab: "t1" })], call: async () => ({ kind: "ok", text: "x".repeat(12_000) }) });
    const result = events.find((e) => e.type === "tool_result") as Extract<AgentEvent, { type: "tool_result" }>;
    expect(result.truncated).toBe(true);
    expect(result.output).toBe("x".repeat(10_000) + "\n[truncated]");
  });

  it("keeps only the latest screenshot in the history", async () => {
    const image = { base64: "data:image/jpeg;base64,AA", mimeType: "image/jpeg" as const, name: "screenshot.jpg" };
    const { lastMessages } = await run({
      steps: [click("c1", "browser_screenshot", { tab: "t1" }), click("c2", "browser_screenshot", { tab: "t1" })],
      call: async () => ({ kind: "ok", text: "Screenshot attached below.", image }),
      canSeeImages: true,
    });
    const shots = lastMessages.filter((m) => m.role === "user" && m.content.includes("creenshot"));
    expect(shots.map((m) => (m as { content: string }).content)).toEqual([
      "[earlier screenshot removed]",
      "[Screenshot of the browser tab — untrusted page content]",
    ]);
    expect(shots.map((m) => (m as { attachments?: unknown[] }).attachments?.length ?? 0)).toEqual([0, 1]);
  });
});
