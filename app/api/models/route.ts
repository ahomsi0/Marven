import { NextRequest, NextResponse } from "next/server";
import { GROQ_MODELS, DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "@/lib/groq";
import { fetchInstalledModels, DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL } from "@/lib/ollama";
import { NIM_MODELS, DEFAULT_MODEL as NIM_DEFAULT_MODEL } from "@/lib/nim";
import { OPENROUTER_MODELS, DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL } from "@/lib/openrouter";
import { OPENAI_MODELS, DEFAULT_MODEL as OPENAI_DEFAULT_MODEL } from "@/lib/openai";
import { ANTHROPIC_MODELS, DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL } from "@/lib/anthropic";

export async function GET(req: NextRequest) {
  const provider = (req.nextUrl.searchParams.get("provider") ?? "groq").toLowerCase();

  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { provider: "openai", models: [], defaultModel: OPENAI_DEFAULT_MODEL, error: "No API key — add it in Settings" },
        { status: 401 }
      );
    }
    return NextResponse.json({ provider: "openai", models: OPENAI_MODELS, defaultModel: OPENAI_DEFAULT_MODEL });
  }

  if (provider === "anthropic") {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { provider: "anthropic", models: [], defaultModel: ANTHROPIC_DEFAULT_MODEL, error: "No API key — add it in Settings" },
        { status: 401 }
      );
    }
    return NextResponse.json({ provider: "anthropic", models: ANTHROPIC_MODELS, defaultModel: ANTHROPIC_DEFAULT_MODEL });
  }

  if (provider === "nim") {
    if (!process.env.NIM_API_KEY) {
      return NextResponse.json(
        { provider: "nim", models: [], defaultModel: NIM_DEFAULT_MODEL, error: "No API key — add it in Settings" },
        { status: 401 }
      );
    }
    return NextResponse.json({ provider: "nim", models: NIM_MODELS, defaultModel: NIM_DEFAULT_MODEL });
  }

  if (provider === "ollama") {
    try {
      const models = await fetchInstalledModels();
      return NextResponse.json({
        provider: "ollama",
        models,
        defaultModel: models[0]?.name ?? OLLAMA_DEFAULT_MODEL,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not connect to Ollama.";
      return NextResponse.json(
        { provider: "ollama", models: [], defaultModel: OLLAMA_DEFAULT_MODEL, error: msg },
        { status: 503 }
      );
    }
  }

  if (provider === "openrouter") {
    if (!process.env.OPENROUTER_API_KEY) {
      return NextResponse.json(
        { provider: "openrouter", models: [], defaultModel: OPENROUTER_DEFAULT_MODEL, error: "No API key — add it in Settings" },
        { status: 401 }
      );
    }
    return NextResponse.json({ provider: "openrouter", models: OPENROUTER_MODELS, defaultModel: OPENROUTER_DEFAULT_MODEL });
  }

  // Groq (default)
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { provider: "groq", models: [], defaultModel: GROQ_DEFAULT_MODEL, error: "No API key — add it in Settings" },
      { status: 401 }
    );
  }
  return NextResponse.json({ provider: "groq", models: GROQ_MODELS, defaultModel: GROQ_DEFAULT_MODEL });
}
