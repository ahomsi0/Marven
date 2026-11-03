// lib/agent/localOpenAi.ts — agent step for local OpenAI-compatible servers
// (LM Studio, llama-server). Both expose /v1/chat/completions with the OpenAI
// tool-calling shape, so one adapter serves both. Base URLs are read from the
// environment on every call because Electron's applySettings can change them
// while the server is running.

import type { ToolDefinition, InternalMessage } from "@/types";
import type { ProviderStepResult } from "./groq";
import { parseOpenAiStyleToolCall } from "./groq";
import { stripAttachments } from "@/lib/imageHelpers";
import { parseNarratedToolCall } from "./parseNarratedToolCall";
import { extractJsonToolCall } from "./ollama";

export type LocalOpenAiProvider = "lmstudio" | "llamaserver";

interface LocalServerInfo {
  label: string;
  apiKey: string;
  baseUrl: string;
}

/** Resolve the server's label, placeholder API key and base URL (read per call). */
export function localServerInfo(provider: LocalOpenAiProvider): LocalServerInfo {
  if (provider === "lmstudio") {
    return {
      label: "LM Studio",
      apiKey: "lm-studio",
      baseUrl: (process.env.LM_STUDIO_URL || "http://localhost:1234").replace(/\/+$/, ""),
    };
  }
  return {
    label: "llama-server",
    apiKey: "llama-server",
    baseUrl: (process.env.LLAMA_SERVER_URL || "http://localhost:8080").replace(/\/+$/, ""),
  };
}

function toOpenAiMessages(messages: InternalMessage[]): Array<Record<string, unknown>> {
  return messages.flatMap((m): Array<Record<string, unknown>> => {
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
      }];
    }
    if (m.role === "tool_result") {
      return [{ role: "tool", tool_call_id: m.callId, content: m.content }];
    }
    return [];
  }) as Array<Record<string, unknown>>;
}

/** True when a server error says the request's `tools` field isn't supported. */
function isToolsUnsupportedError(status: number, text: string): boolean {
  if (status !== 400 && status !== 422 && status !== 500 && status !== 501) return false;
  return /tool|jinja|function/i.test(text);
}

/**
 * Turn an OpenAI-style chat completion response into a step result: native
 * tool_calls first, then inline JSON / function-call syntax, then narrated
 * `<function=...>` blocks, else plain text.
 */
export function parseLocalCompletion(data: unknown, idPrefix: string): ProviderStepResult {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown[] } }> })
    ?.choices?.[0];
  const toolCalls = choice?.message?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length) {
    const calls = toolCalls.map((tc) =>
      parseOpenAiStyleToolCall(tc as Parameters<typeof parseOpenAiStyleToolCall>[0], `${idPrefix}-call`),
    );
    if (calls.length === 1) {
      const { callId, tool, args } = calls[0];
      return { type: "tool_call", callId, tool, args };
    }
    return { type: "tool_calls", calls };
  }

  const text = (typeof choice?.message?.content === "string" ? choice.message.content : "").trim();

  const jsonFallback = extractJsonToolCall(text);
  if (jsonFallback) {
    return {
      type: "tool_call",
      callId: `${idPrefix}-fb-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      tool: jsonFallback.name,
      args: jsonFallback.args,
    };
  }

  const narrated = parseNarratedToolCall(text);
  if (narrated) {
    return { type: "tool_call", callId: `${idPrefix}-narrated-${Date.now()}`, tool: narrated.tool, args: narrated.args };
  }

  return { type: "text", content: text };
}

export async function localOpenAiAgentStep(
  provider: LocalOpenAiProvider,
  messages: InternalMessage[],
  tools: ToolDefinition[],
  model: string,
): Promise<ProviderStepResult> {
  const { label, apiKey, baseUrl } = localServerInfo(provider);

  const post = async (withTools: boolean): Promise<Response> => {
    try {
      return await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: toOpenAiMessages(messages),
          ...(withTools && tools.length
            ? { tools: tools.map((t) => ({ type: "function", function: t })), tool_choice: "auto" }
            : {}),
          temperature: 0.2,
          stream: false,
        }),
      });
    } catch {
      throw new Error(`Could not connect to ${label} at ${baseUrl}. Make sure the server is running.`);
    }
  };

  let res = await post(true);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Some servers/templates reject the `tools` field (llama-server without
    // --jinja, older LM Studio builds). Retry without it and rely on the
    // inline-JSON / narrated tool-call fallbacks below.
    if (isToolsUnsupportedError(res.status, text)) {
      res = await post(false);
      if (!res.ok) {
        const retryText = await res.text().catch(() => "");
        throw new Error(`${label} error (${res.status}): ${retryText || "unknown"}`);
      }
    } else {
      throw new Error(`${label} error (${res.status}): ${text || "unknown"}`);
    }
  }

  const data = await res.json();
  return parseLocalCompletion(data, provider);
}
