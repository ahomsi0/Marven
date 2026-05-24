export const EMBED_MODEL = "nomic-embed-text";
export const EMBED_DIM = 768;

const DEFAULT_OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";

export interface EmbedderOptions {
  ollamaUrl?: string;
  model?: string;
  batchSize?: number;
}

export class Embedder {
  private readonly url: string;
  private readonly model: string;
  private readonly batchSize: number;

  constructor(opts: EmbedderOptions = {}) {
    this.url = (opts.ollamaUrl ?? DEFAULT_OLLAMA).replace(/\/$/, "");
    this.model = opts.model ?? EMBED_MODEL;
    this.batchSize = Math.max(1, opts.batchSize ?? 8);
  }

  async ensureModelInstalled(): Promise<{ ok: boolean; error?: string }> {
    try {
      const tagsRes = await fetch(`${this.url}/api/tags`);
      if (!tagsRes.ok) return { ok: false, error: `tags ${tagsRes.status}` };
      const data = (await tagsRes.json()) as { models?: Array<{ name: string }> };
      const has = (data.models ?? []).some((m) => m.name.split(":")[0] === this.model);
      if (has) return { ok: true };
      const pull = await fetch(`${this.url}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.model }),
      });
      if (!pull.ok) return { ok: false, error: `pull ${pull.status}` };
      // Drain stream so the pull actually completes.
      if (pull.body) {
        const reader = (pull.body as any).getReader?.();
        if (reader) {
          while (true) {
            const { done } = await reader.read();
            if (done) break;
          }
        } else {
          await pull.text();
        }
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async embed(text: string): Promise<Float32Array> {
    let res: Response;
    try {
      res = await fetch(`${this.url}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
    } catch (e) {
      throw new Error(
        `Could not connect to Ollama at ${this.url}. Is it running? (${e instanceof Error ? e.message : e})`,
      );
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama /api/embeddings ${res.status}: ${body}`);
    }
    const data = (await res.json()) as { embedding: number[] };
    if (!Array.isArray(data.embedding)) throw new Error("Ollama returned no embedding");
    return Float32Array.from(data.embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = new Array(texts.length);
    let i = 0;
    while (i < texts.length) {
      const slice = texts.slice(i, i + this.batchSize);
      const start = i;
      const vecs = await Promise.all(slice.map((t) => this.embed(t)));
      for (let k = 0; k < vecs.length; k++) out[start + k] = vecs[k];
      i += this.batchSize;
    }
    return out;
  }
}
