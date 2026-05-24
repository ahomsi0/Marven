// lib/completion/providers.ts — per-provider single-shot completion adapters.
// All adapters honor AbortSignal so debounce/cancel works end-to-end.

import type { AIProvider } from "@/types";
import type { FimPrompt } from "./fimPrompt";

export interface CompletionRequest {
  provider: AIProvider;
  model: string;
  prompt: FimPrompt;
  signal: AbortSignal;
  /** default 128 */
  maxTokens?: number;
  /** default 0.2 */
  temperature?: number;
}

const DEFAULT_MAX_TOKENS = 128;
const DEFAULT_TEMPERATURE = 0.2;

const OLLAMA_BASE_URL = () =>
  process.env.OLLAMA_URL ?? "http://localhost:11434";
const LM_STUDIO_URL = () =>
  process.env.LM_STUDIO_URL ?? "http://localhost:1234";
const LLAMA_SERVER_URL = () =>
  process.env.LLAMA_SERVER_URL ?? "http://localhost:8080";

function isAbort(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || /aborted/i.test(err.message))
  );
}

export async function completeOnce(req: CompletionRequest): Promise<string> {
  try {
    const raw = await dispatch(req);
    return _postProcess(raw, req.prompt.raw ? "" : suffixFromMessages(req.prompt));
  } catch (err) {
    if (isAbort(err)) return "";
    // Silent error handling per spec; surface to console only.
    console.warn("[completions] provider error:", err);
    return "";
  }
}

function suffixFromMessages(_p: FimPrompt): string {
  // Chat-style suffix echo detection would need the suffix passed separately;
  // we keep it simple and only do raw-format echo handling at the route layer.
  return "";
}

async function dispatch(req: CompletionRequest): Promise<string> {
  const { provider } = req;
  switch (provider) {
    case "openai":
      return openaiChat(req, "https://api.openai.com/v1/chat/completions", {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
      });
    case "anthropic":
      return anthropicMessages(req);
    case "groq":
      return openaiChat(
        req,
        "https://api.groq.com/openai/v1/chat/completions",
        {
          Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`,
        },
      );
    case "openrouter":
      return openaiChat(
        req,
        "https://openrouter.ai/api/v1/chat/completions",
        {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
        },
      );
    case "nim":
      return openaiChat(
        req,
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          Authorization: `Bearer ${process.env.NIM_API_KEY ?? ""}`,
        },
      );
    case "ollama":
      return ollama(req);
    case "lmstudio":
      return openaiCompatible(req, LM_STUDIO_URL());
    case "llamaserver":
      return openaiCompatible(req, LLAMA_SERVER_URL());
    default:
      throw new Error(`Unsupported provider: ${provider as string}`);
  }
}

async function openaiChat(
  req: CompletionRequest,
  url: string,
  extraHeaders: Record<string, string>,
): Promise<string> {
  if (!req.prompt.messages) {
    // For chat endpoints, fall back to a single user message holding raw.
    req.prompt.messages = [{ role: "user", content: req.prompt.raw ?? "" }];
  }
  const body = {
    model: req.model,
    messages: req.prompt.messages,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: req.temperature ?? DEFAULT_TEMPERATURE,
    stop: req.prompt.stop,
    stream: false,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Provider ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  const choice = data.choices?.[0];
  return choice?.message?.content ?? choice?.text ?? "";
}

async function anthropicMessages(req: CompletionRequest): Promise<string> {
  const msgs = req.prompt.messages ?? [];
  const systemMsg = msgs.find((m) => m.role === "system")?.content ?? "";
  const userMsg = msgs.find((m) => m.role === "user")?.content ?? req.prompt.raw ?? "";

  const body = {
    model: req.model,
    system: systemMsg,
    messages: [{ role: "user", content: userMsg }],
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: req.temperature ?? DEFAULT_TEMPERATURE,
    stop_sequences: req.prompt.stop,
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Provider ${res.status}`);
  const data = (await res.json()) as {
    content?: Array<{ text?: string; type?: string }>;
  };
  return data.content?.[0]?.text ?? "";
}

async function ollama(req: CompletionRequest): Promise<string> {
  const base = OLLAMA_BASE_URL();
  const options = {
    stop: req.prompt.stop,
    num_predict: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: req.temperature ?? DEFAULT_TEMPERATURE,
  };
  if (req.prompt.format === "plain") {
    const body = {
      model: req.model,
      messages: req.prompt.messages,
      stream: false,
      options,
    };
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(`Provider ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content ?? "";
  }
  // FIM → /api/generate with raw prompt
  const body = {
    model: req.model,
    prompt: req.prompt.raw ?? "",
    stream: false,
    raw: true,
    options,
  };
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Provider ${res.status}`);
  const data = (await res.json()) as { response?: string };
  return data.response ?? "";
}

async function openaiCompatible(
  req: CompletionRequest,
  baseUrl: string,
): Promise<string> {
  // For OpenAI-compatible servers (LM Studio, llama-server):
  // - chat (plain) → /v1/chat/completions
  // - raw (FIM)   → /v1/completions with `prompt`
  if (req.prompt.format === "plain") {
    return openaiChat(req, `${baseUrl}/v1/chat/completions`, {});
  }
  const body = {
    model: req.model,
    prompt: req.prompt.raw ?? "",
    max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: req.temperature ?? DEFAULT_TEMPERATURE,
    stop: req.prompt.stop,
    stream: false,
  };
  const res = await fetch(`${baseUrl}/v1/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`Provider ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ text?: string; message?: { content?: string } }>;
  };
  const c = data.choices?.[0];
  return c?.text ?? c?.message?.content ?? "";
}

// ──────────────────────────────────────────────────────────────────────────────
// Post-processing
// ──────────────────────────────────────────────────────────────────────────────

export function _postProcess(raw: string, suffix: string): string {
  let out = raw;

  // Strip "Here is..." style explanation prefix.
  out = out.replace(/^[ \t]*Here(?:'s| is)[^\n]*\n/i, "");

  // Strip ```lang fences (open and close).
  out = out.replace(/^[ \t]*```[a-zA-Z0-9_-]*\n?/, "");
  out = out.replace(/\n?```[ \t]*$/, "");
  out = out.replace(/```/g, "");

  // Trim trailing </code>.
  out = out.replace(/<\/code>\s*$/i, "");

  // If completion starts with the first non-empty line of suffix verbatim, drop it.
  if (suffix) {
    const firstSuffixLine = suffix.split("\n").find((l) => l.length > 0);
    if (firstSuffixLine && out.startsWith(firstSuffixLine)) {
      out = out.slice(firstSuffixLine.length);
      if (out.startsWith("\n")) out = out.slice(1);
    }
  }

  // Trim trailing whitespace/newlines only — preserve leading indentation.
  return out.replace(/[\s]+$/u, "");
}
