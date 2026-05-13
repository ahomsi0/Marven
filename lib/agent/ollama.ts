import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";

const OLLAMA_BASE = "http://localhost:11434";

interface JsonToolCall { name: string; args: Record<string, unknown> }

function extractJsonToolCall(text: string): JsonToolCall | null {
  // Match a top-level JSON object anywhere in the text
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]);
    const name = typeof obj.name === "string" ? obj.name : null;
    if (!name) return null;
    // Support both "arguments" and "args" keys
    const args = (obj.arguments ?? obj.args ?? {}) as Record<string, unknown>;
    if (typeof args !== "object" || Array.isArray(args)) return null;
    return { name, args };
  } catch {
    return null;
  }
}

/** Models known to support tool calling in Ollama */
export const OLLAMA_TOOL_CAPABLE_MODELS = [
  "llama3.1",
  "llama3.2",
  "qwen2.5-coder",
  "mistral-nemo",
  "mistral",
  "hermes3",
];

/** Models too small for reliable tool calling (param count ≤ 3B) */
const SMALL_MODEL_RE = /[:\-_](0\.5b|1b|1\.5b|2b|3b)\b/i;

export function isToolCapableModel(model: string): boolean {
  if (SMALL_MODEL_RE.test(model)) return false;
  return OLLAMA_TOOL_CAPABLE_MODELS.some((m) => model.startsWith(m));
}

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
    const isSmall = SMALL_MODEL_RE.test(model);
    const reason = isSmall
      ? `"${model}" is too small for tool calling (≤3B parameters).`
      : `"${model}" does not support tool use.`;
    super(
      `${reason} Switch to a capable model: ${OLLAMA_TOOL_CAPABLE_MODELS.join(", ")}.`
    );
    this.name = "OllamaToolsNotSupportedError";
  }
}

export async function ollamaAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  if (SMALL_MODEL_RE.test(model)) {
    throw new OllamaToolsNotSupportedError(model);
  }

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

  const text: string = (msg.content ?? "").trim();

  // Some models (qwen2.5-coder etc.) output tool calls as inline JSON text.
  // Try to extract: {"name":"...","arguments":{...}} or {"name":"...","args":{...}}
  const jsonFallback = extractJsonToolCall(text);
  if (jsonFallback) {
    const callId = `ollama-fb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return { type: "tool_call", callId, tool: jsonFallback.name, args: jsonFallback.args };
  }

  return { type: "text", content: text };
}
