import { NextRequest } from "next/server";
import { runAgentLoop } from "@/lib/agent/loop";
import { groqAgentStep } from "@/lib/agent/groq";
import { ollamaAgentStep } from "@/lib/agent/ollama";
import { TOOL_DEFINITIONS } from "@/lib/agent/tools";
import type { AIProvider, InternalMessage, HistoryMessage } from "@/types";

interface StreamRequestBody {
  prompt?: string;
  history?: HistoryMessage[];
  model?: string;
  provider?: AIProvider;
  workspaceRoot?: string;
}

export async function POST(req: NextRequest) {
  let body: StreamRequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? "";
  const workspaceRoot = body.workspaceRoot?.trim() ?? "";

  if (!prompt) {
    return new Response("prompt is required", { status: 400 });
  }
  if (!workspaceRoot) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          `event: error\ndata: ${JSON.stringify({ code: "workspace_not_set", message: "No workspace folder open. Click 'Open Folder' to get started." })}\n\n`
        ));
        controller.close();
      },
    });
    return new Response(stream, { headers: sseHeaders() });
  }

  const provider = (body.provider ?? "groq") as AIProvider;
  const model = body.model ?? (provider === "groq" ? "llama3-groq-70b-8192-tool-use-preview" : "qwen2.5-coder");

  const history: InternalMessage[] = (body.history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  history.push({ role: "user", content: prompt });

  const providerStep = provider === "groq"
    ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => groqAgentStep(msgs, tools, model)
    : (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => ollamaAgentStep(msgs, tools, model);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        ));
      };

      try {
        for await (const event of runAgentLoop({
          messages: history,
          tools: TOOL_DEFINITIONS,
          workspaceRoot,
          providerStep,
        })) {
          emit(event.type, event);
        }
      } catch (err) {
        emit("error", {
          code: "unexpected",
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
