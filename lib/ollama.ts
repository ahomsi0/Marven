// Ollama integration helper
// DEFAULT_MODEL is used as the initial selection in the UI.
// The active model is chosen by the user at runtime.

import type { ImageAttachment } from "@/types";
import { stripAttachments } from "@/lib/imageHelpers";

export const DEFAULT_MODEL = "phi3";
const OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

// A non-streamed generation has to finish within this; a cold model load plus
// a long answer on a slow machine can take a while, so it's generous.
const GENERATE_TIMEOUT_MS = 5 * 60_000;
const TAGS_TIMEOUT_MS = 5_000;

export async function askOllama(
  prompt: string,
  model: string,
  attachments?: ImageAttachment[],
  signal?: AbortSignal
): Promise<string> {
  const safePrompt = attachments?.length
    ? stripAttachments(prompt, attachments)
    : prompt;
  let response: Response;
  const timeout = AbortSignal.timeout(GENERATE_TIMEOUT_MS);

  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: safePrompt, stream: false }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    if (timeout.aborted) throw new Error("Ollama took too long to respond.");
    throw new Error(
      "Could not connect to Ollama. Make sure it is running with: ollama serve"
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Ollama returned an error (${response.status}): ${text || "Unknown error"}`
    );
  }

  const data = await response.json();
  return (data.response as string).trim();
}

export async function fetchInstalledModels(): Promise<{ name: string; size: number }[]> {
  let response: Response;

  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(TAGS_TIMEOUT_MS),
    });
  } catch {
    throw new Error("Could not connect to Ollama.");
  }

  if (!response.ok) {
    throw new Error(`Ollama /api/tags returned ${response.status}`);
  }

  const data = await response.json();
  // Each entry has { name, size, digest, modified_at, ... }
  return (data.models ?? []).map((m: { name: string; size: number }) => ({
    name: m.name,
    size: m.size,
  }));
}
