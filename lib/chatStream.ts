// The /api/chat streaming wire format, shared by the server (provider
// streams) and the client (the chat page).
//
// The body is plain text: the reply's tokens, optionally followed by ONE
// trailing sentinel line carrying JSON —
//   "\n\n__USAGE__{...}"  token counts, when the reply finished
//   "\n\n__ERROR__{...}"  the provider failed (after the 200 had already started)
// Errors travel in-band because once the response has started, the HTTP status
// can't change; erroring the stream instead just looks like a dropped
// connection to the browser.

export const USAGE_SENTINEL = "\n\n__USAGE__";
export const ERROR_SENTINEL = "\n\n__ERROR__";

export interface StreamUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** A provider failure, safe to show the user (no keys, short). */
export interface StreamError {
  provider: string;
  model?: string;
  status?: number;
  /** Provider error code/type, or "unreachable" / "timeout" for network failures. */
  code?: string;
  message: string;
}

/** A non-2xx answer from a provider's HTTP API. */
export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Provider error (${status})`);
  }
}

/** A provider took too long to answer. */
export class ProviderTimeoutError extends Error {
  readonly code = "timeout";
  constructor(message = "The request timed out.") {
    super(message);
  }
}

// ─── Server side ─────────────────────────────────────────────────────────────

const MAX_ERROR_MESSAGE = 300;
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/** Remove anything that looks like a credential, collapse whitespace, cap length. */
export function sanitizeErrorText(text: string): string {
  let out = text
    .replace(/<[^>]+>/g, " ") // HTML error pages
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(?:sk-(?:ant-|or-|proj-)?|gsk_|nvapi-|xai-)[A-Za-z0-9_\-*.]{6,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9]{32,}\b/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > MAX_ERROR_MESSAGE) out = `${out.slice(0, MAX_ERROR_MESSAGE - 1)}…`;
  return out;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number") return String(v);
  return undefined;
}

/** Pull `{ message, code }` out of a provider's error body (JSON object or text). */
function parseErrorBody(body: unknown): { message?: string; code?: string } {
  if (typeof body === "string") {
    try {
      return parseErrorBody(JSON.parse(body));
    } catch {
      return { message: body };
    }
  }
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const inner = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>) : undefined;
  return {
    message:
      asString(inner?.message) ?? asString(b.message) ?? asString(b.error) ?? asString(b.detail),
    code: asString(inner?.code) ?? asString(inner?.type) ?? asString(b.code) ?? asString(b.type),
  };
}

function isConnectionError(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown }; message?: unknown };
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === "string" && CONNECTION_CODES.has(code)) return true;
  if (e?.name === "APIConnectionError") return true;
  return typeof e?.message === "string" && /fetch failed|connection error|ECONNREFUSED/i.test(e.message);
}

function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: unknown; code?: unknown };
  return e?.code === "timeout" || e?.name === "TimeoutError" || e?.name === "APIConnectionTimeoutError";
}

/**
 * Turn whatever a provider threw into a StreamError: the HTTP status, the
 * provider's own message (from its JSON body when there is one), and a code.
 */
export function describeProviderError(err: unknown, provider: string, model?: string): StreamError {
  const e = (err ?? {}) as { status?: unknown; error?: unknown; message?: unknown };
  const status = typeof e.status === "number" ? e.status : err instanceof ProviderHttpError ? err.status : undefined;

  let { message, code } =
    err instanceof ProviderHttpError
      ? parseErrorBody(err.body)
      : e.error && typeof e.error === "object"
        ? parseErrorBody(e.error) // OpenAI / Anthropic SDK APIError
        : {};
  if (!message) message = err instanceof Error ? err.message : asString(err) ?? "";
  // SDK messages start with the status ("401 Incorrect API key…").
  if (status) message = message.replace(new RegExp(`^${status}\\s+`), "");

  if (status === undefined) {
    if (isTimeoutError(err)) code = "timeout";
    else if (isConnectionError(err)) code = "unreachable";
  }

  return {
    provider,
    ...(model ? { model } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(code ? { code } : {}),
    message: sanitizeErrorText(message) || "Unknown error",
  };
}

/**
 * Build a chat response stream. `run` pulls from the provider and calls `emit`
 * for each piece of text; it may return token usage. Whatever happens, the
 * stream ends cleanly: usage → USAGE sentinel, a throw → ERROR sentinel, the
 * caller going away (signal / cancel) → `run`'s signal aborts and the stream
 * just closes.
 */
export function providerStream(
  info: { provider: string; model?: string; signal?: AbortSignal },
  run: (emit: (text: string) => void, signal: AbortSignal) => Promise<StreamUsage | null | void>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  if (info.signal?.aborted) abort.abort();
  else info.signal?.addEventListener("abort", onAbort, { once: true });
  let closed = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (text: string) => {
        if (closed || !text) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      try {
        const usage = await run(push, abort.signal);
        if (usage && !abort.signal.aborted) push(`${USAGE_SENTINEL}${JSON.stringify(usage)}`);
      } catch (err) {
        if (!abort.signal.aborted) {
          const described = describeProviderError(err, info.provider, info.model);
          console.error(`[chat] ${info.provider} stream failed:`, described);
          push(`${ERROR_SENTINEL}${JSON.stringify(described)}`);
        }
      } finally {
        info.signal?.removeEventListener("abort", onAbort);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* already cancelled */
          }
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });
}

/**
 * Read an OpenAI-compatible SSE body (Groq, OpenRouter, NIM), emitting the
 * text deltas. Returns usage if the provider sent it. An `error` object in the
 * stream (OpenRouter does this mid-stream) is thrown.
 */
export async function readOpenAICompatibleSse(
  body: ReadableStream<Uint8Array>,
  emit: (text: string) => void,
): Promise<StreamUsage | null> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let usage: StreamUsage | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    let json: {
      error?: { code?: unknown; message?: unknown };
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    try {
      json = JSON.parse(data);
    } catch {
      return; // skip malformed chunks
    }
    if (json.error) {
      const status = typeof json.error.code === "number" ? json.error.code : 502;
      throw new ProviderHttpError(status, JSON.stringify(json));
    }
    if (json.usage) {
      usage = {
        prompt_tokens: json.usage.prompt_tokens ?? 0,
        completion_tokens: json.usage.completion_tokens ?? 0,
        total_tokens: json.usage.total_tokens ?? 0,
      };
    }
    const delta = json.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta) emit(delta);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    buffer += dec.decode();
    if (buffer) handleLine(buffer);
  } finally {
    reader.releaseLock();
  }
  return usage;
}

// ─── Client side ─────────────────────────────────────────────────────────────

export interface ParsedChatStream {
  text: string;
  usage: StreamUsage | null;
  error: StreamError | null;
}

/**
 * Split the raw body received so far into reply text and the trailing
 * sentinel. While streaming (`final` false) a partial sentinel at the very end
 * is held back so "\n\n__US" never flashes in the thread.
 */
export function parseChatStream(raw: string, final = false): ParsedChatStream {
  const usageIdx = raw.indexOf(USAGE_SENTINEL);
  const errorIdx = raw.indexOf(ERROR_SENTINEL);
  const idx =
    usageIdx === -1 ? errorIdx : errorIdx === -1 ? usageIdx : Math.min(usageIdx, errorIdx);

  if (idx === -1) {
    let text = raw;
    if (!final) {
      for (const sentinel of [USAGE_SENTINEL, ERROR_SENTINEL]) {
        for (let k = sentinel.length - 1; k > 0; k--) {
          if (text.endsWith(sentinel.slice(0, k))) {
            text = text.slice(0, text.length - k);
            break;
          }
        }
      }
    }
    return { text, usage: null, error: null };
  }

  const text = raw.slice(0, idx);
  const isError = idx === errorIdx;
  const payload = raw.slice(idx + (isError ? ERROR_SENTINEL : USAGE_SENTINEL).length).trim();
  let parsed: unknown = null;
  try {
    parsed = payload ? JSON.parse(payload) : null;
  } catch {
    // Incomplete JSON while streaming; if it's still broken at the end, an
    // error sentinel still counts as an error.
    if (isError && final) parsed = { provider: "The provider", message: "Unknown error" };
  }

  if (isError) {
    const e = parsed as Partial<StreamError> | null;
    const error: StreamError | null =
      e && typeof e === "object"
        ? {
            provider: typeof e.provider === "string" ? e.provider : "The provider",
            ...(typeof e.model === "string" ? { model: e.model } : {}),
            ...(typeof e.status === "number" ? { status: e.status } : {}),
            ...(typeof e.code === "string" ? { code: e.code } : {}),
            message: typeof e.message === "string" ? e.message : "Unknown error",
          }
        : null;
    return { text, usage: null, error };
  }

  const u = parsed as Partial<StreamUsage> | null;
  const usage: StreamUsage | null =
    u && typeof u === "object"
      ? {
          prompt_tokens: Number(u.prompt_tokens) || 0,
          completion_tokens: Number(u.completion_tokens) || 0,
          total_tokens: Number(u.total_tokens) || 0,
        }
      : null;
  return { text, usage, error: null };
}
