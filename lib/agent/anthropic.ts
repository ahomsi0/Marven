// lib/agent/anthropic.ts — Anthropic agent step adapter

import Anthropic from "@anthropic-ai/sdk";
import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";
import { buildAnthropicContent } from "@/lib/imageHelpers";
import { parseNarratedToolCall } from "./parseNarratedToolCall";

/** Extract system prompt and convert remaining messages to Anthropic format. */
function toAnthropicMessages(messages: InternalMessage[]): {
  system: string;
  messages: Anthropic.MessageParam[];
} {
  const systemMsg = messages.find((m) => m.role === "system");
  const system = systemMsg?.content ?? "";

  const converted: Anthropic.MessageParam[] = messages
    .filter((m) => m.role !== "system")
    .flatMap((m): Anthropic.MessageParam[] => {
      if (m.role === "user") {
        const content = m.attachments?.length
          ? buildAnthropicContent(m.content, m.attachments)
          : m.content;
        return [{ role: "user" as const, content: content as Anthropic.MessageParam["content"] }];
      }
      if (m.role === "assistant") {
        return [{ role: "assistant" as const, content: m.content }];
      }
      if (m.role === "assistant_tool_call") {
        return [
          {
            role: "assistant" as const,
            content: [
              {
                type: "tool_use" as const,
                id: m.callId,
                name: m.tool,
                input: m.args,
              },
            ],
          },
        ];
      }
      if (m.role === "tool_result") {
        return [
          {
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: m.callId,
                content: m.content,
              },
            ],
          },
        ];
      }
      return [];
    });

  return { system, messages: converted };
}

export async function anthropicAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set in Settings");

  const client = new Anthropic({ apiKey: key });
  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system,
    messages: anthropicMessages,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool["input_schema"],
    })),
  });

  // Check for tool use block first
  const toolUseBlock = response.content.find((b) => b.type === "tool_use");
  if (toolUseBlock && toolUseBlock.type === "tool_use") {
    return {
      type: "tool_call",
      callId: toolUseBlock.id,
      tool: toolUseBlock.name,
      args: toolUseBlock.input as Record<string, unknown>,
    };
  }

  // Text response
  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  const narrated = parseNarratedToolCall(text);
  if (narrated) {
    return { type: "tool_call", callId: `anthropic-narrated-${Date.now()}`, tool: narrated.tool, args: narrated.args };
  }
  return { type: "text", content: text };
}
