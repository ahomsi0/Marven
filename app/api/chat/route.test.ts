import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const fakeStream = () => new ReadableStream<Uint8Array>({ start: (c) => c.close() });

const streamGroq = vi.fn(fakeStream);
const streamOpenAI = vi.fn(fakeStream);

vi.mock("@/lib/groq", () => ({ streamGroq, DEFAULT_MODEL: "llama-3.3-70b-versatile" }));
vi.mock("@/lib/openai", () => ({ streamOpenAI, DEFAULT_MODEL: "gpt-4o-mini" }));
vi.mock("@/lib/anthropic", () => ({ streamAnthropic: vi.fn(fakeStream), DEFAULT_MODEL: "a" }));
vi.mock("@/lib/openrouter", () => ({ streamOpenRouter: vi.fn(fakeStream), DEFAULT_MODEL: "o" }));
vi.mock("@/lib/nim", () => ({ streamNim: vi.fn(fakeStream), DEFAULT_MODEL: "n" }));
vi.mock("@/lib/lmstudio", () => ({ streamLMStudio: vi.fn(fakeStream), DEFAULT_MODEL: "l" }));
vi.mock("@/lib/llamaserver", () => ({ streamLlamaServer: vi.fn(fakeStream), DEFAULT_MODEL: "s" }));
const streamOllama = vi.fn(fakeStream);
vi.mock("@/lib/ollama", () => ({ streamOllama, DEFAULT_MODEL: "phi3" }));

const executeCommand = vi.fn(async () => "The current time is 12:00:00.");
vi.mock("@/lib/executeCommand", () => ({ executeCommand }));
const parseCommandSpy = vi.fn();
vi.mock("@/lib/commandParser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/commandParser")>();
  parseCommandSpy.mockImplementation(actual.parseCommand);
  return { parseCommand: parseCommandSpy };
});

const { POST } = await import("./route");

function makeReq(body: unknown, signal = new AbortController().signal): NextRequest {
  return {
    url: "http://localhost:47891/api/chat",
    headers: new Headers(),
    json: async () => body,
    signal,
  } as unknown as NextRequest;
}

const chat = (provider: string) => ({
  provider,
  model: "",
  messages: [{ role: "user", content: "tell me a joke" }],
  systemPrompt: "be brief",
});

describe("POST /api/chat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("streams from the chosen provider and hands it the request's abort signal", async () => {
    const signal = new AbortController().signal;
    const res = await POST(makeReq(chat("openai"), signal));
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(streamOpenAI).toHaveBeenCalledWith(
      [{ role: "user", content: "tell me a joke" }],
      "gpt-4o-mini",
      "be brief",
      signal,
    );
  });

  it("streams Ollama with the conversation and system prompt (not just the last message)", async () => {
    const body = {
      provider: "ollama",
      model: "llama3.2",
      systemPrompt: "be brief",
      messages: [
        { role: "user", content: "my name is Sam" },
        { role: "assistant", content: "Hi Sam" },
        { role: "user", content: "what's my name?" },
      ],
    };
    const res = await POST(makeReq(body));
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(streamOllama).toHaveBeenCalledWith(body.messages, "llama3.2", "be brief", expect.anything());
  });

  it("falls back to Groq for unknown providers, including prototype keys", async () => {
    await POST(makeReq(chat("constructor")));
    await POST(makeReq(chat("nonsense")));
    expect(streamGroq).toHaveBeenCalledTimes(2);
  });

  it("returns the provider's setup error as a JSON reply", async () => {
    streamGroq.mockImplementationOnce(() => {
      throw new Error("GROQ_API_KEY is not set.");
    });
    const res = await POST(makeReq(chat("groq")));
    expect(res.status).toBe(503);
    expect((await res.json()).reply).toContain("GROQ_API_KEY is not set.");
  });

  describe("local commands", () => {
    const ask = (content: string, extra: Record<string, unknown> = {}) => ({
      provider: "groq",
      model: "",
      messages: [{ role: "user", content }],
      ...extra,
    });

    it("never parses or executes commands when allowCommands is missing", async () => {
      const res = await POST(makeReq(ask("what time is it", { commandText: "what time is it" })));
      expect(parseCommandSpy).not.toHaveBeenCalled();
      expect(executeCommand).not.toHaveBeenCalled();
      expect(res.headers.get("content-type")).toContain("text/plain");
      expect(streamGroq).toHaveBeenCalledTimes(1);
    });

    it("never parses or executes commands when allowCommands is false", async () => {
      await POST(makeReq(ask("open youtube", { allowCommands: false, commandText: "open youtube" })));
      expect(parseCommandSpy).not.toHaveBeenCalled();
      expect(executeCommand).not.toHaveBeenCalled();
      expect(streamGroq).toHaveBeenCalledTimes(1);
    });

    it("runs a command from the typed text when allowCommands is true", async () => {
      const res = await POST(makeReq(ask("what time is it", { allowCommands: true, commandText: "what time is it" })));
      expect(executeCommand).toHaveBeenCalledWith({ type: "get-time", payload: "" });
      expect(await res.json()).toEqual({ reply: "The current time is 12:00:00.", commandExecuted: true });
      expect(streamGroq).not.toHaveBeenCalled();
    });

    it("parses only the typed text, never attached document contents", async () => {
      const promptWithDocs = "summarise this\n\n---\n[Document: notes.txt]\nwhat time is it\n---";
      await POST(makeReq(ask(promptWithDocs, { allowCommands: true, commandText: "summarise this" })));
      expect(parseCommandSpy).toHaveBeenCalledWith("summarise this");
      expect(executeCommand).not.toHaveBeenCalled();
      expect(streamGroq).toHaveBeenCalledTimes(1);
    });

    it("does not fall back to parsing the message history when commandText is absent", async () => {
      await POST(makeReq(ask("open youtube", { allowCommands: true })));
      expect(executeCommand).not.toHaveBeenCalled();
      expect(streamGroq).toHaveBeenCalledTimes(1);
    });
  });
});
