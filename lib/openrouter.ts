import type { HistoryMessage } from "@/types";
import { stripAttachments } from "@/lib/imageHelpers";
import { ProviderHttpError, providerStream, readOpenAICompatibleSse } from "@/lib/chatStream";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

export const DEFAULT_MODEL = "google/gemma-3-27b-it:free";

export const OPENROUTER_MODELS = [
  { name: "google/gemma-3-27b-it:free", size: 0 },
  { name: "meta-llama/llama-3.1-8b-instruct:free", size: 0 },
  { name: "microsoft/phi-3-mini-128k-instruct:free", size: 0 },
  { name: "deepseek/deepseek-r1:free", size: 0 },
  { name: "mistralai/mistral-7b-instruct:free", size: 0 },
];

export function streamOpenRouter(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set in settings");

  const sysMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }]
    : [];

  return providerStream({ provider: "OpenRouter", model }, async (emit, signal) => {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": "https://marven.app",
        "X-Title": "Marven",
      },
      body: JSON.stringify({
        model,
        messages: [
          ...sysMessages,
          ...messages.map((m) => ({
            role: m.role,
            content: m.role === "user" && m.attachments?.length
              ? stripAttachments(m.content, m.attachments)
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
