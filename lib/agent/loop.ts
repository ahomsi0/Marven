import type { AgentEvent, InternalMessage, ToolDefinition } from "@/types";
import { executeTool } from "./tools";
import type { ProviderStepResult } from "./groq";

const MAX_ITERATIONS = 20;

const AGENT_SYSTEM_PROMPT = `You are Marven Agent, an expert software engineer. You have tools to read, write, and run code in the user's workspace. Always inspect relevant files before making changes. Be precise and concise in your final reply.`;

interface LoopOptions {
  messages: InternalMessage[];
  tools: ToolDefinition[];
  workspaceRoot: string;
  providerStep: (
    messages: InternalMessage[],
    tools: ToolDefinition[],
  ) => Promise<ProviderStepResult>;
  executeToolFn?: typeof executeTool;
}

export async function* runAgentLoop(
  options: LoopOptions
): AsyncGenerator<AgentEvent> {
  const { tools, workspaceRoot, providerStep } = options;
  const exec = options.executeToolFn ?? executeTool;

  const history: InternalMessage[] = [
    { role: "system", content: AGENT_SYSTEM_PROMPT },
    ...options.messages,
  ];

  let toolCallCount = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let result: ProviderStepResult;
    try {
      result = await providerStep(history, tools);
    } catch (err) {
      if (!(err instanceof Error)) {
        yield { type: "error", code: "provider_error", message: String(err) };
        return;
      }
      if (err.name === "OllamaToolsNotSupportedError") {
        const msg = err.message;
        const suggestionsMatch = msg.match(/Compatible Ollama models: (.+)$/);
        const suggestions = suggestionsMatch
          ? suggestionsMatch[1].split(", ")
          : ["qwen2.5-coder", "llama3.1", "mistral-nemo"];
        yield {
          type: "error",
          code: "tools_not_supported",
          message: msg,
          suggestions,
        };
        return;
      }
      yield { type: "error", code: "provider_error", message: err.message };
      return;
    }

    if (result.type === "text") {
      yield { type: "text_delta", delta: result.content };
      yield { type: "done", toolCallCount };
      return;
    }

    toolCallCount++;
    yield {
      type: "tool_call",
      callId: result.callId,
      tool: result.tool,
      args: result.args,
    };

    history.push({
      role: "assistant_tool_call",
      callId: result.callId,
      tool: result.tool,
      args: result.args,
    });

    let output: string;
    try {
      output = await exec(result.tool, result.args, workspaceRoot);
    } catch (err) {
      output = `Error executing tool: ${err instanceof Error ? err.message : String(err)}`;
    }

    const truncated = output.length > 4_000;
    const trimmed = truncated ? output.slice(0, 4_000) + "\n[truncated]" : output;

    yield {
      type: "tool_result",
      callId: result.callId,
      output: trimmed,
      truncated,
    };

    history.push({ role: "tool_result", callId: result.callId, content: trimmed });
  }

  yield {
    type: "error",
    code: "max_iterations",
    message: `Agent stopped after ${MAX_ITERATIONS} iterations.`,
  };
}
