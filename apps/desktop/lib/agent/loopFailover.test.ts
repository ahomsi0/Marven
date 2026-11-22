import { describe, it, expect, vi } from "vitest";
import { runAgentLoop } from "./loop";
import type { AgentEvent, ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";

const echoTool: ToolDefinition = {
  name: "echo",
  description: "Echo the input",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "text" } },
    required: ["text"],
  },
};

type Step = (
  messages: InternalMessage[],
  tools: ToolDefinition[],
) => Promise<ProviderStepResult>;

async function collect(run: () => AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const e of run()) events.push(e);
  return events;
}

describe("runAgentLoop failover", () => {
  const baseOpts = {
    messages: [{ role: "user", content: "say hi" }] as InternalMessage[],
    tools: [echoTool],
    workspaceRoot: "/tmp",
  };

  it("switches to the fallback step on a rate-limit error and surfaces the event", async () => {
    const primary: Step = vi.fn().mockRejectedValue(new Error("Rate limit reached. Too many retries."));
    const fallback: Step = vi.fn().mockResolvedValue({ type: "text", content: "hello from fallback" });

    const events = await collect(() =>
      runAgentLoop({
        ...baseOpts,
        providerStep: primary,
        failoverPlan: [{ label: "openai/gpt-4o-mini", providerStep: fallback }],
        primaryLabel: "groq/llama-3.3-70b-versatile",
      }),
    );

    expect(events.some((e) => e.type === "model_fallback" && e.from === "groq/llama-3.3-70b-versatile" && e.to === "openai/gpt-4o-mini")).toBe(true);
    expect(events.some((e) => e.type === "text_delta" && e.delta === "hello from fallback")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("walks multiple fallbacks in order until one works", async () => {
    const primary: Step = vi.fn().mockRejectedValue(new Error("429 too many requests"));
    const fb1: Step = vi.fn().mockRejectedValue(new Error("model_not_found: gpt-5"));
    const fb2: Step = vi.fn().mockResolvedValue({ type: "text", content: "third time lucky" });

    const events = await collect(() =>
      runAgentLoop({
        ...baseOpts,
        providerStep: primary,
        failoverPlan: [
          { label: "a/one", providerStep: fb1 },
          { label: "b/two", providerStep: fb2 },
        ],
      }),
    );

    const fallbacks = events.filter((e) => e.type === "model_fallback");
    expect(fallbacks.map((e) => (e as { to: string }).to)).toEqual(["a/one", "b/two"]);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("does NOT fail over on non-recoverable errors (auth failure)", async () => {
    const primary: Step = vi.fn().mockRejectedValue(new Error("Invalid API key (401)"));
    const fallback: Step = vi.fn();

    const events = await collect(() =>
      runAgentLoop({
        ...baseOpts,
        providerStep: primary,
        failoverPlan: [{ label: "x/y", providerStep: fallback }],
      }),
    );

    expect(fallback).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "error" && /Invalid API key/.test(e.message))).toBe(true);
    expect(events.some((e) => e.type === "model_fallback")).toBe(false);
  });

  it("gives up with the original error when the plan is exhausted", async () => {
    const boom = new Error("Rate limit reached. Too many retries.");
    const primary: Step = vi.fn().mockRejectedValue(boom);
    const fallback: Step = vi.fn().mockRejectedValue(new Error("429 again"));

    const events = await collect(() =>
      runAgentLoop({
        ...baseOpts,
        providerStep: primary,
        failoverPlan: [{ label: "a/one", providerStep: fallback }],
      }),
    );

    expect(events.some((e) => e.type === "error" && /429 again/.test(e.message))).toBe(true);
  });

  it("no failover without a plan — existing error behavior preserved", async () => {
    const primary: Step = vi.fn().mockRejectedValue(new Error("Rate limit reached"));

    const events = await collect(() =>
      runAgentLoop({ ...baseOpts, providerStep: primary }),
    );

    expect(events.some((e) => e.type === "error" && e.code === "provider_error")).toBe(true);
  });

  it("failover does not consume an iteration — the fallback continues the run", async () => {
    const primary: Step = vi.fn().mockRejectedValue(new Error("503 overloaded"));
    let fallbackCalls = 0;
    const fallback: Step = vi.fn(async (msgs: InternalMessage[]): Promise<ProviderStepResult> => {
      fallbackCalls++;
      const hasToolResult = msgs.some((m) => m.role === "tool_result");
      if (!hasToolResult) {
        return { type: "tool_call", callId: "c1", tool: "echo", args: { text: "hi" } };
      }
      return { type: "text", content: "Done." };
    });

    const mockExecuteTool = vi.fn().mockResolvedValue("hi");
    const events = await collect(() =>
      runAgentLoop({
        ...baseOpts,
        providerStep: primary,
        executeToolFn: mockExecuteTool,
        failoverPlan: [{ label: "backup/model", providerStep: fallback }],
        primaryLabel: "primary/model",
      }),
    );

    // The tool ran, the run finished, and both fallback turns happened inside
    // the same iteration — no stall-retry prompt injected between them.
    expect(mockExecuteTool).toHaveBeenCalled();
    expect(events.some((e) => e.type === "model_fallback" && e.from === "primary/model")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(fallbackCalls).toBe(2);
    const stallPrompts = events.filter(
      (e) => e.type === "tool_result",
    ).length;
    expect(stallPrompts).toBe(1);
  });
});
