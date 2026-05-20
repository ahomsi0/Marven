import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () {
    return { models: { list: mockList } };
  }),
}));

import OpenAI from "openai";
import { getLMStudioModels } from "./lmstudio";

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
