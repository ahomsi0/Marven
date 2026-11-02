import { afterEach, describe, expect, it, vi } from "vitest";
import { modelSupportsVision } from "./modelCapabilities";
import { clearOllamaCapabilityCache } from "./ollama";

afterEach(() => {
  vi.unstubAllGlobals();
  clearOllamaCapabilityCache();
});

describe("modelSupportsVision", () => {
  it("asks Ollama for its models", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ capabilities: ["completion", "vision"] }), { status: 200 })),
    );
    expect(await modelSupportsVision("ollama", "anything")).toBe(true);
  });

  it("uses the name heuristic for LM Studio and llama-server", async () => {
    expect(await modelSupportsVision("lmstudio", "qwen/qwen2.5-vl-7b")).toBe(true);
    expect(await modelSupportsVision("llamaserver", "llama-3.2-3b")).toBe(false);
  });

  it("matches the cloud providers' current behaviour", async () => {
    expect(await modelSupportsVision("openai", "gpt-4o")).toBe(true);
    expect(await modelSupportsVision("anthropic", "claude")).toBe(true);
    expect(await modelSupportsVision("groq", "meta-llama/llama-4-scout-17b-16e-instruct")).toBe(true);
    expect(await modelSupportsVision("groq", "llama-3.3-70b-versatile")).toBe(false);
    expect(await modelSupportsVision("openrouter", "x")).toBe(false);
    expect(await modelSupportsVision("ollama", "")).toBe(false);
  });
});
