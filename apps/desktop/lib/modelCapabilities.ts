// Server-side: can the selected chat model see images? Mirrors what the
// provider modules do with image attachments, so the UI can say up front when
// they'll be dropped.

import { VISION_PROVIDERS, groqModelSupportsVision } from "@/lib/imageHelpers";
import { ollamaModelSupportsVision } from "@/lib/ollama";
import { isLikelyVisionModel } from "@/lib/visionModels";
import type { AIProvider } from "@/types";

export async function modelSupportsVision(provider: string, model: string): Promise<boolean> {
  if (!model) return false;
  switch (provider) {
    case "ollama":
      return ollamaModelSupportsVision(model);
    case "lmstudio":
    case "llamaserver":
      return isLikelyVisionModel(provider, model);
    case "groq":
      return groqModelSupportsVision(model);
    default:
      return VISION_PROVIDERS.has(provider as AIProvider);
  }
}
