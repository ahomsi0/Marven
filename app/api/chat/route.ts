import { NextRequest, NextResponse } from "next/server";
import { parseCommand } from "@/lib/commandParser";
import { executeCommand } from "@/lib/executeCommand";
import { streamGroq, DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "@/lib/groq";
import { streamOllama, DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL } from "@/lib/ollama";
import { streamNim, DEFAULT_MODEL as NIM_DEFAULT_MODEL } from "@/lib/nim";
import { streamOpenRouter, DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter";
import { streamOpenAI, DEFAULT_MODEL as OPENAI_DEFAULT_MODEL } from "@/lib/openai";
import { streamAnthropic, DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from "@/lib/anthropic";
import { streamLMStudio, DEFAULT_MODEL as LMSTUDIO_DEFAULT_MODEL } from "@/lib/lmstudio";
import { streamLlamaServer, DEFAULT_MODEL as LLAMASERVER_DEFAULT_MODEL } from "@/lib/llamaserver";
import type { ChatRequest, ChatResponse, HistoryMessage } from "@/types";

type StreamFn = (
  messages: HistoryMessage[],
  model: string,
  systemPrompt: string | undefined,
  signal: AbortSignal,
) => ReadableStream<Uint8Array>;

export async function POST(req: NextRequest) {
  let body: ChatRequest;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { reply: "Invalid request body." },
      { status: 400 }
    );
  }

  const messages: HistoryMessage[] = body.messages ?? [];
  const provider = (body.provider ?? "groq").toLowerCase();
  const defaultModel =
    provider === "ollama"       ? OLLAMA_DEFAULT_MODEL :
    provider === "nim"          ? NIM_DEFAULT_MODEL :
    provider === "openrouter"   ? OPENROUTER_DEFAULT_MODEL :
    provider === "openai"       ? OPENAI_DEFAULT_MODEL :
    provider === "anthropic"    ? ANTHROPIC_DEFAULT_MODEL :
    provider === "lmstudio"     ? LMSTUDIO_DEFAULT_MODEL :
    provider === "llamaserver"  ? LLAMASERVER_DEFAULT_MODEL :
    GROQ_DEFAULT_MODEL;
  const model = body.model?.trim() || defaultModel;

  // The latest user message is the last one in history
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  const messageText = lastUserMessage?.content?.trim() ?? "";

  if (!messageText) {
    return NextResponse.json(
      { reply: "Please send a message." },
      { status: 400 }
    );
  }

  // 1. Try to detect a known command (no custom shortcuts on server — parsed client-side first)
  const command = parseCommand(messageText);

  if (command.type !== null) {
    // 2. Execute the local macOS command — return JSON (not streamed)
    try {
      const reply = await executeCommand(command);
      const response: ChatResponse = { reply, commandExecuted: true };
      return NextResponse.json(response, {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Command failed.";
      return NextResponse.json(
        { reply: `Sorry, I couldn't do that: ${msg}` },
        { status: 500 }
      );
    }
  }

  // 3. No command matched — stream from the selected provider, with the last
  // 20 messages for context. `req.signal` aborts when the client goes away
  // (Stop button, closed window), so the provider request is cancelled instead
  // of streaming into the void. A synchronous throw (missing API key, …)
  // becomes a JSON `{ reply }`.
  const history = messages.slice(-20);
  const streamers: Record<string, { start: StreamFn; failure: (msg: string) => string }> = {
    ollama:      { start: streamOllama,      failure: (m) => `Marven couldn't reach Ollama: ${m}` },
    nim:         { start: streamNim,         failure: (m) => `Marven couldn't reach NVIDIA NIM: ${m}` },
    openrouter:  { start: streamOpenRouter,  failure: (m) => `Marven couldn't reach OpenRouter: ${m}` },
    openai:      { start: streamOpenAI,      failure: (m) => `Marven couldn't reach OpenAI: ${m}` },
    anthropic:   { start: streamAnthropic,   failure: (m) => `Marven couldn't reach Anthropic: ${m}` },
    lmstudio:    { start: streamLMStudio,    failure: (m) => `LM Studio is not running. Start it and try again. (${m})` },
    llamaserver: { start: streamLlamaServer, failure: (m) => `llama-server is not running. Start it and try again. (${m})` },
    groq:        { start: streamGroq,        failure: (m) => `Marven couldn't reach Cloud models: ${m}` },
  };
  const streamer = Object.hasOwn(streamers, provider) ? streamers[provider] : streamers.groq;

  try {
    const stream = streamer.start(history, model, body.systemPrompt, req.signal);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error.";
    return NextResponse.json({ reply: streamer.failure(msg) }, { status: 503 });
  }
}
