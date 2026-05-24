import { NextResponse } from "next/server";
import { extractContextWindow } from "@/lib/completion/contextWindow";
import { buildFimPrompt } from "@/lib/completion/fimPrompt";
import { completeOnce } from "@/lib/completion/providers";
import type {
  InlineCompletionRequest,
  InlineCompletionResponse,
  AIProvider,
} from "@/types";

const TIMEOUT_MS = 4000;
const VALID_PROVIDERS: AIProvider[] = [
  "groq",
  "ollama",
  "nim",
  "openrouter",
  "openai",
  "anthropic",
  "lmstudio",
  "llamaserver",
];

function isValid(body: unknown): body is InlineCompletionRequest {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.prefix === "string" &&
    typeof b.suffix === "string" &&
    typeof b.filePath === "string" &&
    typeof b.languageId === "string" &&
    typeof b.provider === "string" &&
    VALID_PROVIDERS.includes(b.provider as AIProvider) &&
    typeof b.model === "string"
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isValid(body)) {
    return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
  }

  // Wrap the (already split) prefix/suffix into a ContextWindow shape.
  // We still call extractContextWindow to keep filename/languageId derivation
  // consistent, but in practice the route just trusts the caller's split.
  const docForCtx = body.prefix + body.suffix;
  const ctxBase = extractContextWindow(docForCtx, body.prefix.length, body.filePath);
  const ctx = {
    ...ctxBase,
    languageId: body.languageId || ctxBase.languageId,
  };

  const prompt = buildFimPrompt(ctx, body.model);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Forward client-side abort.
  if (request.signal) {
    if (request.signal.aborted) controller.abort();
    else request.signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const completion = await completeOnce({
      provider: body.provider,
      model: body.model,
      prompt,
      signal: controller.signal,
    });
    const payload: InlineCompletionResponse = { completion };
    return NextResponse.json(payload);
  } catch (err) {
    console.warn("[inline-completion] provider failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Provider failed" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timer);
  }
}
