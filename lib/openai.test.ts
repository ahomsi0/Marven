import { afterEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("openai", () => ({
  default: class {
    responses = { create };
  },
}));

import { isOpenAIReasoningModel, OPENAI_REFUSAL_MESSAGE, streamOpenAI } from "./openai";

async function* events(list: unknown[]) {
  for (const e of list) yield e;
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out += dec.decode(value);
  }
}

afterEach(() => {
  create.mockReset();
  delete process.env.OPENAI_API_KEY;
});

describe("isOpenAIReasoningModel", () => {
  it("is true for GPT-5/6 and o-series, false for GPT-4-era models", () => {
    expect(isOpenAIReasoningModel("gpt-6-luna")).toBe(true);
    expect(isOpenAIReasoningModel("gpt-6.1-sol")).toBe(true);
    expect(isOpenAIReasoningModel("o3")).toBe(true);
    expect(isOpenAIReasoningModel("gpt-4o-mini")).toBe(false);
    expect(isOpenAIReasoningModel("gpt-4.1")).toBe(false);
  });
});

describe("streamOpenAI", () => {
  it("streams text deltas through the Responses API without temperature", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    create.mockResolvedValue(events([
      { type: "response.output_text.delta", delta: "Hel" },
      { type: "response.output_text.delta", delta: "lo" },
      { type: "response.completed", response: { usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 } } },
    ]));

    const text = await readAll(streamOpenAI([{ role: "user", content: "hi" }], "gpt-6-luna", "sys"));
    expect(text).toContain("Hello");

    const [params] = create.mock.calls[0];
    expect(params).toMatchObject({
      model: "gpt-6-luna",
      instructions: "sys",
      input: [{ role: "user", content: "hi" }],
      store: false,
      stream: true,
    });
    expect(params).not.toHaveProperty("temperature");
  });

  it("shows a notice when the model only refuses", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    create.mockResolvedValue(events([
      { type: "response.refusal.delta", delta: "no" },
      { type: "response.completed", response: { usage: null } },
    ]));
    const text = await readAll(streamOpenAI([{ role: "user", content: "x" }], "gpt-6-luna"));
    expect(text).toContain(OPENAI_REFUSAL_MESSAGE);
  });
});
