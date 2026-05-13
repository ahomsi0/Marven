import type { ToolDefinition, InternalMessage } from "@/types";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

export type ProviderStepResult =
  | { type: "tool_call"; callId: string; tool: string; args: Record<string, unknown> }
  | { type: "text"; content: string };

/** Convert internal loop messages to the Groq (OpenAI-compatible) format. */
function toGroqMessages(
  messages: InternalMessage[]
): Array<Record<string, unknown>> {
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function groqAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string,
  _attempt = 0
): Promise<ProviderStepResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set in .env.local");

  const res = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: toGroqMessages(messages),
      tools: tools.map((t) => ({ type: "function", function: t })),
      tool_choice: "auto",
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");

    if (res.status === 429 && _attempt < 3) {
      let waitMs = 6_000;
      try {
        const parsed = JSON.parse(text);
        const msg: string = parsed?.error?.message ?? "";
        const match = msg.match(/try again in ([\d.]+)s/i);
        if (match) waitMs = Math.ceil(parseFloat(match[1]) * 1000) + 500;
      } catch { /* ignore */ }
      await sleep(waitMs);
      return groqAgentStep(messages, tools, model, _attempt + 1);
    }
    if (res.status === 429) {
      throw new Error("Rate limit reached. Too many retries — try again in a moment.");
    }

    // Llama models sometimes output <function=name>{...}</function> (native format)
    // instead of OpenAI tool_calls JSON. Groq returns 400 with the raw output in
    // failed_generation — parse it ourselves so the loop can continue.
    if (res.status === 400) {
      try {
        const parsed = JSON.parse(text);
        const raw: string = parsed?.error?.failed_generation ?? "";
        const match = raw.match(/<function=(\w+)>([\s\S]*?)<\/function>/);
        if (match) {
          const tool = match[1];
          const callId = `groq-fallback-${Date.now()}`;
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(match[2]); } catch { /* ignore */ }
          return { type: "tool_call", callId, tool, args };
        }
      } catch { /* ignore */ }
    }

    throw new Error(`Groq error (${res.status}): ${text || "unknown"}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  if (choice?.finish_reason === "tool_calls" && choice.message?.tool_calls?.length) {
    const tc = choice.message.tool_calls[0];
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
    return { type: "tool_call", callId: tc.id, tool: tc.function.name, args };
  }

  return { type: "text", content: (choice?.message?.content as string ?? "").trim() };
}
