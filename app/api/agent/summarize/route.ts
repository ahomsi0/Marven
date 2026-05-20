import { NextRequest, NextResponse } from "next/server";
import type { AIProvider } from "@/types";

interface SummarizeRequest {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  provider?: AIProvider;
  model?: string;
}

export async function POST(req: NextRequest) {
  let body: SummarizeRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = (body.provider ?? "groq") as AIProvider;
  const model = body.model ?? (
    provider === "groq"      ? "llama-3.3-70b-versatile" :
    provider === "openai"    ? "gpt-4o-mini" :
    provider === "anthropic" ? "claude-haiku-4-5-20251001" :
    "llama-3.3-70b-versatile"
  );

  const conversationText = body.messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const systemPrompt = "You are a summarizer. Given a conversation between a user and an AI assistant, produce a concise factual summary (3-8 bullet points) capturing: what was asked, what was discovered, what files/code were created or changed, and what decisions were made. Be specific about file paths and key outcomes. Format as bullet points starting with •.";

  try {
    let summary = "";

    if (provider === "anthropic") {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY not set");
      const client = new Anthropic({ apiKey: key });
      const res = await client.messages.create({
        model,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: "user", content: `Summarize this conversation:\n\n${conversationText}` }],
      });
      summary = res.content.find((b) => b.type === "text")?.text ?? "";
    } else if (provider === "openai") {
      const OpenAI = (await import("openai")).default;
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY not set");
      const client = new OpenAI({ apiKey: key });
      const res = await client.chat.completions.create({
        model,
        max_tokens: 512,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Summarize this conversation:\n\n${conversationText}` },
        ],
      });
      summary = res.choices[0]?.message?.content ?? "";
    } else {
      // Groq / OpenRouter / NIM all use OpenAI-compatible API
      const apiUrl =
        provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" :
        provider === "nim" ? "https://integrate.api.nvidia.com/v1/chat/completions" :
        "https://api.groq.com/openai/v1/chat/completions";
      const key =
        provider === "openrouter" ? process.env.OPENROUTER_API_KEY :
        provider === "nim" ? process.env.NIM_API_KEY :
        process.env.GROQ_API_KEY;
      if (!key) throw new Error(`API key not set for provider: ${provider}`);

      const res = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_tokens: 512,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Summarize this conversation:\n\n${conversationText}` },
          ],
        }),
      });
      const data = await res.json();
      summary = data.choices?.[0]?.message?.content ?? "";
    }

    return NextResponse.json({ summary: summary.trim() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Summarize failed" }, { status: 500 });
  }
}
