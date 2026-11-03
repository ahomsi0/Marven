import { describe, it, expect, vi } from "vitest";
import {
  ERROR_SENTINEL,
  ProviderHttpError,
  ProviderTimeoutError,
  USAGE_SENTINEL,
  describeProviderError,
  parseChatStream,
  providerStream,
  readOpenAICompatibleSse,
  sanitizeErrorText,
} from "./chatStream";

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function bodyOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      c.close();
    },
  });
}

describe("sanitizeErrorText", () => {
  it("redacts things that look like keys and caps the length", () => {
    const out = sanitizeErrorText("Incorrect API key provided: sk-proj-abc123def456ghi. Bearer gsk_secret");
    expect(out).not.toContain("abc123def456ghi");
    expect(out).not.toContain("gsk_secret");
    expect(sanitizeErrorText("x".repeat(1000)).length).toBeLessThanOrEqual(300);
  });

  it("keeps model ids readable", () => {
    expect(sanitizeErrorText("The model `mistral-large-3-675b-instruct-2512` does not exist")).toContain(
      "mistral-large-3-675b-instruct-2512",
    );
  });
});

describe("describeProviderError", () => {
  it("reads status, message and code from an OpenAI-style HTTP error body", () => {
    const err = new ProviderHttpError(
      401,
      JSON.stringify({ error: { message: "Invalid API Key", type: "invalid_request_error", code: "invalid_api_key" } }),
    );
    expect(describeProviderError(err, "Groq", "llama-3.3-70b-versatile")).toEqual({
      provider: "Groq",
      model: "llama-3.3-70b-versatile",
      status: 401,
      code: "invalid_api_key",
      message: "Invalid API Key",
    });
  });

  it("handles Ollama's plain `{ error }` body", () => {
    const err = new ProviderHttpError(404, JSON.stringify({ error: 'model "phi3" not found, try pulling it first' }));
    expect(describeProviderError(err, "Ollama").message).toBe('model "phi3" not found, try pulling it first');
  });

  it("handles SDK errors that carry status + a parsed error body", () => {
    // Anthropic SDK shape: error is the whole body.
    const anthropicErr = Object.assign(new Error('401 {"type":"error"}'), {
      status: 401,
      error: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
    });
    expect(describeProviderError(anthropicErr, "Anthropic")).toMatchObject({
      status: 401,
      code: "authentication_error",
      message: "invalid x-api-key",
    });
    // OpenAI SDK shape: error is body.error; message has the status prefix.
    const openaiErr = Object.assign(new Error("429 Rate limit reached"), { status: 429 });
    expect(describeProviderError(openaiErr, "OpenAI")).toMatchObject({ status: 429, message: "Rate limit reached" });
  });

  it("marks connection failures and timeouts", () => {
    const refused = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    expect(describeProviderError(refused, "Ollama").code).toBe("unreachable");
    expect(describeProviderError(new ProviderTimeoutError(), "Ollama").code).toBe("timeout");
  });
});

describe("providerStream", () => {
  it("streams the text and appends the usage sentinel", async () => {
    const stream = providerStream({ provider: "Groq" }, async (emit) => {
      emit("Hel");
      emit("lo");
      return { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 };
    });
    const raw = await readAll(stream);
    expect(raw).toBe(`Hello${USAGE_SENTINEL}{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}`);
  });

  it("turns a provider failure into an error sentinel instead of erroring the stream", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = providerStream({ provider: "Groq", model: "m" }, async (emit) => {
      emit("partial");
      throw new ProviderHttpError(429, '{"error":{"message":"Slow down"}}');
    });
    const parsed = parseChatStream(await readAll(stream), true);
    expect(parsed.text).toBe("partial");
    expect(parsed.error).toEqual({ provider: "Groq", model: "m", status: 429, message: "Slow down" });
  });

  it("aborts the provider call when the caller's signal aborts, and closes quietly", async () => {
    const caller = new AbortController();
    let seen: AbortSignal | null = null;
    const stream = providerStream({ provider: "Groq", signal: caller.signal }, (emit, signal) => {
      seen = signal;
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const done = readAll(stream);
    caller.abort();
    expect(await done).toBe("");
    expect(seen!.aborted).toBe(true);
  });

  it("aborts the provider call when the stream is cancelled", async () => {
    let seen: AbortSignal | null = null;
    const stream = providerStream({ provider: "Groq" }, (emit, signal) => {
      seen = signal;
      return new Promise(() => {});
    });
    await stream.cancel();
    expect(seen!.aborted).toBe(true);
  });
});

describe("readOpenAICompatibleSse", () => {
  it("joins deltas split across network chunks and reads usage", async () => {
    const emitted: string[] = [];
    const usage = await readOpenAICompatibleSse(
      bodyOf([
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choi',
        'ces":[{"delta":{"content":" there"}}]}\n\n',
        'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\ndata: [DONE]\n\n',
      ]),
      (t) => emitted.push(t),
    );
    expect(emitted.join("")).toBe("Hi there");
    expect(usage).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
  });

  it("throws when the stream carries an error object", async () => {
    const err = await readOpenAICompatibleSse(
      bodyOf(['data: {"error":{"code":502,"message":"Upstream failed"}}\n\n']),
      () => {},
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.status).toBe(502);
  });
});

describe("parseChatStream", () => {
  it("returns plain text when there's no sentinel", () => {
    expect(parseChatStream("hello")).toEqual({ text: "hello", usage: null, error: null });
  });

  it("holds back a partial sentinel while streaming, but not at the end", () => {
    expect(parseChatStream("hello\n\n__US").text).toBe("hello");
    expect(parseChatStream("hello\n\n__ERR").text).toBe("hello");
    expect(parseChatStream("hello\n", true).text).toBe("hello\n");
  });

  it("splits off usage", () => {
    const parsed = parseChatStream(`hi${USAGE_SENTINEL}{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}`, true);
    expect(parsed.text).toBe("hi");
    expect(parsed.usage).toEqual({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
  });

  it("splits off an error", () => {
    const parsed = parseChatStream(`${ERROR_SENTINEL}{"provider":"Groq","status":401,"message":"bad key"}`, true);
    expect(parsed.text).toBe("");
    expect(parsed.error).toEqual({ provider: "Groq", status: 401, message: "bad key" });
  });

  it("still reports an error whose JSON got mangled", () => {
    expect(parseChatStream(`x${ERROR_SENTINEL}{"provid`, true).error).not.toBeNull();
  });
});
