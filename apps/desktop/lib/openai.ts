// lib/openai.ts — server-side only (uses OPENAI_API_KEY from .env.local / Electron settings)
//
// Uses the Responses API, not Chat Completions: GPT-6.1 Sol and Terra only
// call tools there, and GPT-6 Luna only calls tools on Chat Completions with
// reasoning switched off. Requests are stateless (store: false) — Marven keeps
// the history and sends it every time.

import OpenAI from "openai";
import type {
  EasyInputMessage,
  ResponseInputContent,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import type { HistoryMessage, ImageAttachment } from "@/types";
import { providerStream, type StreamUsage } from "@/lib/chatStream";

// Luna is OpenAI's recommended replacement for the GPT-4o / GPT-4.1 models,
// which shut down on 2027-01-14, and the cheapest model here.
export const DEFAULT_MODEL = "gpt-6-luna";

export const OPENAI_MODELS = [
  { name: "gpt-6-astra",   size: 0 },
  { name: "gpt-6.1-sol",   size: 0 },
  { name: "gpt-6.1-terra", size: 0 },
  { name: "gpt-6-luna",    size: 0 },
];

/** Shown when the model refuses and writes no text. */
export const OPENAI_REFUSAL_MESSAGE =
  "The model declined to answer this request. Try rephrasing it, or switch to another model.";

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

/**
 * Whether a model reasons before answering (and takes `reasoning.effort`).
 * Older GPT-4-era models reject the reasoning parameter.
 */
export function isOpenAIReasoningModel(model: string): boolean {
  return /^(gpt-[5-9]|o\d)/i.test(model);
}

/** A user turn's content for the Responses API: plain text, or text plus images. */
export function buildResponsesUserContent(
  text: string,
  attachments: ImageAttachment[] | undefined,
): string | ResponseInputContent[] {
  if (!attachments?.length) return text;
  return [
    { type: "input_text", text },
    ...attachments.map((a): ResponseInputContent => ({
      type: "input_image",
      image_url: a.base64,
      detail: "auto",
    })),
  ];
}

export function toResponsesChatInput(messages: HistoryMessage[]): ResponseInputItem[] {
  return messages.map((m): EasyInputMessage =>
    m.role === "user"
      ? { role: "user", content: buildResponsesUserContent(m.content, m.attachments) }
      : { role: "assistant", content: m.content },
  );
}

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
    const stream = await client.responses.create(
      {
        model,
        instructions: systemPrompt ?? SYSTEM_PROMPT,
        input: toResponsesChatInput(messages),
        store: false,
        stream: true,
      },
      { signal },
    );

    let usage: StreamUsage | null = null;
    let wroteText = false;
    let refused = false;
    for await (const event of stream) {
      if (event.type === "response.output_text.delta") {
        wroteText = true;
        emit(event.delta);
      } else if (event.type === "response.refusal.delta") {
        refused = true;
      } else if (event.type === "response.completed" || event.type === "response.incomplete") {
        const u = event.response.usage;
        if (u) {
          usage = {
            prompt_tokens: u.input_tokens ?? 0,
            completion_tokens: u.output_tokens ?? 0,
            total_tokens: u.total_tokens ?? 0,
          };
        }
      } else if (event.type === "response.failed") {
        throw new Error(event.response.error?.message ?? "OpenAI response failed");
      } else if (event.type === "error") {
        throw new Error(event.message || "OpenAI stream error");
      }
    }
    if (refused && !wroteText) emit(OPENAI_REFUSAL_MESSAGE);
    return usage;
  });
}
