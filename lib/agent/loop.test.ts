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
    expect(lastEvent.code).toBe("max_iterations");
  });
});
