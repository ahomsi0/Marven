import { NextRequest, NextResponse } from "next/server";
import type { AIProvider } from "@/types";
import { DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "@/lib/groq";
import { DEFAULT_MODEL as NIM_DEFAULT_MODEL } from "@/lib/nim";
import { DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter";
import { DEFAULT_MODEL as OPENAI_DEFAULT_MODEL, isOpenAIReasoningModel } from "@/lib/openai";

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
  // Cheap, fast models are enough for summarizing. NIM and OpenRouter used to
  // fall through to a Groq model id here, which neither of them serves.
  const model = body.model ?? (
    provider === "openai"     ? OPENAI_DEFAULT_MODEL :
    provider === "anthropic"  ? "claude-haiku-5-5" :
    provider === "nim"        ? NIM_DEFAULT_MODEL :
    provider === "openrouter" ? OPENROUTER_DEFAULT_MODEL :
    GROQ_DEFAULT_MODEL
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
      // Current Claude models think first, and that counts against max_tokens:
      // 512 could be spent before any summary text was written.
      const res = await client.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: "user", content: `Summarize this conversation:\n\n${conversationText}` }],
      });
      summary = res.content.find((b) => b.type === "text")?.text ?? "";
    } else if (provider === "openai") {
      const OpenAI = (await import("openai")).default;
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error("OPENAI_API_KEY not set");
      const client = new OpenAI({ apiKey: key });
      const res = await client.responses.create({
        model,
        instructions: systemPrompt,
        input: `Summarize this conversation:\n\n${conversationText}`,
        // Reasoning tokens count against this limit on GPT-6 models.
        max_output_tokens: 4096,
        store: false,
        ...(isOpenAIReasoningModel(model) ? { reasoning: { effort: "low" as const } } : {}),
      });
      summary = res.output_text ?? "";
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
          // gpt-oss and the other current defaults are reasoning models whose
          // reasoning tokens count against this limit.
          max_tokens: 2048,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Summarize this conversation:\n\n${conversationText}` },
          ],
        }),
      });
      // Without this check a 429/5xx body parses to no choices and the route
      // returns 200 with an empty summary — which the client would then
      // persist, permanently truncating the thread's memory.
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Summarize request failed (${res.status}): ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      summary = data.choices?.[0]?.message?.content ?? "";
    }

    return NextResponse.json({ summary: summary.trim() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Summarize failed" }, { status: 500 });
  }
}
