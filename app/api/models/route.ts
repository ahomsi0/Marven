import { NextRequest, NextResponse } from "next/server";
import { GROQ_MODELS } from "@/lib/groq";
import { fetchInstalledModels, DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL } from "@/lib/ollama";
import { DEFAULT_MODEL as GROQ_DEFAULT_MODEL } from "@/lib/groq";

export async function GET(req: NextRequest) {
  const provider = (req.nextUrl.searchParams.get("provider") ?? "groq").toLowerCase();

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
        {
          provider: "ollama",
          models: [],
          defaultModel: OLLAMA_DEFAULT_MODEL,
          error: msg,
        },
        { status: 503 }
      );
    }
  }

  return NextResponse.json({
    provider: "groq",
    models: GROQ_MODELS,
    defaultModel: GROQ_DEFAULT_MODEL,
  });
}
