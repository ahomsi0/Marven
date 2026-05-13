import { NextRequest, NextResponse } from "next/server";
import { parseCommand } from "@/lib/commandParser";
import { executeCommand } from "@/lib/executeCommand";
import { askGroq, streamGroq, DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "@/lib/groq";
import { askOllama, DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL } from "@/lib/ollama";
import type { ChatRequest, ChatResponse, HistoryMessage } from "@/types";

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
  const defaultModel = provider === "ollama" ? OLLAMA_DEFAULT_MODEL : GROQ_DEFAULT_MODEL;
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

  // 3. No command matched — send to selected provider
  if (provider === "ollama") {
    try {
      const reply = await askOllama(messageText, model);
      const response: ChatResponse = { reply, commandExecuted: false };
      return NextResponse.json(response, {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error.";
      return NextResponse.json(
        { reply: `Marven couldn't reach Ollama: ${msg}` },
        { status: 503 }
      );
    }
  }

  // 4. Groq — stream tokens, keep last 20 messages for context
  try {
    const history = messages.slice(-20);
    const stream = streamGroq(history, model, body.systemPrompt);
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
    return NextResponse.json(
      { reply: `Marven couldn't reach Cloud models: ${msg}` },
      { status: 503 }
    );
  }
}

