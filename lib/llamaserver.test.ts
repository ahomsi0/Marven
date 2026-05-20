import { describe, it, expect, vi, beforeEach } from "vitest";

const mockList = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function () { return { models: { list: mockList } }; }),
}));

import OpenAI from "openai";
import { getLlamaServerModels } from "./llamaserver";

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
