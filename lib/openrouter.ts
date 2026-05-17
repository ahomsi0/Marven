import type { HistoryMessage } from "@/types";
import { buildOpenAIContent } from "@/lib/imageHelpers";

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

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream({
    async start(controller) {
      let res: Response;
      try {
        res = await fetch(OPENROUTER_API_URL, {
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
                  ? buildOpenAIContent(m.content, m.attachments) as string | unknown[]
                  : m.content,
              })),
            ],
            temperature: 0.7,
            stream: true,
            stream_options: { include_usage: true },
          }),
        });
      } catch (err) {
        controller.error(err);
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        controller.error(
          new Error(`OpenRouter error (${res.status}): ${text || "unknown"}`)
        );
        return;
      }

      const body = res.body;
      if (!body) {
        controller.close();
        return;
      }

      const reader = body.getReader();
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split("\n")) {
          const trimmed = line.replace(/^data: /, "").trim();
          if (!trimmed || trimmed === "[DONE]") continue;
          try {
            const json = JSON.parse(trimmed);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) controller.enqueue(encoder.encode(delta));
            if (json.usage) {
              usage = {
                promptTokens: json.usage.prompt_tokens ?? 0,
                completionTokens: json.usage.completion_tokens ?? 0,
                totalTokens: json.usage.total_tokens ?? 0,
              };
            }
          } catch { /* ignore */ }
        }
      }

      controller.enqueue(
        encoder.encode(`\n\n__USAGE__${JSON.stringify(usage)}`)
      );
      controller.close();
    },
  });
}
