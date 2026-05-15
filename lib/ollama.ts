// Ollama integration helper
// DEFAULT_MODEL is used as the initial selection in the UI.
// The active model is chosen by the user at runtime.
export const DEFAULT_MODEL = "phi3";
const OLLAMA_BASE_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

export async function askOllama(prompt: string, model: string): Promise<string> {
  let response: Response;

  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
  } catch {
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
    response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
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
