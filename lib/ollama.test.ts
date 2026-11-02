import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOllamaMessages, ollamaBaseUrl, streamOllama } from "./ollama";
import { parseChatStream } from "./chatStream";

function ndjson(lines: object[]): Response {
  const enc = new TextEncoder();
  const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  // Split mid-line to exercise buffering across chunks.
  const mid = Math.floor(text.length / 2);
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(text.slice(0, mid)));
      c.enqueue(enc.encode(text.slice(mid)));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("buildOllamaMessages", () => {
  it("puts the system prompt first and keeps the whole history", () => {
    expect(
      buildOllamaMessages(
        [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
          {
            role: "user",
            content: "look",
            attachments: [{ base64: "data:image/png;base64,AAA", mimeType: "image/png", name: "a.png" }],
          },
        ],
        "be brief",
      ),
    ).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: expect.stringContaining("Image attachment removed") },
    ]);
  });
});

describe("ollamaBaseUrl", () => {
  it("reads OLLAMA_URL on every call", () => {
    vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:1111");
    expect(ollamaBaseUrl()).toBe("http://127.0.0.1:1111");
    vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:2222");
    expect(ollamaBaseUrl()).toBe("http://127.0.0.1:2222");
  });
});

describe("streamOllama", () => {
  it("posts the conversation to /api/chat and streams the reply with usage", async () => {
    vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:3333");
    const fetchMock = vi.fn(async () =>
      ndjson([
        { message: { role: "assistant", content: "Your name " }, done: false },
        { message: { role: "assistant", content: "is Sam." }, done: false },
        { message: { role: "assistant", content: "" }, done: true, prompt_eval_count: 12, eval_count: 4 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const history = [
      { role: "user" as const, content: "my name is Sam" },
      { role: "assistant" as const, content: "Hi Sam" },
      { role: "user" as const, content: "what's my name?" },
    ];
    const raw = await new Response(streamOllama(history, "llama3.2", "be brief")).text();

    const parsed = parseChatStream(raw, true);
    expect(parsed.text).toBe("Your name is Sam.");
    expect(parsed.usage).toEqual({ prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:3333/api/chat");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("llama3.2");
    expect(sent.stream).toBe(true);
    expect(sent.messages).toEqual([{ role: "system", content: "be brief" }, ...history]);
  });

  it("reports a missing model as an error sentinel with the status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: 'model "nope" not found, try pulling it first' }), { status: 404 })),
    );
    const parsed = parseChatStream(await new Response(streamOllama([{ role: "user", content: "hi" }], "nope")).text(), true);
    expect(parsed.error).toMatchObject({ provider: "Ollama", model: "nope", status: 404 });
    expect(parsed.error?.message).toContain("not found");
  });

  it("reports Ollama not running as unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      }),
    );
    const parsed = parseChatStream(await new Response(streamOllama([{ role: "user", content: "hi" }], "m")).text(), true);
    expect(parsed.error).toMatchObject({ provider: "Ollama", code: "unreachable" });
  });
});
