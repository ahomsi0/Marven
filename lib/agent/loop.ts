import type { AgentEvent, InternalMessage, ToolDefinition } from "@/types";
import { executeTool } from "./tools";
import type { ProviderStepResult } from "./groq";
import { readFile } from "fs/promises";
import path from "path";
import { registerApproval } from "./approvals";
import { isGitMutation } from "./tools";
import { recordCheckpoint, clearCheckpoints, getCheckpoint } from "./checkpointStore";
import { createPatch } from "diff";
import { simulateApplyPatch } from "./applyPatch";
import type { WritePreview } from "@/types";
import { makeFullSystemPrompt } from "./systemPrompts";

const MAX_ITERATIONS = 20;
const TERMINAL_PHRASES = ["done", "complete", "finished", "here is", "here's", "all done"] as const;

/** Rough token estimate: 1 token ≈ 4 characters. */
function estimateTokens(messages: InternalMessage[]): number {
  return messages.reduce((sum, m) => {
    const text =
      "content" in m && typeof m.content === "string"
        ? m.content
        : JSON.stringify(m);
    return sum + Math.ceil(text.length / 4);
  }, 0);
}

interface LoopOptions {
  messages: InternalMessage[];
  tools: ToolDefinition[];
  workspaceRoot: string;
  memory?: string;
  systemPrompt?: string;
  providerStep: (
    messages: InternalMessage[],
    tools: ToolDefinition[],
  ) => Promise<ProviderStepResult>;
  executeToolFn?: typeof executeTool;
  onProgress?: (callId: string, chunk: string) => void;
  requireWriteApproval?: boolean;
  planMode?: boolean;
  /** Internal test-only: when set, resolves every registerApproval with this value instead of blocking. */
  _testApprovalResult?: boolean;
}

