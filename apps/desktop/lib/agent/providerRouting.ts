// lib/agent/providerRouting.ts — pick the agent step + fallback model per provider.

import type { AIProvider, InternalMessage, ToolDefinition } from "@/types";
import { groqAgentStep, type ProviderStepResult } from "./groq";
import { ollamaAgentStep } from "./ollama";
import { nimAgentStep } from "./nim";
import { openrouterAgentStep } from "./openrouter";
import { openaiAgentStep } from "./openai";
import { anthropicAgentStep } from "./anthropic";
import { localOpenAiAgentStep } from "./localOpenAi";
import { DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "@/lib/groq";
import { DEFAULT_MODEL as NIM_DEFAULT_MODEL } from "@/lib/nim";
import { DEFAULT_MODEL as OPENAI_DEFAULT_MODEL } from "@/lib/openai";
import { DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from "@/lib/anthropic";

export type AgentProviderStep = (
  msgs: InternalMessage[],
  tools: ToolDefinition[],
) => Promise<ProviderStepResult>;

/**
 * Model used when the request didn't name one. Local OpenAI-compatible servers
 * (LM Studio, llama-server) get a neutral placeholder — they serve whatever is
 * loaded, and an Ollama tag like "qwen2.5-coder" means nothing to them.
 */
export function defaultAgentModel(provider: AIProvider): string {
  switch (provider) {
    case "groq": return GROQ_DEFAULT_MODEL;
    case "nim": return NIM_DEFAULT_MODEL;
    case "openai": return OPENAI_DEFAULT_MODEL;
    case "anthropic": return ANTHROPIC_DEFAULT_MODEL;
    case "lmstudio":
    case "llamaserver":
      return "local-model";
    default:
      return "qwen2.5-coder";
  }
}

/** Build the agent step for a provider/model pair. */
export function makeAgentProviderStep(provider: AIProvider, model: string): AgentProviderStep {
  return (msgs, tools) => {
    switch (provider) {
      case "groq": return groqAgentStep(msgs, tools, model);
      case "nim": return nimAgentStep(msgs, tools, model);
      case "openrouter": return openrouterAgentStep(msgs, tools, model);
      case "openai": return openaiAgentStep(msgs, tools, model);
      case "anthropic": return anthropicAgentStep(msgs, tools, model);
      case "lmstudio": return localOpenAiAgentStep("lmstudio", msgs, tools, model);
      case "llamaserver": return localOpenAiAgentStep("llamaserver", msgs, tools, model);
      default: return ollamaAgentStep(msgs, tools, model);
    }
  };
}
