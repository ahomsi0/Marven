import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";
import { parseOpenAiStyleToolCall } from "./groq";
import { stripAttachments } from "@/lib/imageHelpers";
import { parseNarratedToolCall } from "./parseNarratedToolCall";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

function toOpenRouterMessages(
  messages: InternalMessage[]
): Array<Record<string, unknown>> {
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
        content: null,
        tool_calls: [{
          id: m.callId,
          type: "function",
          function: { name: m.tool, arguments: JSON.stringify(m.args) },
        }],
      }] as Array<Record<string, unknown>>;
    }
    if (m.role === "tool_result") {
      return [{ role: "tool", tool_call_id: m.callId, content: m.content }];
    }
    return [];
  }) as Array<Record<string, unknown>>;
}

export async function openrouterAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set in settings");

  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://marven.app",
      "X-Title": "Marven",
    },
    body: JSON.stringify({
      model,
      messages: toOpenRouterMessages(messages),
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter error (${res.status}): ${text || "unknown"}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (choice?.finish_reason === "tool_calls" && choice.message?.tool_calls?.length) {
    const calls = choice.message.tool_calls.map((tc: Parameters<typeof parseOpenAiStyleToolCall>[0]) =>
      parseOpenAiStyleToolCall(tc, "openrouter-call"),
    );
    if (calls.length === 1) {
      const { callId, tool, args } = calls[0];
      return { type: "tool_call", callId, tool, args };
    }
    return { type: "tool_calls", calls };
  }

  const content = (choice?.message?.content as string ?? "").trim();
  const narrated = parseNarratedToolCall(content);
  if (narrated) {
    return { type: "tool_call", callId: `openrouter-narrated-${Date.now()}`, tool: narrated.tool, args: narrated.args };
  }
  return { type: "text", content };
}
