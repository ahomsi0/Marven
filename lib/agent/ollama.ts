import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";
import { stripAttachments } from "@/lib/imageHelpers";
import { parseNarratedToolCall } from "./parseNarratedToolCall";

const OLLAMA_BASE = "http://localhost:11434";

interface JsonToolCall { name: string; args: Record<string, unknown> }

// Known tool names — used to validate function-call-syntax extractions
// so we don't mistake random `someFunc({...})` Markdown for a tool invocation.
const KNOWN_TOOLS = new Set([
  "list_files", "read_file", "write_file", "run_command", "search_files",
  "web_search", "fetch_url", "remember",
  "git_status", "git_diff", "git_log", "git_commit", "git_branch", "git_checkout",
  "search_codebase",
]);

export function extractJsonToolCall(text: string): JsonToolCall | null {
  // First, try function-call syntax that qwen2.5-coder loves to emit:
  //   run_command({"command": "..."})
  //   read_file({"path": "foo.ts"})
  // We look for `toolName(` followed by a balanced-brace JSON object then `)`.
  const fnCallRe = /\b([a-z_][a-z0-9_]*)\s*\(\s*(\{)/gi;
  let m: RegExpExecArray | null;
  while ((m = fnCallRe.exec(text))) {
    const name = m[1];
    if (!KNOWN_TOOLS.has(name)) continue;
    // Find the matching closing brace by depth-tracking from the opening `{`
    const braceStart = m.index + m[0].length - 1;
    let depth = 0;
    let inStr = false;
    let strCh = "";
    let escaped = false;
    for (let i = braceStart; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === strCh) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; strCh = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          try {
            const args = JSON.parse(text.slice(braceStart, i + 1));
            if (args && typeof args === "object" && !Array.isArray(args)) {
              return { name, args: args as Record<string, unknown> };
            }
          } catch { /* fall through to standard JSON form */ }
          break;
        }
      }
    }
  }

  // Then try the `{"name": "tool", "arguments": {...}}` JSON form.
  // Use brace-depth tracking to find the first complete top-level JSON object.
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1));
          const name = typeof obj.name === "string" ? obj.name : null;
          if (!name) { start = -1; continue; }
          const args = (obj.arguments ?? obj.args ?? {}) as Record<string, unknown>;
          if (typeof args !== "object" || Array.isArray(args)) { start = -1; continue; }
          return { name, args };
        } catch {
          start = -1;
        }
      }
    }
  }
  return null;
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
    if (m.role === "user") {
      const content = m.attachments?.length
        ? stripAttachments(m.content, m.attachments)
        : m.content;
      return [{ role: "user", content }];
    }
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

  // Last-resort: catch <function=...>{}</function> and <function(...)>{}</function>
  // narration from models that ignored the OpenAI-style tool spec entirely.
  const narrated = parseNarratedToolCall(text);
  if (narrated) {
    return { type: "tool_call", callId: `ollama-narrated-${Date.now()}`, tool: narrated.tool, args: narrated.args };
  }

  return { type: "text", content: text };
}
