// lib/llamaserver.ts — llama-server (llama.cpp HTTP server) backend
// llama-server exposes /v1/... endpoints compatible with the OpenAI REST API.

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { HistoryMessage } from "@/types";
import { localUserMessageContent } from "@/lib/imageHelpers";
import { providerStream } from "@/lib/chatStream";

export const DEFAULT_MODEL = "local-model";

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

/**
 * Returns the list of models available from llama-server.
 * Returns [] if the server is not running or returns an error.
 */
export async function getLlamaServerModels(
  baseUrl: string
): Promise<{ name: string; size: number }[]> {
  try {
    const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "llama-server" });
    const response = await client.models.list();
    return response.data.map((m) => ({ name: m.id, size: 0 }));
  } catch {
    return [];
  }
}

/**
 * The chat messages for llama-server: system prompt, then history. Images go
 * as `image_url` parts when the model looks vision-capable (llama-server also
 * needs to be started with the model's mmproj file), else they're dropped.
 */
export function buildLlamaServerMessages(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: systemPrompt ?? SYSTEM_PROMPT },
    ...messages.map((m): ChatCompletionMessageParam =>
      m.role === "user"
        ? { role: "user", content: localUserMessageContent(m.content, m.attachments, "llamaserver", model) }
        : { role: "assistant", content: m.content },
    ),
  ];
}

/**
 * Returns a ReadableStream that streams tokens from llama-server.
 * Reads LLAMA_SERVER_URL from env (set by Electron's applySettings).
 */
export function streamLlamaServer(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string,
  /** Aborts the provider request, e.g. when the chat client disconnects. */
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const baseUrl = process.env.LLAMA_SERVER_URL ?? "http://localhost:8080";
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: "llama-server" });

  const msgs = buildLlamaServerMessages(messages, model, systemPrompt);

  return providerStream({ provider: "llama-server", model, signal }, async (emit, signal) => {
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
