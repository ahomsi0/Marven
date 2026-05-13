import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";

const OLLAMA_BASE = "http://localhost:11434";

/** Models known to support tool calling in Ollama */
export const OLLAMA_TOOL_CAPABLE_MODELS = [
  "llama3.1",
  "llama3.2",
  "qwen2.5-coder",
  "mistral-nemo",
  "mistral",
  "hermes3",
];

function toOllamaMessages(messages: InternalMessage[]): Record<string, unknown>[] {
  return messages.flatMap((m) => {
    if (m.role === "system") return [{ role: "system", content: m.content }];
    if (m.role === "user") return [{ role: "user", content: m.content }];
    if (m.role === "assistant") return [{ role: "assistant", content: m.content }];
    if (m.role === "assistant_tool_call") {
      return [{
        role: "assistant",
        content: "",
        tool_calls: [{
          function: { name: m.tool, arguments: m.args },
        }],
      }];
    }
    if (m.role === "tool_result") {
      return [{ role: "tool", content: m.content }];
    }
    return [];
  });
}

export class OllamaToolsNotSupportedError extends Error {
  constructor(model: string) {
    super(
      `Model "${model}" does not support tool use. ` +
      `Compatible Ollama models: ${OLLAMA_TOOL_CAPABLE_MODELS.join(", ")}.`
    );
    this.name = "OllamaToolsNotSupportedError";
  }
}

export async function ollamaAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: toOllamaMessages(messages),
        tools: tools.map((t) => ({ type: "function", function: t })),
        stream: false,
      }),
    });
  } catch {
    throw new Error("Could not connect to Ollama. Make sure it is running: ollama serve");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 400 && text.toLowerCase().includes("tool")) {
      throw new OllamaToolsNotSupportedError(model);
    }
    throw new Error(`Ollama error (${res.status}): ${text || "unknown"}`);
  }

  const data = await res.json();
  const msg = data.message;

  if (msg?.tool_calls?.length) {
    const tc = msg.tool_calls[0];
    const args = tc.function?.arguments ?? {};
    const callId = `ollama-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { type: "tool_call", callId, tool: tc.function.name, args };
  }

  // If no tool_calls but model returned empty content, likely doesn't support tools
  if (!msg?.content && !msg?.tool_calls) {
    throw new OllamaToolsNotSupportedError(model);
  }

  return { type: "text", content: (msg.content as string ?? "").trim() };
}
