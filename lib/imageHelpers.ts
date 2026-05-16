import type { AIProvider, ImageAttachment } from "@/types";

// openrouter excluded: vision support varies per routed model
export const VISION_PROVIDERS = new Set<AIProvider>(["groq", "openai", "anthropic"]);

type OpenAITextPart = { type: "text"; text: string };
type OpenAIImagePart = { type: "image_url"; image_url: { url: string } };
type AnthropicImagePart = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type OpenAIContentPart = OpenAITextPart | OpenAIImagePart;
export type AnthropicContentPart = AnthropicImagePart | OpenAITextPart;

/** OpenAI / Groq multi-part content */
export function buildOpenAIContent(
  text: string,
  attachments: ImageAttachment[]
): string | OpenAIContentPart[] {
  if (!attachments.length) return text;
  return [
    { type: "text" as const, text },
    ...attachments.map((a): OpenAIImagePart => ({
      type: "image_url",
      image_url: { url: a.base64 },
    })),
  ];
}

/** Anthropic multi-part content (image first, text second) */
export function buildAnthropicContent(
  text: string,
  attachments: ImageAttachment[]
): string | AnthropicContentPart[] {
  if (!attachments.length) return text;
  return [
    ...attachments.map((a): AnthropicImagePart => ({
      type: "image",
      source: {
        type: "base64",
        media_type: a.mimeType,
        data: a.base64.replace(/^data:[^;]+;base64,/, ""),
      },
    })),
    { type: "text" as const, text },
  ];
}

/** Strip attachments and append a note for non-vision providers */
export function stripAttachments(text: string, attachments: ImageAttachment[]): string {
  if (!attachments.length) return text;
  return text + "\n\n[Image attachment removed — this provider does not support vision.]";
}
