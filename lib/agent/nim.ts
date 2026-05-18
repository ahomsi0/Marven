import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";
import { parseNarratedToolCall } from "./parseNarratedToolCall";

const NIM_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

function toNimMessages(messages: InternalMessage[]): Array<Record<string, unknown>> {
  return messages.flatMap((m) => {
    if (m.role === "system") return [{ role: "system", content: m.content }];
    if (m.role === "user") return [{ role: "user", content: m.content }];
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

export async function nimAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.NIM_API_KEY;
  if (!key) throw new Error("NIM_API_KEY is not set. Add it in Settings → API Keys.");

  const res = await fetch(NIM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: toNimMessages(messages),
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NIM error (${res.status}): ${text || "unknown"}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (choice?.finish_reason === "tool_calls" && choice.message?.tool_calls?.length) {
    const tc = choice.message.tool_calls[0];
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
    return { type: "tool_call", callId: tc.id, tool: tc.function.name, args };
  }

  const content = (choice?.message?.content as string ?? "").trim();
  const narrated = parseNarratedToolCall(content);
  if (narrated) {
    return { type: "tool_call", callId: `nim-narrated-${Date.now()}`, tool: narrated.tool, args: narrated.args };
  }
  return { type: "text", content };
}
