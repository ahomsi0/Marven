// Some models — especially smaller open-weights ones — emit tool calls as
// plain text in the message content instead of using the provider's native
// tool-call envelope. This module recognises the common narration formats
// and reconstructs a structured tool call so the agent loop can dispatch it.
//
// Formats currently handled:
//   <function=NAME>{"arg":"..."}</function>           (Llama 3.1 native)
//   <function(NAME){"arg":"..."}</function>           (Groq / OpenRouter variant)
//   <tool_call>{"name":"NAME","arguments":{...}}</tool_call>  (Qwen-style, wrapped)
//   {"name":"NAME","arguments":{...}}                 (Qwen-coder 2.5 bare, no
//                                                      wrapper — seen on qwen2.5-
//                                                      coder:7b via Ollama)

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

// Whitelist of tool names we accept from bare-JSON parsing. Using a closed set
// avoids false positives where the model emits unrelated JSON in the chat
// content (e.g. as part of an explanation or code sample).
const KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set([
  "list_files",
  "read_file",
  "write_file",
  "apply_patch",
  "run_command",
  "search_files",
  "search_codebase",
  "web_search",
  "fetch_url",
  "remember",
  "git_status",
  "git_diff",
  "git_log",
  "git_commit",
  "git_branch",
  "git_checkout",
]);

/**
 * Attempts to parse a JSON-shaped object (with name + arguments) that may sit
 * at the start of the content, optionally inside a ```json fenced block.
 * Returns the parsed call only if `name` is in KNOWN_TOOL_NAMES.
 */
function parseBareJsonToolCall(content: string): NarratedToolCall | null {
  // Strip a leading ```json fence if present, plus any trailing fence.
  let s = content.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  if (!s.startsWith("{")) return null;

  // Find the matching closing brace for the first JSON object, in case the
  // model trails extra prose after it.
  let depth = 0;
  let end = -1;
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;

  try {
    const obj = JSON.parse(s.slice(0, end + 1)) as {
      name?: unknown;
      arguments?: unknown;
    };
    if (typeof obj.name !== "string") return null;
    if (!KNOWN_TOOL_NAMES.has(obj.name)) return null;
    const args =
      obj.arguments && typeof obj.arguments === "object"
        ? (obj.arguments as Record<string, unknown>)
        : {};
    return { tool: obj.name, args };
  } catch {
    return null;
  }
}

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

  // Bare JSON fallback — only triggers when the JSON shape is unmistakably a
  // tool call (has a `name` matching one of our registered tools).
  const bare = parseBareJsonToolCall(content);
  if (bare) return bare;

  return null;
}
