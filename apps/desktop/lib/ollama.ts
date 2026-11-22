// Ollama integration helper
// DEFAULT_MODEL is used as the initial selection in the UI.
// The active model is chosen by the user at runtime.

import type { HistoryMessage, ImageAttachment } from "@/types";
import { stripAttachments } from "@/lib/imageHelpers";
import { isLikelyVisionModel } from "@/lib/visionModels";
import {
  ProviderHttpError,
  ProviderTimeoutError,
  providerStream,
  type StreamUsage,
} from "@/lib/chatStream";

export const DEFAULT_MODEL = "phi3";

/** Read per call: Electron's applySettings can change it while the server runs. */
export function ollamaBaseUrl(): string {
  return process.env.OLLAMA_URL ?? "http://localhost:11434";
}

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

// A non-streamed generation has to finish within this; a cold model load plus
// a long answer on a slow machine can take a while, so it's generous.
const GENERATE_TIMEOUT_MS = 5 * 60_000;
// Streaming chat: the first response (headers) can wait on a cold model load;
// after that, a long silence between chunks means Ollama is stuck.
const CHAT_FIRST_RESPONSE_TIMEOUT_MS = 3 * 60_000;
const CHAT_IDLE_TIMEOUT_MS = 2 * 60_000;
const TAGS_TIMEOUT_MS = 5_000;
const SHOW_TIMEOUT_MS = 3_000;

export async function askOllama(
  prompt: string,
  model: string,
  attachments?: ImageAttachment[],
  signal?: AbortSignal
): Promise<string> {
  const safePrompt = attachments?.length
    ? stripAttachments(prompt, attachments)
    : prompt;
  let response: Response;
  const timeout = AbortSignal.timeout(GENERATE_TIMEOUT_MS);

  try {
    response = await fetch(`${ollamaBaseUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: safePrompt, stream: false }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (timeout.aborted) throw new Error("Ollama took too long to respond.");
    throw new Error(
      "Could not connect to Ollama. Make sure it is running with: ollama serve"
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Ollama returned an error (${response.status}): ${text || "Unknown error"}`
    );
  }

  const data = await response.json();
  return (data.response as string).trim();
}

export type OllamaChatMessage = { role: string; content: string; images?: string[] };

/** Base64 image data without the `data:<mime>;base64,` prefix, as `/api/chat` wants it. */
export function ollamaImageData(attachments: ImageAttachment[]): string[] {
  return attachments.map((a) => a.base64.replace(/^data:[^;]+;base64,/, ""));
}

/**
 * The `/api/chat` messages for a conversation: system prompt, then history.
 * Images go on their user message as `images` when the model can see them;
 * otherwise they're dropped with a note in the text.
 */
export function buildOllamaMessages(
  messages: HistoryMessage[],
  systemPrompt?: string,
  { vision = false }: { vision?: boolean } = {}
): OllamaChatMessage[] {
  return [
    { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
    ...messages.map((m): OllamaChatMessage => {
      if (m.role !== "user" || !m.attachments?.length) return { role: m.role, content: m.content };
      return vision
        ? { role: m.role, content: m.content, images: ollamaImageData(m.attachments) }
        : { role: m.role, content: stripAttachments(m.content, m.attachments) };
    }),
  ];
}

// Per model (and server), for the life of the process. Failures aren't kept,
// so a model checked while Ollama was down is asked again next time.
const visionCache = new Map<string, Promise<boolean>>();

/** Test hook: forget cached capability answers. */
export function clearOllamaCapabilityCache(): void {
  visionCache.clear();
}

/**
 * Whether an Ollama model accepts images. `/api/show` lists `capabilities`
 * (e.g. ["completion", "vision"]) on Ollama 0.6+, which is authoritative; on
 * older servers, or if the request fails, the name heuristic decides.
 */
export function ollamaModelSupportsVision(model: string): Promise<boolean> {
  const key = `${ollamaBaseUrl()} ${model}`;
  const cached = visionCache.get(key);
  if (cached) return cached;
  const pending = (async () => {
    const res = await fetch(`${ollamaBaseUrl()}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(SHOW_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Ollama /api/show returned ${res.status}`);
    const data = (await res.json()) as { capabilities?: unknown };
    return Array.isArray(data.capabilities)
      ? data.capabilities.includes("vision")
      : isLikelyVisionModel("ollama", model);
  })().catch(() => {
    if (visionCache.get(key) === pending) visionCache.delete(key);
    return isLikelyVisionModel("ollama", model);
  });
  visionCache.set(key, pending);
  return pending;
}

/**
 * Read Ollama's NDJSON chat stream, emitting each piece of the reply. Returns
 * usage from the final `done` line. An `{ error }` line is thrown.
 */
export async function readOllamaChatStream(
  body: ReadableStream<Uint8Array>,
  emit: (text: string) => void,
  onActivity: () => void = () => {}
): Promise<StreamUsage | null> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let usage: StreamUsage | null = null;

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let json: {
      error?: unknown;
      message?: { content?: unknown };
      done?: boolean;
      prompt_eval_count?: number;
      eval_count?: number;
    };
    try {
      json = JSON.parse(trimmed);
    } catch {
      return; // skip malformed lines
    }
    if (json.error) throw new ProviderHttpError(500, trimmed);
    const content = json.message?.content;
    if (typeof content === "string" && content) emit(content);
    if (json.done) {
      const prompt = json.prompt_eval_count ?? 0;
      const completion = json.eval_count ?? 0;
      usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      buffer += dec.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
    }
    buffer += dec.decode();
    handleLine(buffer);
  } finally {
    reader.releaseLock();
  }
  return usage;
}

/**
 * Stream a chat reply from Ollama's `/api/chat` with the conversation history
 * and system prompt, in the lib/chatStream wire format.
 */
export function streamOllama(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const url = `${ollamaBaseUrl()}/api/chat`;
  const hasImages = messages.some((m) => m.role === "user" && m.attachments?.length);

  return providerStream({ provider: "Ollama", model, signal }, async (emit, signal) => {
    const vision = hasImages ? await ollamaModelSupportsVision(model) : false;
    const body = JSON.stringify({
      model,
      messages: buildOllamaMessages(messages, systemPrompt, { vision }),
      stream: true,
      options: { temperature: 0.7 },
    });
    const timeout = new AbortController();
    let timer = setTimeout(() => timeout.abort(), CHAT_FIRST_RESPONSE_TIMEOUT_MS);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => timeout.abort(), CHAT_IDLE_TIMEOUT_MS);
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.any([signal, timeout.signal]),
      });
      if (!res.ok) {
        throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
      }
      if (!res.body) return null;
      bump();
      return await readOllamaChatStream(res.body, emit, bump);
    } catch (err) {
      if (timeout.signal.aborted && !signal.aborted) {
        throw new ProviderTimeoutError("Ollama stopped responding.");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function fetchInstalledModels(): Promise<{ name: string; size: number }[]> {
  let response: Response;

  try {
    response = await fetch(`${ollamaBaseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not connect to Ollama.");
  }

  if (!response.ok) {
    throw new Error(`Ollama /api/tags returned ${response.status}`);
  }

  const data = await response.json();
  // Each entry has { name, size, digest, modified_at, ... }
  return (data.models ?? []).map((m: { name: string; size: number }) => ({
    name: m.name,
    size: m.size,
  }));
}
