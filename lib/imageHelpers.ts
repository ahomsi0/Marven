import type { AIProvider, ImageAttachment } from "@/types";
import { isLikelyVisionModel } from "@/lib/visionModels";

// openrouter excluded: vision support varies per routed model
export const VISION_PROVIDERS = new Set<AIProvider>(["groq", "openai", "anthropic"]);

/** Groq chat completions only accept multipart image+text for Llama 4 vision models; text models require string content. */
export function groqModelSupportsVision(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return id.includes("llama-4-scout") || id.includes("llama-4-maverick");
}

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

const DEFAULT_STRIP_NOTE =
  "[Image attachment removed — this provider does not support vision.]";

/** Strip attachments and append a note for non-vision providers or models. */
export function stripAttachments(
  text: string,
  attachments: ImageAttachment[],
  note: string = DEFAULT_STRIP_NOTE
): string {
  if (!attachments.length) return text;
  return `${text}\n\n${note}`;
}

export const GROQ_TEXT_MODEL_IMAGE_STRIP_NOTE =
  "[Image attachment removed — this Groq model is text-only. Use a vision model such as meta-llama/llama-4-scout-17b-16e-instruct to send images.]";

export const LOCAL_TEXT_MODEL_IMAGE_STRIP_NOTE =
  "[Image attachment removed — this local model can't see images. Use a vision model such as llava or gemma3 to send images.]";

/**
 * `messages[].content` for a user turn sent to an OpenAI-compatible local
 * server (LM Studio, llama-server): image parts when the model looks
 * vision-capable, otherwise the text with a note that the images were dropped.
 */
export function localUserMessageContent(
  text: string,
  attachments: ImageAttachment[] | undefined,
  provider: AIProvider,
  modelId: string
): string | OpenAIContentPart[] {
  if (!attachments?.length) return text;
  return isLikelyVisionModel(provider, modelId)
    ? buildOpenAIContent(text, attachments)
    : stripAttachments(text, attachments, LOCAL_TEXT_MODEL_IMAGE_STRIP_NOTE);
}

/** Build Groq `messages[].content` for a user turn (string or OpenAI-style parts). */
export function groqUserMessageContent(
  text: string,
  attachments: ImageAttachment[] | undefined,
  modelId: string
): string | OpenAIContentPart[] {
  if (!attachments?.length) return text;
  return groqModelSupportsVision(modelId)
    ? buildOpenAIContent(text, attachments)
    : stripAttachments(text, attachments, GROQ_TEXT_MODEL_IMAGE_STRIP_NOTE);
}
