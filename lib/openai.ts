// lib/openai.ts — server-side only (uses OPENAI_API_KEY from .env.local / Electron settings)

import OpenAI from "openai";
import type { HistoryMessage } from "@/types";

export const DEFAULT_MODEL = "gpt-4o-mini";

export const OPENAI_MODELS = [
  { name: "gpt-4o",        size: 0 },
  { name: "gpt-4o-mini",   size: 0 },
  { name: "gpt-4-turbo",   size: 0 },
  { name: "gpt-3.5-turbo", size: 0 },
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
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY is not set. Add it in Settings.");
  }

  const client = new OpenAI({ apiKey: key });
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
            ...messages,
          ],
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0.7,
        });

        let usageData: Record<string, number> | null = null;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) controller.enqueue(encoder.encode(delta));
          if (chunk.usage) {
            usageData = {
              prompt_tokens: chunk.usage.prompt_tokens ?? 0,
              completion_tokens: chunk.usage.completion_tokens ?? 0,
              total_tokens: chunk.usage.total_tokens ?? 0,
            };
          }
        }

        if (usageData) {
          controller.enqueue(
            encoder.encode(`\n\n__USAGE__${JSON.stringify(usageData)}`)
          );
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
}
