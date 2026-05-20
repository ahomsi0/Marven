// lib/agent/openai.ts — OpenAI agent step adapter

import OpenAI from "openai";
import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";
import { buildOpenAIContent } from "@/lib/imageHelpers";
import { parseNarratedToolCall } from "./parseNarratedToolCall";

function toOpenAIMessages(
  messages: InternalMessage[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
    if (m.role === "system") {
      return { role: "system", content: m.content };
    }
    if (m.role === "user") {
      const content = m.attachments?.length
        ? buildOpenAIContent(m.content, m.attachments)
        : m.content;
      return { role: "user", content } as OpenAI.Chat.ChatCompletionUserMessageParam;
    }
    if (m.role === "assistant") {
      return { role: "assistant", content: m.content };
    }
    if (m.role === "assistant_tool_call") {
      return {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: m.callId,
            type: "function",
            function: {
              name: m.tool,
              arguments: JSON.stringify(m.args),
            },
          },
        ],
      } as OpenAI.Chat.ChatCompletionAssistantMessageParam;
    }
    if (m.role === "tool_result") {
      return {
        role: "tool",
        tool_call_id: m.callId,
        content: m.content,
      };
    }
    return { role: "assistant", content: "" };
  });
}

export async function openaiAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set in Settings");

  const client = new OpenAI({ apiKey: key });

  const response = await client.chat.completions.create({
    model,
    messages: toOpenAIMessages(messages),
    tools: tools.map((t) => ({ type: "function" as const, function: t })),
    tool_choice: "auto",
    temperature: 0.2,
  });

  const choice = response.choices[0];

  if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
    const tc = choice.message.tool_calls[0];
    if (tc.type === "function") {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        /* ignore */
      }
      return { type: "tool_call", callId: tc.id, tool: tc.function.name, args };
    }
  }

  const content = (choice.message.content ?? "").trim();
  const narrated = parseNarratedToolCall(content);
  if (narrated) {
    return { type: "tool_call", callId: `openai-narrated-${Date.now()}`, tool: narrated.tool, args: narrated.args };
  }
  return { type: "text", content };
}
