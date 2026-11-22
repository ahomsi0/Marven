import type { ContextWindow } from "./contextWindow";

export type FimFormat =
  | "openai-fim"
  | "qwen-fim"
  | "codestral-fim"
  | "deepseek-fim"
  | "plain";

export interface FimPrompt {
  format: FimFormat;
  /** For chat-style providers (OpenAI, Anthropic). */
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** For raw-completion providers (Ollama generate, llama-server completion). */
  raw?: string;
  /** Stop sequences hinted to the provider. */
  stop?: string[];
}

const PLAIN_STOPS = ["\n\n", "```"];

export function buildFimPrompt(ctx: ContextWindow, model: string): FimPrompt {
  const m = model || "";
  if (/codestral/i.test(m)) {
    return {
      format: "codestral-fim",
      raw: `[SUFFIX]${ctx.suffix}[PREFIX]${ctx.prefix}`,
      stop: PLAIN_STOPS,
    };
  }
  if (/qwen.*coder|qwen2.*coder/i.test(m)) {
    return {
      format: "qwen-fim",
      raw: `<|fim_prefix|>${ctx.prefix}<|fim_suffix|>${ctx.suffix}<|fim_middle|>`,
      stop: ["<|endoftext|>", "<|fim_pad|>", "<|repo_name|>", "<|file_sep|>"],
    };
  }
  if (/deepseek.*coder/i.test(m)) {
    return {
      format: "deepseek-fim",
      raw: `<｜fim▁begin｜>${ctx.prefix}<｜fim▁hole｜>${ctx.suffix}<｜fim▁end｜>`,
      stop: ["<｜end▁of▁sentence｜>"],
    };
  }

  const system =
    "You are an inline code completion engine. Output ONLY the code that should be inserted at the cursor. No prose, no markdown, no fences. Stop as soon as the completion is complete (usually one logical unit: a line, an expression, a small block).";

  const user = `File: ${ctx.filename} (${ctx.languageId})

Code before cursor:
\`\`\`${ctx.languageId}
${ctx.prefix}
\`\`\`

Code after cursor:
\`\`\`${ctx.languageId}
${ctx.suffix}
\`\`\`

Insert the code that should appear at the cursor. Output only the insertion.`;

  return {
    format: "plain",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    stop: PLAIN_STOPS,
  };
}
