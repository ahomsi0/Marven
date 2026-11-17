// lib/anthropic.ts — server-side only (uses ANTHROPIC_API_KEY from .env.local / Electron settings)

import Anthropic from "@anthropic-ai/sdk";
import type { HistoryMessage } from "@/types";
import { buildAnthropicContent } from "@/lib/imageHelpers";
import { providerStream } from "@/lib/chatStream";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

// Current Claude models. All of them think by default, and that thinking counts
// against max_tokens, so the limits below leave room for it.
export const ANTHROPIC_MODELS = [
  { name: "claude-fable-5-2",  size: 0 },
  { name: "claude-opus-5-5",   size: 0 },
  { name: "claude-sonnet-5-5", size: 0 },
  { name: "claude-haiku-5-5",  size: 0 },
];

/** Shown when Claude's safety classifiers decline a request (stop_reason "refusal"). */
export const ANTHROPIC_REFUSAL_MESSAGE =
  "Claude declined to continue this request. Try rephrasing it, or switch to another model.";

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

/**
 * Returns a ReadableStream that streams tokens from Anthropic.
 * Usage data is appended at the end as: \n\n__USAGE__{...json}
 */
export function streamAnthropic(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string,
  /** Aborts the provider request, e.g. when the chat client disconnects. */
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it in Settings.");
  }

  const client = new Anthropic({ apiKey: key });

  return providerStream({ provider: "Anthropic", model, signal }, async (emit, signal) => {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 32000,
        system: systemPrompt ?? SYSTEM_PROMPT,
        messages: messages.map((m) => ({
          role: m.role as "user" | "assistant",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          content: (m.role === "user" && m.attachments?.length
            ? buildAnthropicContent(m.content, m.attachments)
            : m.content) as any,
        })),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        emit(event.delta.text);
      }
    }

    const finalMsg = await stream.finalMessage();
    if (finalMsg.stop_reason === "refusal") emit(`\n\n${ANTHROPIC_REFUSAL_MESSAGE}`);
    if (!finalMsg.usage) return null;
    const input = finalMsg.usage.input_tokens ?? 0;
    const output = finalMsg.usage.output_tokens ?? 0;
    return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output };
  });
}
