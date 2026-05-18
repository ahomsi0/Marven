// Some models — especially smaller open-weights ones — emit tool calls as
// plain text in the message content instead of using the provider's native
// tool-call envelope. This module recognises the common narration formats
// and reconstructs a structured tool call so the agent loop can dispatch it.
//
// Formats currently handled:
//   <function=NAME>{"arg":"..."}</function>      (Llama 3.1 native)
//   <function(NAME){"arg":"..."}</function>      (variant seen on some Groq /
//                                                 OpenRouter routes)
//   <tool_call>{"name":"NAME","arguments":{...}}</tool_call>   (Qwen-style)

export interface NarratedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

const FUNCTION_TAG_PATTERNS: RegExp[] = [
  /<function=([A-Za-z_][A-Za-z0-9_]*)>\s*(\{[\s\S]*?\})\s*<\/function>/,
  /<function\(([A-Za-z_][A-Za-z0-9_]*)\)\s*(\{[\s\S]*?\})\s*<\/function>/,
];

const TOOL_CALL_TAG_PATTERN =
  /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/;

export function parseNarratedToolCall(content: string): NarratedToolCall | null {
  if (!content) return null;

  for (const pattern of FUNCTION_TAG_PATTERNS) {
    const m = content.match(pattern);
    if (m) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(m[2]); } catch { /* keep empty */ }
      return { tool: m[1], args };
    }
  }

  const tc = content.match(TOOL_CALL_TAG_PATTERN);
  if (tc) {
    try {
      const obj = JSON.parse(tc[1]) as { name?: string; arguments?: Record<string, unknown> };
      if (typeof obj.name === "string") {
        return { tool: obj.name, args: obj.arguments ?? {} };
      }
    } catch { /* ignore */ }
  }

  return null;
}