export async function* runAgentLoop(
  options: LoopOptions
): AsyncGenerator<AgentEvent> {
  const { tools, workspaceRoot, providerStep } = options;
  const exec = options.executeToolFn ?? executeTool;

  // Tracks absolute paths the agent has read via read_file this run.
  // Consumed by write_file's read-before-write + size-shrink guards in tools.ts
  // so weak models can't silently overwrite content they never inspected.
  const recentReads = new Set<string>();

  const history: InternalMessage[] = [
    {
      role: "system",
      content: options.systemPrompt ?? makeFullSystemPrompt(workspaceRoot, options.memory),
    },
    ...options.messages,
  ];

  if (options.planMode) {
    const sysIdx = history.findIndex(m => m.role === "system");
    if (sysIdx >= 0) {
      const sysMsg = history[sysIdx] as { role: "system"; content: string };
      history[sysIdx] = {
        role: "system",
        content: sysMsg.content + "\n\nPLAN MODE: Before making any tool calls, you MUST first output a numbered plan of ALL the steps you will take to complete the task. Format:\n\nPLAN:\n1. [First step]\n2. [Second step]\n...\n\nDo NOT use any tools in this first response — only output the plan. You will be prompted to execute after the plan is approved.",
      };
    }
  }

  clearCheckpoints();

  async function ensureCheckpoint(absPath: string): Promise<void> {
    if (getCheckpoint(absPath) !== undefined) return;
    try {
      const content = await readFile(absPath, "utf8");
      recordCheckpoint(absPath, content.length <= 1_000_000 ? content : "<too large to snapshot>");
    } catch {
      recordCheckpoint(absPath, null);
    }
  }

  let toolCallCount = 0;
  let retryCount = 0;
  let planApprovalDone = false;
  // trimmedAwayTokens tracks how many tokens were in tool output that was cut by
  // the 4000-char output cap before storage. Without this, a single 50KB output
  // would only contribute ~1000 tokens to the estimate (4000 chars / 4), making
  // context pruning never trigger for large-but-capped outputs.
  let trimmedAwayTokens = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let result: ProviderStepResult;
    try {
      result = await providerStep(history, tools);
    } catch (err) {
      if (!(err instanceof Error)) {
        yield { type: "error", code: "provider_error", message: String(err) };
        return;
      }
      if (err.name === "OllamaToolsNotSupportedError") {
        const msg = err.message;
        const suggestionsMatch = msg.match(/Compatible Ollama models: (.+)$/);
        const suggestions = suggestionsMatch
          ? suggestionsMatch[1].split(", ")
          : ["qwen2.5-coder", "llama3.1", "mistral-nemo"];
        yield {
          type: "error",
          code: "tools_not_supported",
          message: msg,
          suggestions,
        };
        return;
      }
      yield { type: "error", code: "provider_error", message: err.message };
      return;
    }

    if (options.planMode && !planApprovalDone && result.type === "text") {
      planApprovalDone = true;
      const planText = result.content;
      const callId = `plan-${Date.now()}`;

      yield { type: "text_delta", delta: planText };
      history.push({ role: "assistant", content: planText });
      yield {
        type: "pending_approval",
        callId,
        tool: "__plan__",
        args: { plan: planText },
      };
      // Close stream — client re-triggers execution after the user approves
      yield { type: "done", toolCallCount: 0 };
      return;
    }

    if (result.type === "text") {
      // Retry on stall: when the model outputs text mid-task without a terminal phrase,
      // push a single recovery prompt and continue.
      const lower = result.content.toLowerCase();
      const isTerminal = TERMINAL_PHRASES.some((p) => lower.includes(p));

      if (i > 0 && retryCount < 1 && !isTerminal) {
        const toolNames = tools.map((t) => t.name).join(", ");
        history.push({
          role: "user",
          content: `You must call a tool next. Do not describe what you will do — call the tool directly. Available tools: ${toolNames}.`,
        });
        retryCount++;
        continue;
      }

      yield { type: "text_delta", delta: result.content };
      yield { type: "done", toolCallCount };
      return;
    }

    toolCallCount++;
    yield {
      type: "tool_call",
      callId: result.callId,
      tool: result.tool,
      args: result.args,
    };

    history.push({
      role: "assistant_tool_call",
      callId: result.callId,
      tool: result.tool,
      args: result.args,
    });

    // 1. Checkpoint files that are about to be modified
    if (result.tool === "write_file" || result.tool === "apply_patch") {
      const rel = result.args.path as string | undefined;
      if (rel) {
        const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
        await ensureCheckpoint(abs);
        yield { type: "checkpoint", path: abs };
      }
    } else if (result.tool === "git_checkout") {
      const target = result.args.target as string | undefined;
      if (target) {
        const abs = path.isAbsolute(target) ? target : path.join(workspaceRoot, target);
        await ensureCheckpoint(abs);
        if (getCheckpoint(abs) !== null) {
          yield { type: "checkpoint", path: abs };
        }
      }
    }

    // 2a. Write-approval gate (opt-in, controlled by requireWriteApproval setting)
    if (options.requireWriteApproval && (result.tool === "write_file" || result.tool === "apply_patch")) {
      const rel = result.args.path as string | undefined;
      if (rel) {
        const abs = path.isAbsolute(rel) ? rel : path.join(workspaceRoot, rel);
        const rawBefore = getCheckpoint(abs);

        if (rawBefore !== "<too large to snapshot>") {
          const before = rawBefore ?? "";
          let after: string | null = null;

          if (result.tool === "write_file") {
            const raw = (result.args.content as string) ?? "";
            after = raw.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
          } else {
            const rawEdits = result.args.edits;
            if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
              // malformed call — skip gate, let executor produce its own error
            } else {
              const edits = (rawEdits as Array<{ search?: unknown; replace?: unknown }>).map((e) => ({
                search: typeof e.search === "string"
                  ? e.search.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
                  : "",
                replace: typeof e.replace === "string"
                  ? e.replace.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
                  : "",
              }));
              after = simulateApplyPatch(before, edits);
            }
          }

          if (after !== null) {
            const diff = createPatch(rel, before, after, "before", "after");
            const preview: WritePreview = { path: rel, before, after, diff };
            yield {
              type: "pending_approval",
              callId: result.callId,
              tool: result.tool,
              args: result.args,
              preview,
            };
            const approved =
              options._testApprovalResult !== undefined
                ? options._testApprovalResult
                : await registerApproval(result.callId, 60_000);
            if (!approved) {
              const rejection = "Rejected by user.";
              yield { type: "tool_result", callId: result.callId, output: rejection, truncated: false };
              history.push({ role: "tool_result", callId: result.callId, content: rejection });
              continue;
            }
          }
        }
      }
    }

    // 2. Approval gating for git mutation tools
    if (isGitMutation(result.tool)) {
      yield {
        type: "pending_approval",
        callId: result.callId,
        tool: result.tool,
        args: result.args,
      };
      const approved = await registerApproval(result.callId, 60_000);
      if (!approved) {
        const rejection = "Rejected by user.";
        yield {
          type: "tool_result",
          callId: result.callId,
          output: rejection,
          truncated: false,
        };
        history.push({ role: "tool_result", callId: result.callId, content: rejection });
        continue;
      }
    }

    // 3. Execute tool with optional progress forwarding
    let output: string;
    try {
      const progressCb = options.onProgress
        ? (chunk: string) => options.onProgress!(result.callId, chunk)
        : undefined;
      output = await exec(result.tool, result.args, workspaceRoot, progressCb, recentReads);
    } catch (err) {
      output = `Error executing tool: ${err instanceof Error ? err.message : String(err)}`;
    }

    const truncated = output.length > 4_000;
    const trimmed = truncated ? output.slice(0, 4_000) + "\n[truncated]" : output;

    yield {
      type: "tool_result",
      callId: result.callId,
      output: trimmed,
      truncated,
    };

    history.push({ role: "tool_result", callId: result.callId, content: trimmed });

    if (truncated) {
      // Account for the content that was cut before being stored in history
      trimmedAwayTokens += Math.ceil((output.length - 4_000) / 4);
    }

    // Context pruning: when history grows large, truncate old tool_result content
    // to keep the model's context window manageable for weak local models.
    const nonSysMessages = history.filter((m) => m.role !== "system");
    if (estimateTokens(nonSysMessages) + trimmedAwayTokens > 3_000) {
      const toolResults = history.filter(
        (m): m is Extract<InternalMessage, { role: "tool_result" }> => m.role === "tool_result",
      );
      const toTruncate = toolResults.slice(0, -2); // preserve last 2
      for (const msg of toTruncate) {
        if (!msg.content.endsWith("[…truncated]")) {
          msg.content = msg.content.slice(0, 200) + " […truncated]";
        }
      }
    }
  }

  yield {
    type: "error",
    code: "max_iterations",
    message: `Agent stopped after ${MAX_ITERATIONS} iterations.`,
  };
}
