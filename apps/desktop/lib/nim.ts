// NVIDIA NIM — OpenAI-compatible API
// Key from: https://build.nvidia.com → Get API Key

export const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

// Chat models from NVIDIA's /v1/models catalog (checked 2026-11-17).
export const NIM_MODELS = [
  { name: "nvidia/nemotron-3-ultra-550b-a55b" },
  { name: "mistralai/mistral-large-4-1t-a52b" },
  { name: "nvidia/nemotron-3.5-super-vl-120b-a12b" },
  { name: "minimaxai/minimax-m3.1-flash" },
  { name: "z-ai/glm-5.3-flash" },
  { name: "nvidia/nemotron-3.5-lightning-30b-a3b" },
];

import type { HistoryMessage } from "@/types";
import { stripAttachments } from "@/lib/imageHelpers";
import { ProviderHttpError, providerStream, readOpenAICompatibleSse } from "@/lib/chatStream";

export function streamNim(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string,
  /** Aborts the provider request, e.g. when the chat client disconnects. */
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const key = process.env.NIM_API_KEY;
  if (!key) throw new Error("NIM_API_KEY is not set. Add it in Settings → API Keys.");

  return providerStream({ provider: "NVIDIA NIM", model, signal }, async (emit, signal) => {
    const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
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
              ? stripAttachments(m.content, m.attachments)
              : m.content,
          })),
        ],
        temperature: 0.7,
        stream: true,
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
