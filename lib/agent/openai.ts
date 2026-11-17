// lib/agent/openai.ts — OpenAI agent step adapter (Responses API)

import OpenAI from "openai";
import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
  ResponseOutputItem,
  ResponseReasoningItem,
} from "openai/resources/responses/responses";
import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";
import { parseOpenAiStyleToolCall } from "./groq";
import { buildResponsesUserContent, isOpenAIReasoningModel, OPENAI_REFUSAL_MESSAGE } from "@/lib/openai";
import { parseNarratedToolCall } from "./parseNarratedToolCall";

/**
 * Reasoning models want the reasoning items that came with a tool call sent
 * back with it, and Marven's history only keeps the call itself. So the items
 * OpenAI returned are remembered here by call id and replayed in place of the
 * bare call. If an entry is missing (server restarted, evicted), the bare call
 * is sent instead, which the API accepts with less context.
 */
interface ReplayEntry {
  /** Reasoning items emitted before this call (only on a response's first call). */
  reasoning: ResponseReasoningItem[];
  call: ResponseFunctionToolCall;
}

const MAX_REPLAY_ENTRIES = 500;
const replayByCallId = new Map<string, ReplayEntry>();

function rememberReplay(callId: string, entry: ReplayEntry): void {
  replayByCallId.delete(callId);
  replayByCallId.set(callId, entry);
  while (replayByCallId.size > MAX_REPLAY_ENTRIES) {
    const oldest = replayByCallId.keys().next().value;
    if (oldest === undefined) break;
    replayByCallId.delete(oldest);
  }
}

/** Test hook. */
export function clearOpenAIReplayCache(): void {
  replayByCallId.clear();
}

export function toResponsesInput(messages: InternalMessage[]): ResponseInputItem[] {
  return messages.flatMap((m): ResponseInputItem[] => {
    if (m.role === "system") {
      return [{ role: "system", content: m.content }];
    }
    if (m.role === "user") {
      return [{ role: "user", content: buildResponsesUserContent(m.content, m.attachments) }];
    }
    if (m.role === "assistant") {
      return [{ role: "assistant", content: m.content }];
    }
    if (m.role === "assistant_tool_call") {
      const replay = replayByCallId.get(m.callId);
      if (replay) return [...replay.reasoning, replay.call];
      return [{
        type: "function_call",
        call_id: m.callId,
        name: m.tool,
        arguments: JSON.stringify(m.args),
      }];
    }
    if (m.role === "tool_result") {
      return [{ type: "function_call_output", call_id: m.callId, output: m.content }];
    }
    return [];
  });
}

/**
 * Turn a response's output items into a step result, remembering each call's
 * items for replay on the next step.
 */
export function stepFromResponseOutput(output: ResponseOutputItem[], outputText: string): ProviderStepResult {
  const calls: ResponseFunctionToolCall[] = [];
  let pendingReasoning: ResponseReasoningItem[] = [];
  let refused = false;

  for (const item of output) {
    if (item.type === "reasoning") {
      pendingReasoning.push(item);
    } else if (item.type === "function_call") {
      calls.push(item);
      rememberReplay(item.call_id, { reasoning: pendingReasoning, call: item });
      pendingReasoning = [];
    } else if (item.type === "message") {
      refused ||= item.content.some((c) => c.type === "refusal");
    }
  }

  if (calls.length > 0) {
    const parsed = calls.map((c) =>
      parseOpenAiStyleToolCall({ id: c.call_id, function: { name: c.name, arguments: c.arguments } }, "openai-call"),
    );
    if (parsed.length === 1) {
      const { callId, tool, args } = parsed[0];
      return { type: "tool_call", callId, tool, args };
    }
    return { type: "tool_calls", calls: parsed };
  }

  const content = outputText.trim();
  if (!content && refused) return { type: "text", content: OPENAI_REFUSAL_MESSAGE };
  const narrated = parseNarratedToolCall(content);
  if (narrated) {
    return { type: "tool_call", callId: `openai-narrated-${Date.now()}`, tool: narrated.tool, args: narrated.args };
  }
  return { type: "text", content };
}

export async function openaiAgentStep(
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string
): Promise<ProviderStepResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set in Settings");

  const client = new OpenAI({ apiKey: key });

  const response = await client.responses.create({
    model,
    input: toResponsesInput(messages),
    tools: tools.map((t) => ({
      type: "function" as const,
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
      // Marven's schemas aren't written for strict mode (optional fields).
      strict: false,
    })),
    tool_choice: "auto",
    store: false,
    // Stateless requests need the encrypted reasoning to replay it. The API now
    // returns it by default but still accepts asking for it explicitly.
    ...(isOpenAIReasoningModel(model) ? { include: ["reasoning.encrypted_content" as const] } : {}),
  });

  return stepFromResponseOutput(response.output, response.output_text ?? "");
}
