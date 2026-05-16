// NVIDIA NIM — OpenAI-compatible API
// Key from: https://build.nvidia.com → Get API Key

export const DEFAULT_MODEL = "mistralai/mistral-nemotron";
const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

const SYSTEM_PROMPT =
  "You are Marven, a sophisticated AI assistant. You are intelligent, precise, and occasionally witty. You give complete but concise answers. You address the user by name when known. Never say you're just an AI — you are Marven.";

export const NIM_MODELS = [
  { name: "mistralai/mistral-nemotron" },
  { name: "mistralai/mistral-large-3-675b-instruct-2512" },
  { name: "qwen/qwen3-coder-480b-a35b-instruct" },
  { name: "bytedance/seed-oss-36b-instruct" },
  { name: "minimaxai/minimax-m2.7" },
];

import type { HistoryMessage } from "@/types";

export function streamNim(
  messages: HistoryMessage[],
  model: string,
  systemPrompt?: string
): ReadableStream<Uint8Array> {
  const key = process.env.NIM_API_KEY;
  if (!key) throw new Error("NIM_API_KEY is not set. Add it in Settings → API Keys.");

  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let res: Response;
      try {
        res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: systemPrompt ?? SYSTEM_PROMPT }, ...messages],
            temperature: 0.7,
            stream: true,
          }),
        });
      } catch (err) {
        controller.error(err);
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        controller.error(new Error(`NIM error (${res.status}): ${text || "Unknown error"}`));
        return;
      }

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buffer = "";

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
            const delta: string = json.choices?.[0]?.delta?.content ?? "";
            if (delta) controller.enqueue(encoder.encode(delta));
          } catch { /* skip malformed */ }
        }
      }
      controller.close();
    },
  });
}
