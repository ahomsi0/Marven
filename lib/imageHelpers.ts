import type { AIProvider, ImageAttachment } from "@/types";

export const VISION_PROVIDERS = new Set<AIProvider>(["groq", "openai", "anthropic"]);

/** OpenAI / Groq multi-part content */
export function buildOpenAIContent(
  text: string,
  attachments: ImageAttachment[]
): string | unknown[] {
  if (!attachments.length) return text;
  return [
    { type: "text", text },
    ...attachments.map((a) => ({
      type: "image_url",
      image_url: { url: a.base64 },
    })),
  ];
}

/** Anthropic multi-part content (image first, text second) */
export function buildAnthropicContent(
  text: string,
  attachments: ImageAttachment[]
): string | unknown[] {
  if (!attachments.length) return text;
  return [
    ...attachments.map((a) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: a.mimeType,
        data: a.base64.replace(/^data:[^;]+;base64,/, ""),
      },
    })),
    { type: "text", text },
  ];
}

/** Strip attachments and append a note for non-vision providers */
export function stripAttachments(text: string, attachments: ImageAttachment[]): string {
  if (!attachments.length) return text;
  return text + "\n\n[Image attachment removed — this provider does not support vision.]";
}
