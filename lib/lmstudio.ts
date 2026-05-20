// lib/lmstudio.ts — LM Studio local backend (OpenAI-compatible API)
// LM Studio exposes /v1/... endpoints identical to the OpenAI REST API.

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { HistoryMessage } from "@/types";
import { stripAttachments } from "@/lib/imageHelpers";

export const DEFAULT_MODEL = "local-model";

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

/**
 * Returns the list of models currently loaded in LM Studio.
 * Returns [] if the server is not running or returns an error.
 */
export async function getLMStudioModels(
  baseUrl: string
): Promise<{ name: string; size: number }[]> {
  try {
    const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "lm-studio" });
    const response = await client.models.list();
    return response.data.map((m) => ({ name: m.id, size: 0 }));
  } catch {
    return [];
  }
}

/**
 * Returns a ReadableStream that streams tokens from LM Studio.
 * Reads LM_STUDIO_URL from env (set by Electron's applySettings).
 */
export function streamLMStudio(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const baseUrl = process.env.LM_STUDIO_URL ?? "http://localhost:1234";
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "lm-studio" });
  const encoder = new TextEncoder();

  const msgs: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
    ...messages.map((m): ChatCompletionMessageParam => ({
      role: m.role as "user" | "assistant",
      content: m.role === "user" && m.attachments?.length
        ? stripAttachments(m.content, m.attachments)
        : m.content,
    })),
  ];

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = await client.chat.completions.create({
          model,
          messages: msgs,
          stream: true,
          temperature: 0.7,
        });
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) controller.enqueue(encoder.encode(delta));
        }
      } catch (err) {
        controller.error(err);
      } finally {
        controller.close();
      }
    },
  });
}
