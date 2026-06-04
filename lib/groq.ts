// Groq API helper — server-side only (uses GROQ_API_KEY from .env.local)
// The key is never sent to the browser; all requests go through /api/chat.

export const DEFAULT_MODEL = "llama-3.1-8b-instant";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

// Fallback list used if the live Groq models API is unavailable.
export const GROQ_MODELS = [
  { name: "llama-3.1-8b-instant",    size: 0 },
  { name: "llama-3.3-70b-versatile", size: 0 },
  { name: "llama3-8b-8192",          size: 0 },
  { name: "gemma2-9b-it",            size: 0 },
  { name: "mixtral-8x7b-32768",      size: 0 },
];

const NON_CHAT_MODEL_PATTERNS = [
  /^whisper/i,
  /^playai-tts/i,
  /prompt-guard/i,
  /safeguard/i,
  /tts/i,
  /transcribe/i,
];

function isChatCapableGroqModel(id: string): boolean {
  return !NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(id));
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

  return (data.data ?? [])
    .filter((model) => model.id && model.active !== false && isChatCapableGroqModel(model.id))
    .map((model) => ({ name: model.id!, size: 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

import type { HistoryMessage } from "@/types";
import { buildOpenAIContent } from "@/lib/imageHelpers";

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
          content: m.role === "user" && m.attachments?.length
            ? buildOpenAIContent(m.content, m.attachments) as string | unknown[]
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
 * Returns a ReadableStream that streams tokens from Groq.
 * Usage data is appended at the end as: \n\n__USAGE__{...json}
 */
export function streamGroq(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to .env.local and restart the server."
    );
  }

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let res: Response;
      try {
        res = await fetch(GROQ_API_URL, {
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
                content: m.role === "user" && m.attachments?.length
                  ? buildOpenAIContent(m.content, m.attachments) as string | unknown[]
                  : m.content,
              })),
            ],
            temperature: 0.7,
            stream: true,
            stream_options: { include_usage: true },
          }),
        });
      } catch (err) {
        controller.error(err);
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        controller.error(
          new Error(`Groq error (${res.status}): ${text || "Unknown error"}`)
        );
        return;
      }

      const body = res.body;
      if (!body) {
        controller.close();
        return;
      }

      const reader = body.getReader();
      const dec = new TextDecoder();
      let buffer = "";
      let usageData: Record<string, number> | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += dec.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            // Usage comes in the final chunk
            if (json.usage) {
              usageData = {
                prompt_tokens: json.usage.prompt_tokens ?? 0,
                completion_tokens: json.usage.completion_tokens ?? 0,
                total_tokens: json.usage.total_tokens ?? 0,
              };
            }
            const delta: string =
              json.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              controller.enqueue(encoder.encode(delta));
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      // Append usage sentinel
      if (usageData) {
        controller.enqueue(
          encoder.encode(`\n\n__USAGE__${JSON.stringify(usageData)}`)
        );
      }

      controller.close();
    },
  });
}
