import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOllamaMessages,
  clearOllamaCapabilityCache,
  ollamaBaseUrl,
  ollamaModelSupportsVision,
  streamOllama,
} from "./ollama";
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

const PNG = { base64: "data:image/png;base64,AAA", mimeType: "image/png" as const, name: "a.png" };

describe("buildOllamaMessages with vision", () => {
  it("puts images on the user message as bare base64 when the model can see", () => {
    expect(
      buildOllamaMessages([{ role: "user", content: "look", attachments: [PNG] }], "sys", { vision: true }),
    ).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "look", images: ["AAA"] },
    ]);
  });

  it("never puts images on assistant messages", () => {
    const out = buildOllamaMessages([{ role: "assistant", content: "ok", attachments: [PNG] }], "sys", { vision: true });
    expect(out[1]).toEqual({ role: "assistant", content: "ok" });
  });
});

describe("ollamaModelSupportsVision", () => {
  afterEach(() => clearOllamaCapabilityCache());

  const showResponse = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("trusts /api/show capabilities and caches the answer per model", async () => {
    vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:4444");
    const fetchMock = vi.fn(async () => showResponse({ capabilities: ["completion", "vision"] }));
    vi.stubGlobal("fetch", fetchMock);

    // The name says text-only; the server says vision, and wins.
    expect(await ollamaModelSupportsVision("my-custom-model")).toBe(true);
    expect(await ollamaModelSupportsVision("my-custom-model")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4444/api/show");
    expect(JSON.parse(init.body as string)).toEqual({ model: "my-custom-model" });
  });

  it("says no when capabilities lack vision, even for a vision-sounding name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => showResponse({ capabilities: ["completion"] })));
    expect(await ollamaModelSupportsVision("llava-but-not-really")).toBe(false);
  });

  it("falls back to the name heuristic when capabilities are missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => showResponse({ details: {} })));
    expect(await ollamaModelSupportsVision("llava:7b")).toBe(true);
    expect(await ollamaModelSupportsVision("phi3")).toBe(false);
  });

  it("falls back to the heuristic on errors without caching them", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await ollamaModelSupportsVision("gemma3:4b")).toBe(true);
    expect(await ollamaModelSupportsVision("gemma3:4b")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal("fetch", vi.fn(async () => showResponse({ error: "not found" }, 404)));
    expect(await ollamaModelSupportsVision("phi3")).toBe(false);
  });
});

describe("streamOllama with images", () => {
  afterEach(() => clearOllamaCapabilityCache());

  const chatBody = (fetchMock: ReturnType<typeof vi.fn>) => {
    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/chat")) as unknown as [string, RequestInit];
    return JSON.parse(call[1].body as string);
  };

  it("asks /api/show, then sends the images to a vision model", async () => {
    vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:5555");
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/api/show")
        ? new Response(JSON.stringify({ capabilities: ["completion", "vision"] }), { status: 200 })
        : ndjson([{ message: { role: "assistant", content: "A cat." }, done: true }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const raw = await new Response(
      streamOllama([{ role: "user", content: "what is it?", attachments: [PNG] }], "llava", "sys"),
    ).text();
    expect(parseChatStream(raw, true).text).toBe("A cat.");
    expect(chatBody(fetchMock).messages[1]).toEqual({ role: "user", content: "what is it?", images: ["AAA"] });
  });

  it("strips images for a text-only model", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/api/show")
        ? new Response(JSON.stringify({ capabilities: ["completion"] }), { status: 200 })
        : ndjson([{ message: { role: "assistant", content: "ok" }, done: true }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new Response(streamOllama([{ role: "user", content: "see?", attachments: [PNG] }], "phi3", "sys")).text();
    const sent = chatBody(fetchMock).messages[1];
    expect(sent.images).toBeUndefined();
    expect(sent.content).toContain("Image attachment removed");
  });
});
