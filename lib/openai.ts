// lib/openai.ts — server-side only (uses OPENAI_API_KEY from .env.local / Electron settings)

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { HistoryMessage } from "@/types";
import { buildOpenAIContent } from "@/lib/imageHelpers";
import { providerStream, type StreamUsage } from "@/lib/chatStream";

export const DEFAULT_MODEL = "gpt-4o-mini";

export const OPENAI_MODELS = [
  { name: "gpt-4.1",      size: 0 },
  { name: "gpt-4.1-mini", size: 0 },
  { name: "gpt-4o",       size: 0 },
  { name: "gpt-4o-mini",  size: 0 },
];

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

/**
 * Returns a ReadableStream that streams tokens from OpenAI.
 * Usage data is appended at the end as: \n\n__USAGE__{...json}
 */
export function streamOpenAI(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string,
  /** Aborts the provider request, e.g. when the chat client disconnects. */
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set. Add it in Settings.");
  }

  const client = new OpenAI({ apiKey: key });

  return providerStream({ provider: "OpenAI", model, signal }, async (emit, signal) => {
    const stream = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
          ...messages.map((m): ChatCompletionMessageParam => ({
            role: m.role as "user" | "assistant",
            content: (m.role === "user" && m.attachments?.length
              ? buildOpenAIContent(m.content, m.attachments)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              : m.content) as any,
          })),
        ],
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.7,
      },
      { signal },
    );

    let usage: StreamUsage | null = null;
    for await (const chunk of stream) {
      emit(chunk.choices[0]?.delta?.content ?? "");
      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? 0,
          total_tokens: chunk.usage.total_tokens ?? 0,
        };
      }
    }
    return usage;
  });
}
