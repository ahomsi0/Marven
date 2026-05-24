import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/completion/providers", () => ({
  completeOnce: vi.fn(),
}));

import { POST } from "./route";
import * as providers from "@/lib/completion/providers";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/completion/inline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/completion/inline", () => {
  it("returns { completion } on happy path", async () => {
    vi.mocked(providers.completeOnce).mockResolvedValue("return a + b;");
    const res = await POST(
      makeReq({
        prefix: "function add(a, b) {\n",
        suffix: "\n}",
        filePath: "math.ts",
        languageId: "typescript",
        provider: "ollama",
        model: "qwen2.5-coder",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ completion: "return a + b;" });
  });

  it("returns 400 on missing fields", async () => {
    const res = await POST(makeReq({ prefix: "x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on invalid JSON body", async () => {
    const bad = new Request("http://localhost/api/completion/inline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "}{",
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });

  it("returns 502 on provider error", async () => {
    vi.mocked(providers.completeOnce).mockRejectedValue(new Error("boom"));
    const res = await POST(
      makeReq({
        prefix: "x",
        suffix: "",
        filePath: "a.ts",
        languageId: "typescript",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    );
    expect(res.status).toBe(502);
  });

  it("returns empty completion when abort signaled", async () => {
    vi.mocked(providers.completeOnce).mockResolvedValue("");
    const res = await POST(
      makeReq({
        prefix: "x",
        suffix: "",
        filePath: "a.ts",
        languageId: "typescript",
        provider: "openai",
        model: "gpt-4o-mini",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ completion: "" });
  });
});
