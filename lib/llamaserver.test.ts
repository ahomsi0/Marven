import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () { return { models: { list: mockList } }; }),
}));

import OpenAI from "openai";
import { buildLlamaServerMessages, getLlamaServerModels } from "./llamaserver";

describe("buildLlamaServerMessages", () => {
  const img = { base64: "data:image/png;base64,QUJD", mimeType: "image/png" as const, name: "p.png" };

  it("sends image_url parts to a vision model", () => {
    const [, user] = buildLlamaServerMessages(
      [{ role: "user", content: "describe", attachments: [img] }],
      "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf",
    );
    expect(user).toEqual({
      role: "user",
      content: [
        { type: "text", text: "describe" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
      ],
    });
  });

  it("strips images for a text-only model and keeps plain turns as-is", () => {
    const [system, user, plain] = buildLlamaServerMessages(
      [
        { role: "user", content: "describe", attachments: [img] },
        { role: "user", content: "hello" },
      ],
      "local-model",
    );
    expect(system.role).toBe("system");
    expect(user.content).toContain("can't see images");
    expect(plain).toEqual({ role: "user", content: "hello" });
  });
});

describe("getLlamaServerModels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns [] on connection failure", async () => {
    mockList.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await getLlamaServerModels("http://localhost:8080");
    expect(result).toEqual([]);
  });

  it("maps model IDs to { name, size } objects", async () => {
    mockList.mockResolvedValue({
      data: [{ id: "llama-3.2-3b-q4" }, { id: "mistral-7b-q4" }],
    });
    const result = await getLlamaServerModels("http://localhost:8080");
    expect(result).toEqual([
      { name: "llama-3.2-3b-q4", size: 0 },
      { name: "mistral-7b-q4", size: 0 },
    ]);
  });

  it("constructs baseURL from the provided URL", async () => {
    mockList.mockResolvedValue({ data: [] });
    await getLlamaServerModels("http://localhost:7777");
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://localhost:7777/v1" })
    );
  });
});
