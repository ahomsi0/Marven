import { describe, it, expect, vi } from "vitest";
import { runAgentLoop } from "./loop";
import type { AgentEvent, ToolDefinition, InternalMessage } from "@/types";

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
