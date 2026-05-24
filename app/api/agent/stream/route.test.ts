import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { NextRequest } from "next/server";

// Capture the messages handed to runAgentLoop.
const captured: { messages: unknown[] } = { messages: [] };

vi.mock("@/lib/agent/loop", () => ({
  runAgentLoop: vi.fn(async function* (opts: { messages: unknown[] }) {
    captured.messages = opts.messages;
    yield { type: "done", toolCallCount: 0 };
  }),
}));

// Stub the provider step modules so importing the route doesn't require API keys.
vi.mock("@/lib/agent/groq", () => ({ groqAgentStep: vi.fn() }));
vi.mock("@/lib/agent/ollama", () => ({ ollamaAgentStep: vi.fn() }));
vi.mock("@/lib/agent/nim", () => ({ nimAgentStep: vi.fn() }));
vi.mock("@/lib/agent/openrouter", () => ({ openrouterAgentStep: vi.fn() }));
vi.mock("@/lib/agent/openai", () => ({ openaiAgentStep: vi.fn() }));
vi.mock("@/lib/agent/anthropic", () => ({ anthropicAgentStep: vi.fn() }));

import { POST } from "./route";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream-route-"));
  captured.messages = [];
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

function makeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

async function drain(stream: ReadableStream): Promise<void> {
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

describe("POST /api/agent/stream — mention expansion", () => {
  it("prepends a <context> block containing the @file body to the user prompt", async () => {
    await fs.writeFile(path.join(tmpRoot, "snippet.ts"), "export const greet = 'hi';\n");
    const res = await POST(
      makeReq({
        prompt: "Explain greet",
        history: [],
        provider: "groq",
        model: "test-model",
        workspaceRoot: tmpRoot,
        mentions: [{ kind: "file", path: "snippet.ts" }],
      }),
    );
    expect(res.status).toBe(200);
    await drain(res.body!);

    const lastUserMsg = captured.messages.find(
      (m: unknown): m is { role: string; content: string } =>
        typeof m === "object" && m !== null && (m as { role?: string }).role === "user",
    )!;
    expect(lastUserMsg.content).toContain("<context>");
    expect(lastUserMsg.content).toContain("### File: snippet.ts");
    expect(lastUserMsg.content).toContain("export const greet");
    expect(lastUserMsg.content).toContain("</context>");
    // Original prompt still present after the context block.
    expect(lastUserMsg.content).toContain("Explain greet");
  });

  it("leaves the prompt untouched when no mentions are present", async () => {
    const res = await POST(
      makeReq({
        prompt: "Hello there",
        history: [],
        provider: "groq",
        model: "test-model",
        workspaceRoot: tmpRoot,
      }),
    );
    expect(res.status).toBe(200);
    await drain(res.body!);

    const lastUserMsg = captured.messages.find(
      (m: unknown): m is { role: string; content: string } =>
        typeof m === "object" && m !== null && (m as { role?: string }).role === "user",
    )!;
    expect(lastUserMsg.content).toBe("Hello there");
    expect(lastUserMsg.content).not.toContain("<context>");
  });
});
