import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () {
    return { models: { list: mockList } };
  }),
}));

import OpenAI from "openai";
import { buildLMStudioMessages, getLMStudioModels } from "./lmstudio";

describe("buildLMStudioMessages", () => {
  const img = { base64: "data:image/jpeg;base64,QUJD", mimeType: "image/jpeg" as const, name: "p.jpg" };
  const history = [
    { role: "user" as const, content: "what's this?", attachments: [img] },
    { role: "assistant" as const, content: "a dog" },
  ];

  it("sends image_url parts to a vision model", () => {
    expect(buildLMStudioMessages(history, "google/gemma-3-12b", "sys")).toEqual([
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "what's this?" },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
        ],
      },
      { role: "assistant", content: "a dog" },
    ]);
  });

  it("strips images for a text-only model", () => {
    const [, user] = buildLMStudioMessages(history, "llama-3.2-3b", "sys");
    expect(typeof user.content).toBe("string");
    expect(user.content).toContain("can't see images");
  });
});

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
