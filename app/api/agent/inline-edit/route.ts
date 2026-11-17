// /api/agent/inline-edit — POST endpoint that streams an AI rewrite for a
// selected chunk of code. The system prompt forces the model to return ONLY
// the replacement code (no markdown fences, no commentary). The same provider
// stream helpers used by /api/chat are reused so the active editor provider
// drives the rewrite.

import { NextRequest, NextResponse } from "next/server";
import { streamGroq, DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "@/lib/groq";
import { streamOpenAI, DEFAULT_MODEL as OPENAI_DEFAULT_MODEL } from "@/lib/openai";
import { streamAnthropic, DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from "@/lib/anthropic";
import { streamOpenRouter, DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter";
import { streamNim, DEFAULT_MODEL as NIM_DEFAULT_MODEL } from "@/lib/nim";
import type { AIProvider, HistoryMessage } from "@/types";

interface InlineEditBody {
  selection?: string;
  instruction?: string;
  language?: string;
  provider?: AIProvider;
  model?: string;
}

const SYSTEM_PROMPT = [
  "You are an expert code rewriter. The user has selected a code range and asked for a change.",
  "Return ONLY the replacement code — no explanation, no markdown fences, no commentary.",
  "Do not include text outside the requested change.",
  "Preserve the file's existing indentation and style.",
  "If the user's request is ambiguous, make a reasonable choice rather than asking.",
].join("\n");

export async function POST(req: NextRequest) {
  let body: InlineEditBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const selection = body.selection ?? "";
  const instruction = body.instruction?.trim() ?? "";
  const language = body.language?.trim() || "auto-detect";

  if (!instruction) {
    return NextResponse.json({ error: "instruction is required" }, { status: 400 });
  }
  if (!selection) {
    return NextResponse.json({ error: "selection is required" }, { status: 400 });
  }

  const provider = (body.provider ?? "groq") as AIProvider;
  const model =
    body.model?.trim() ||
    (provider === "groq"       ? GROQ_DEFAULT_MODEL :
     provider === "nim"        ? NIM_DEFAULT_MODEL :
     provider === "openai"     ? OPENAI_DEFAULT_MODEL :
     provider === "anthropic"  ? ANTHROPIC_DEFAULT_MODEL :
     provider === "openrouter" ? OPENROUTER_DEFAULT_MODEL :
     "qwen2.5-coder");

  const userMessage = `Language: ${language}\nInstruction: ${instruction}\n\nCurrent code:\n${selection}`;
  const messages: HistoryMessage[] = [{ role: "user", content: userMessage }];

  try {
    let stream: ReadableStream<Uint8Array>;
    if (provider === "openai")          stream = streamOpenAI(messages, model, SYSTEM_PROMPT);
    else if (provider === "anthropic")  stream = streamAnthropic(messages, model, SYSTEM_PROMPT);
    else if (provider === "nim")        stream = streamNim(messages, model, SYSTEM_PROMPT);
    else if (provider === "openrouter") stream = streamOpenRouter(messages, model, SYSTEM_PROMPT);
    else if (provider === "ollama") {
      return NextResponse.json(
        { error: "Inline edit is not yet supported for Ollama. Pick a streaming provider." },
        { status: 400 }
      );
    } else                              stream = streamGroq(messages, model, SYSTEM_PROMPT);

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
}
