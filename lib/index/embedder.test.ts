import { describe, it, expect, vi, afterEach } from "vitest";
import { Embedder, EMBED_DIM } from "./embedder";

const ORIG_FETCH = global.fetch;
afterEach(() => {
  global.fetch = ORIG_FETCH;
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  global.fetch = vi.fn(async (input: any, init?: any) =>
    handler(typeof input === "string" ? input : input.url, init),
  ) as any;
}

describe("Embedder.embed", () => {
  it("POSTs to /api/embeddings with model+prompt and returns Float32Array", async () => {
    mockFetch(async (url, init) => {
      expect(url).toBe("http://localhost:11434/api/embeddings");
      const body = JSON.parse(init!.body as string);
      expect(body.model).toBe("nomic-embed-text");
      expect(body.prompt).toBe("hello");
      const arr = new Array(EMBED_DIM).fill(0).map((_, i) => i / EMBED_DIM);
      return new Response(JSON.stringify({ embedding: arr }), { status: 200 });
    });
    const e = new Embedder();
    const v = await e.embed("hello");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(EMBED_DIM);
    expect(v[0]).toBeCloseTo(0);
  });
  it("rejects when Ollama unreachable", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;
    await expect(new Embedder().embed("x")).rejects.toThrow(/Ollama|connect/i);
  });
});

describe("Embedder.embedBatch", () => {
  it("preserves order and respects batchSize concurrency", async () => {
    let inflight = 0,
      maxInflight = 0;
    mockFetch(async (_url, init) => {
      inflight++;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      const body = JSON.parse(init!.body as string);
      const arr = new Array(EMBED_DIM).fill(body.prompt.length);
      inflight--;
      return new Response(JSON.stringify({ embedding: arr }), { status: 200 });
    });
    const e = new Embedder({ batchSize: 3 });
    const out = await e.embedBatch(["a", "bb", "ccc", "dddd", "eeeee"]);
    expect(out.map((v) => v[0])).toEqual([1, 2, 3, 4, 5]);
    expect(maxInflight).toBeLessThanOrEqual(3);
  });
});

describe("Embedder.ensureModelInstalled", () => {
  it("returns ok:true if model already in /api/tags", async () => {
    mockFetch(async (url) => {
      expect(url).toBe("http://localhost:11434/api/tags");
      return new Response(
        JSON.stringify({ models: [{ name: "nomic-embed-text:latest" }] }),
        { status: 200 },
      );
    });
    const r = await new Embedder().ensureModelInstalled();
    expect(r.ok).toBe(true);
  });
  it("pulls when missing", async () => {
    const calls: string[] = [];
    mockFetch(async (url) => {
      calls.push(url);
      if (url.endsWith("/api/tags"))
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      if (url.endsWith("/api/pull"))
        return new Response('{"status":"success"}\n', { status: 200 });
      throw new Error("unexpected");
    });
    const r = await new Embedder().ensureModelInstalled();
    expect(r.ok).toBe(true);
    expect(calls).toEqual([
      "http://localhost:11434/api/tags",
      "http://localhost:11434/api/pull",
    ]);
  });
});
