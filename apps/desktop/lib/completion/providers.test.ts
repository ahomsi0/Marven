import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { completeOnce, _postProcess } from "./providers";
import type { FimPrompt } from "./fimPrompt";

const chatPrompt: FimPrompt = {
  format: "plain",
  messages: [
    { role: "system", content: "sys" },
    { role: "user", content: "usr" },
  ],
  stop: ["\n\n"],
};

const fimPrompt: FimPrompt = {
  format: "qwen-fim",
  raw: "<|fim_prefix|>p<|fim_suffix|>s<|fim_middle|>",
  stop: ["<|endoftext|>"],
};

function mockFetch(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    text: async () => "err",
    json: async () => body,
  } as unknown as Response);
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.ANTHROPIC_API_KEY = "ant-test";
  process.env.GROQ_API_KEY = "gk-test";
  process.env.OPENROUTER_API_KEY = "or-test";
  process.env.NIM_API_KEY = "nim-test";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("completeOnce — providers", () => {
  it("openai POSTs to /v1/chat/completions", async () => {
    const f = mockFetch({
      choices: [{ message: { content: "hello" } }],
    });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "openai",
      model: "gpt-4o-mini",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("hello");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("/v1/chat/completions");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages.length).toBe(2);
  });

  it("anthropic POSTs to /v1/messages with system+user", async () => {
    const f = mockFetch({ content: [{ text: "hi", type: "text" }] });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "anthropic",
      model: "claude-haiku-3-5",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("hi");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("/v1/messages");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.system).toBe("sys");
    expect(body.messages[0].content).toBe("usr");
  });

  it("ollama uses /api/chat for plain format", async () => {
    const f = mockFetch({ message: { content: "ans" } });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "ollama",
      model: "llama3",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("ans");
    expect(String(f.mock.calls[0][0])).toContain("/api/chat");
  });

  it("ollama uses /api/generate for FIM format", async () => {
    const f = mockFetch({ response: "ans2" });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "ollama",
      model: "qwen2.5-coder",
      prompt: fimPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("ans2");
    expect(String(f.mock.calls[0][0])).toContain("/api/generate");
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.prompt).toBe(fimPrompt.raw);
  });

  it("lmstudio POSTs to /v1/chat/completions for plain", async () => {
    const f = mockFetch({ choices: [{ message: { content: "lm" } }] });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "lmstudio",
      model: "any",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("lm");
    expect(String(f.mock.calls[0][0])).toContain("/v1/chat/completions");
  });

  it("lmstudio uses /v1/completions for raw FIM", async () => {
    const f = mockFetch({ choices: [{ text: "raw" }] });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "lmstudio",
      model: "any",
      prompt: fimPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("raw");
    expect(String(f.mock.calls[0][0])).toContain("/v1/completions");
  });

  it("llamaserver POSTs to /v1/chat/completions", async () => {
    const f = mockFetch({ choices: [{ message: { content: "ls" } }] });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "llamaserver",
      model: "any",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("ls");
  });

  it("groq POSTs to /v1/chat/completions", async () => {
    const f = mockFetch({ choices: [{ message: { content: "g" } }] });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "groq",
      model: "llama-3.1-8b-instant",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("g");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("groq");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer gk-test",
    });
  });

  it("openrouter POSTs to /v1/chat/completions", async () => {
    const f = mockFetch({ choices: [{ message: { content: "or" } }] });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "openrouter",
      model: "anthropic/claude-haiku",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("or");
    expect(String(f.mock.calls[0][0])).toContain("openrouter");
  });

  it("nim POSTs to /v1/chat/completions", async () => {
    const f = mockFetch({ choices: [{ message: { content: "n" } }] });
    vi.stubGlobal("fetch", f);
    const out = await completeOnce({
      provider: "nim",
      model: "meta/llama3",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("n");
    expect(String(f.mock.calls[0][0])).toContain("integrate.api.nvidia.com");
  });

  it("forwards AbortSignal to fetch", async () => {
    const f = mockFetch({ choices: [{ message: { content: "x" } }] });
    vi.stubGlobal("fetch", f);
    const ctrl = new AbortController();
    await completeOnce({
      provider: "openai",
      model: "x",
      prompt: chatPrompt,
      signal: ctrl.signal,
    });
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(ctrl.signal);
  });

  it("returns empty string on AbortError", async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(err));
    const out = await completeOnce({
      provider: "openai",
      model: "x",
      prompt: chatPrompt,
      signal: new AbortController().signal,
    });
    expect(out).toBe("");
  });
});

describe("postProcess", () => {
  it("strips triple-backtick code fences", () => {
    expect(_postProcess("```ts\nfoo\n```", "")).toBe("foo");
  });

  it('strips "Here is" prefix', () => {
    expect(_postProcess("Here is the code:\nfoo", "")).toBe("foo");
  });

  it("drops suffix echo at start of completion", () => {
    expect(_postProcess("}\n  more", "\n}")).toBe("  more");
  });

  it("trims trailing </code>", () => {
    expect(_postProcess("foo</code>", "")).toBe("foo");
  });
});
