import { NextRequest, NextResponse } from "next/server";
import type { AIProvider, HistoryMessage } from "@/types";
import { runGit } from "@/lib/agent/git";
import { askGroq } from "@/lib/groq";
import { askOllama } from "@/lib/ollama";
import { streamOpenAI } from "@/lib/openai";
import { streamOpenRouter } from "@/lib/openrouter";
import { streamAnthropic } from "@/lib/anthropic";
import { streamNim } from "@/lib/nim";
import { streamLMStudio } from "@/lib/lmstudio";
import { streamLlamaServer } from "@/lib/llamaserver";

type AssistMode = "commit_message" | "commit_groups" | "pr_summary" | "explain_changes";

async function streamToText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  return text.replace(/\n\n__USAGE__[\s\S]*$/, "").trim();
}

async function completeText(
  provider: AIProvider,
  model: string,
  messages: HistoryMessage[],
  systemPrompt: string,
): Promise<string> {
  if (provider === "groq") {
    const result = await askGroq(messages, model, systemPrompt);
    return result.reply.trim();
  }
  if (provider === "ollama") {
    const prompt = [systemPrompt, ...messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`)].join("\n\n");
    return askOllama(prompt, model);
  }
  if (provider === "openai") return streamToText(streamOpenAI(messages, model, systemPrompt));
  if (provider === "openrouter") return streamToText(streamOpenRouter(messages, model, systemPrompt));
  if (provider === "anthropic") return streamToText(streamAnthropic(messages, model, systemPrompt));
  if (provider === "nim") return streamToText(streamNim(messages, model, systemPrompt));
  if (provider === "lmstudio") return streamToText(streamLMStudio(messages, model, systemPrompt));
  if (provider === "llamaserver") return streamToText(streamLlamaServer(messages, model, systemPrompt));
  return streamToText(streamOpenAI(messages, model, systemPrompt));
}

function makePrompt(mode: AssistMode, diff: string, stagedDiff: string, status: string): { system: string; user: string } {
  const system =
    "You are Marven's git assistant. Work only from the actual git diff and status. Be accurate, concise, and concrete. Do not invent files or changes that are not present.";

  const context = `Git status:\n${status || "(clean)"}\n\nStaged diff:\n${stagedDiff || "(none)"}\n\nWorking diff:\n${diff || "(none)"}`;

  if (mode === "commit_message") {
    return {
      system,
      user: `${context}\n\nWrite exactly one commit message in imperative mood. No quotes, no bullets, no prefix, max 72 characters if possible.`,
    };
  }
  if (mode === "commit_groups") {
    return {
      system,
      user: `${context}\n\nGroup these changes into the smallest sensible commits. Use markdown bullets. For each commit, include: title, why it exists, and the files that belong in it.`,
    };
  }
  if (mode === "pr_summary") {
    return {
      system,
      user: `${context}\n\nDraft a pull request summary in markdown with these sections: Summary, Key Changes, Risks, Testing.`,
    };
  }
  return {
    system,
    user: `${context}\n\nExplain the changes in plain engineering language. Focus on what changed, why it matters, and any behavior or risk implied by the diff.`,
  };
}

function limit(text: string, max = 18000): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated]` : text;
}

export async function POST(req: NextRequest) {
  let body: { workspaceRoot?: string; provider?: AIProvider; model?: string; mode?: AssistMode };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceRoot = body.workspaceRoot?.trim();
  const provider = body.provider;
  const model = body.model?.trim();
  const mode = body.mode;
  if (!workspaceRoot || !provider || !model || !mode) {
    return NextResponse.json({ error: "workspaceRoot, provider, model, and mode are required" }, { status: 400 });
  }

  try {
    const [status, diff, stagedDiff] = await Promise.all([
      runGit(["status", "--short"], workspaceRoot),
      runGit(["diff", "HEAD"], workspaceRoot),
      runGit(["diff", "--cached"], workspaceRoot),
    ]);

    const prompt = makePrompt(mode, limit(diff), limit(stagedDiff), limit(status, 4000));
    const text = await completeText(provider, model, [{ role: "user", content: prompt.user }], prompt.system);
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
