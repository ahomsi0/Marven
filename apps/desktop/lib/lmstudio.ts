// lib/lmstudio.ts — LM Studio local backend (OpenAI-compatible API)
// LM Studio exposes /v1/... endpoints identical to the OpenAI REST API.

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { HistoryMessage } from "@/types";
import { localUserMessageContent } from "@/lib/imageHelpers";
import { providerStream } from "@/lib/chatStream";

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
 * The chat messages for LM Studio: system prompt, then history. Images go as
 * `image_url` parts when the model looks vision-capable, else they're dropped.
 */
export function buildLMStudioMessages(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
    ...messages.map((m): ChatCompletionMessageParam =>
      m.role === "user"
        ? { role: "user", content: localUserMessageContent(m.content, m.attachments, "lmstudio", model) }
        : { role: "assistant", content: m.content },
    ),
  ];
}

/**
 * Returns a ReadableStream that streams tokens from LM Studio.
 * Reads LM_STUDIO_URL from env (set by Electron's applySettings).
 */
export function streamLMStudio(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string,
  /** Aborts the provider request, e.g. when the chat client disconnects. */
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const baseUrl = process.env.LM_STUDIO_URL ?? "http://localhost:1234";
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "lm-studio" });

  const msgs = buildLMStudioMessages(messages, model, systemPrompt);

  return providerStream({ provider: "LM Studio", model, signal }, async (emit, signal) => {
    const stream = await client.chat.completions.create(
      { model, messages: msgs, stream: true, temperature: 0.7 },
      { signal },
    );
    for await (const chunk of stream) {
      emit(chunk.choices[0]?.delta?.content ?? "");
    }
    return null;
  });
}
