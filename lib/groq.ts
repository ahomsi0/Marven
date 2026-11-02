// Groq API helper — server-side only (uses GROQ_API_KEY from .env.local)
// The key is never sent to the browser; all requests go through /api/chat.

import type { HistoryMessage } from "@/types";
import { groqUserMessageContent } from "@/lib/imageHelpers";
import { ProviderHttpError, providerStream, readOpenAICompatibleSse } from "@/lib/chatStream";

// 70B is the default because the agent loop (multi-step tool use) needs a model
// that reliably emits tool_calls and follows the full system prompt. The 8B
// "instant" model is far weaker at agentic work — keep it only as a manual pick
// for cheap/fast plain chat.
export const DEFAULT_MODEL = "llama-3.3-70b-versatile";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

// Fallback list used if the live Groq models API is unavailable — only
// long-standing production chat models, best first.
export const GROQ_MODELS = [
  { name: "llama-3.3-70b-versatile", size: 0 },
  { name: "openai/gpt-oss-120b",     size: 0 },
  { name: "qwen/qwen3-32b",          size: 0 },
  { name: "openai/gpt-oss-20b",      size: 0 },
  { name: "llama-3.1-8b-instant",    size: 0 },
];

// Speech, TTS and moderation models share the /models list but can't chat.
const NON_CHAT_MODEL_PATTERNS = [
  /whisper/i,      // speech-to-text (incl. distil-whisper)
  /tts/i,          // playai-tts and friends
  /orpheus/i,      // canopylabs/orpheus text-to-speech
  /guard/i,        // llama-guard, prompt-guard, gpt-oss-safeguard classifiers
  /transcribe/i,
];

export function isChatCapableGroqModel(id: string): boolean {
  return !NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(id));
}

// Best default first: strong general chat models that also handle the agent's
// tool calls. Anything not listed ranks after these.
const GROQ_PREFERRED_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "moonshotai/kimi-k2-instruct-0905",
  "moonshotai/kimi-k2-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-32b",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "openai/gpt-oss-20b",
  "llama-3.1-8b-instant",
];

// Unlisted models from these families still beat everything else.
const PREFERRED_FAMILIES = /llama|qwen|gpt-oss|kimi/i;

function paramBillions(id: string): number {
  const sizes = [...id.matchAll(/(\d+(?:\.\d+)?)b(?![a-z])/gi)].map((m) => Number(m[1]));
  return sizes.length ? Math.max(...sizes) : 0;
}

/**
 * Order Groq model ids best-default-first: the preference list, then other
 * llama/qwen/gpt-oss/kimi models (bigger first), then the rest alphabetically.
 * Never alphabetical overall — that made `allam-2-7b` the default.
 */
export function rankGroqModels(ids: string[]): string[] {
  const rank = (id: string): [number, number, string] => {
    const listed = GROQ_PREFERRED_MODELS.indexOf(id);
    if (listed !== -1) return [0, listed, id];
    if (PREFERRED_FAMILIES.test(id)) return [1, -paramBillions(id), id];
    return [2, 0, id];
  };
  return [...ids].sort((a, b) => {
    const [ta, sa, na] = rank(a);
    const [tb, sb, nb] = rank(b);
    return ta - tb || sa - sb || na.localeCompare(nb);
  });
}

/** The model to select when the user hasn't picked one. */
export function pickDefaultGroqModel(ids: string[]): string {
  return rankGroqModels(ids.filter(isChatCapableGroqModel))[0] ?? DEFAULT_MODEL;
}

export async function fetchGroqModels(): Promise<Array<{ name: string; size: number }>> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error("GROQ_API_KEY is not set. Add it to .env.local and restart the server.");
  }

  const res = await fetch("https://api.groq.com/openai/v1/models", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq models error (${res.status}): ${text || "Unknown error"}`);
  }

  const data = await res.json() as {
    data?: Array<{ id?: string; active?: boolean }>;
  };

  const ids = (data.data ?? [])
    .filter((model) => model.id && model.active !== false && isChatCapableGroqModel(model.id))
    .map((model) => model.id!);
  // Best first, so anything that falls back to models[0] gets a good model.
  return rankGroqModels(ids).map((name) => ({ name, size: 0 }));
}

export interface GroqResult {
  reply: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export async function askGroq(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): Promise<GroqResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to .env.local and restart the server."
    );
  }

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
        ...messages.map((m) => ({
          role: m.role,
          content:
            m.role === "user"
              ? groqUserMessageContent(m.content, m.attachments, model)
              : m.content,
        })),
      ],
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Groq error (${res.status}): ${text || "Unknown error"}`);
  }

  const data = await res.json();
  const usage = data.usage ?? {};

  return {
    reply: (data.choices[0].message.content as string).trim(),
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
}

/**
 * Returns a ReadableStream that streams tokens from Groq, in the
 * lib/chatStream wire format (usage or error sentinel at the end).
 */
export function streamGroq(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string,
  /** Aborts the provider request, e.g. when the chat client disconnects. */
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to .env.local and restart the server."
    );
  }

  return providerStream({ provider: "Groq", model, signal }, async (emit, signal) => {
    const res = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
          ...messages.map((m) => ({
            role: m.role,
            content:
              m.role === "user"
                ? groqUserMessageContent(m.content, m.attachments, model)
                : m.content,
          })),
        ],
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });

    if (!res.ok) {
      throw new ProviderHttpError(res.status, await res.text().catch(() => ""));
    }
    if (!res.body) return null;
    return readOpenAICompatibleSse(res.body, emit);
  });
}
