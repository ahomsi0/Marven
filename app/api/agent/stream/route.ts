import { NextRequest } from "next/server";
import { runAgentLoop } from "@/lib/agent/loop";
import { groqAgentStep } from "@/lib/agent/groq";
import { ollamaAgentStep } from "@/lib/agent/ollama";
import { nimAgentStep } from "@/lib/agent/nim";
import { openrouterAgentStep } from "@/lib/agent/openrouter";
import { openaiAgentStep } from "@/lib/agent/openai";
import { anthropicAgentStep } from "@/lib/agent/anthropic";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/agent/tools";
import { mcpClient, mcpToolToDefinition } from "@/lib/mcpClient";
import type { AIProvider, InternalMessage, HistoryMessage, MCPServer, ImageAttachment } from "@/types";
import { classifyTask, type AgentTier } from "@/lib/agent/taskClassifier";
import { makeLiteSystemPrompt, makeFullSystemPrompt } from "@/lib/agent/systemPrompts";

const SIMPLE_TOOL_NAMES = ["list_files", "read_file", "write_file", "search_files"] as const;
const LOCAL_PROVIDERS = ["ollama", "lmstudio", "llamaserver"] as const;

interface StreamRequestBody {
  prompt?: string;
  history?: HistoryMessage[];
  model?: string;
  provider?: AIProvider;
  workspaceRoot?: string;
  memory?: string;
  mcpServers?: MCPServer[];
  requireWriteApproval?: boolean;
  planMode?: boolean;
  attachments?: ImageAttachment[];
  liteAgentMode?: boolean; // true = force lite, false = force standard, undefined = auto
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

  // ── Tier selection (Adaptive Agent Lite Mode) ─────────────────────────────
  // Override rules:
  //   liteAgentMode === true  → always "simple"
  //   liteAgentMode === false → always "standard"
  //   liteAgentMode === undefined (auto) → local: classifier result; cloud: "standard"
  const isLocalProvider = (LOCAL_PROVIDERS as ReadonlyArray<string>).includes(provider);

  let tier: AgentTier;
  if (body.liteAgentMode === true) {
    tier = "simple";
  } else if (body.liteAgentMode === false) {
    tier = "standard";
  } else {
    // auto
    tier = isLocalProvider ? classifyTask(prompt) : "standard";
  }

  const systemPrompt =
    tier === "simple"
      ? makeLiteSystemPrompt(workspaceRoot, body.memory)
      : makeFullSystemPrompt(workspaceRoot, body.memory);

  const model = body.model ?? (
    provider === "groq"      ? "llama-3.3-70b-versatile" :
    provider === "nim"       ? "mistralai/mistral-nemotron" :
    provider === "openai"    ? "gpt-4o-mini" :
    provider === "anthropic" ? "claude-sonnet-4-5" :
    "qwen2.5-coder"
  );

  const history: InternalMessage[] = (body.history ?? []).map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  history.push({ role: "user", content: prompt, ...(body.attachments?.length ? { attachments: body.attachments } : {}) });

  const providerStep =
    provider === "groq"       ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => groqAgentStep(msgs, tools, model) :
    provider === "nim"        ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => nimAgentStep(msgs, tools, model) :
    provider === "openrouter" ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => openrouterAgentStep(msgs, tools, model) :
    provider === "openai"     ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => openaiAgentStep(msgs, tools, model) :
    provider === "anthropic"  ? (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => anthropicAgentStep(msgs, tools, model) :
    (msgs: InternalMessage[], tools: typeof TOOL_DEFINITIONS) => ollamaAgentStep(msgs, tools, model);

  // Merge MCP tools from enabled servers
  const enabledMcpServers = (body.mcpServers ?? []).filter((s) => s.enabled);
  const baseToolDefs =
    tier === "simple"
      ? TOOL_DEFINITIONS.filter((t) => (SIMPLE_TOOL_NAMES as ReadonlyArray<string>).includes(t.name))
      : [...TOOL_DEFINITIONS];
  const allTools = [...baseToolDefs];
  const mcpToolOwners = new Map<string, string>(); // namespaced tool name → server id

  for (const server of enabledMcpServers) {
    try {
      const mcpTools = await mcpClient.listTools(server.id);
      for (const tool of mcpTools) {
        const def = mcpToolToDefinition(server.name, tool);
        allTools.push(def);
        mcpToolOwners.set(def.name, server.id);
      }
    } catch {
      // Server not connected — skip its tools silently
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
        ));
      };

      const onProgress = (callId: string, chunk: string) => {
        emit("tool_progress", { type: "tool_progress", callId, chunk });
      };

      try {
        for await (const event of runAgentLoop({
          messages: history,
          tools: allTools,
          workspaceRoot,
          memory: body.memory,   // loop fallback only — systemPrompt already embeds memory
          systemPrompt,
          providerStep,
          onProgress,
          requireWriteApproval: body.requireWriteApproval ?? false,
          planMode: body.planMode ?? false,
          executeToolFn: async (name, args, root, onProgressCb) => {
            // Route MCP tools to the MCP client
            const mcpServerId = mcpToolOwners.get(name);
            if (mcpServerId) {
              const toolName = name.split("__").slice(1).join("__");
              try {
                return await mcpClient.callTool(mcpServerId, toolName, args);
              } catch (err) {
                return `MCP tool error: ${err instanceof Error ? err.message : String(err)}`;
              }
            }
            // Built-in tools
            return executeTool(name, args, root, onProgressCb);
          },
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
