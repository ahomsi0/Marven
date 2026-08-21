import type { AgentEvent, InternalMessage, ToolDefinition } from "@/types";
import { executeTool, assertSafePath } from "./tools";
import type { ProviderStepResult } from "./groq";
import { readFile } from "fs/promises";
import { registerApproval } from "./approvals";
import { isGitMutation, unescapeModelString } from "./tools";
import { CHECKPOINT_TOO_LARGE, recordCheckpoint, clearCheckpoints, getCheckpoint } from "./checkpointStore";
import { createPatch } from "diff";
import { simulateApplyPatch } from "./applyPatch";
import type { WritePreview } from "@/types";
import { makeFullSystemPrompt } from "./systemPrompts";
import { normalizeAgentSafetyProfile, type AgentSafetyProfile } from "./safety";

const MAX_ITERATIONS = 20;
const TERMINAL_PHRASES = ["done", "complete", "finished", "here is", "here's", "all done"] as const;

// Words that invert the meaning of a nearby terminal phrase ("not done yet",
// "almost finished") — matching those as terminal would end the run mid-task.
const NEGATORS = ["not", "no", "never", "hardly", "barely", "almost", "nearly"] as const;

/**
 * Terminal-phrase detection. Single-word phrases require a word boundary so
 * "incomplete" doesn't match "complete"; a preceding negator ("not done yet")
 * disqualifies the match.
 */
function isTerminalText(content: string): boolean {
  const lower = content.toLowerCase();
  return TERMINAL_PHRASES.some((p) => {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(?!\\b(?:${NEGATORS.join("|")})\\s+)\\b${escaped}\\b`,
      "i",
    );
    return re.test(lower);
  });
}

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
  safetyProfile?: AgentSafetyProfile;
  /** Internal test-only: when set, resolves every registerApproval with this value instead of blocking. */
  _testApprovalResult?: boolean;
}

export async function* runAgentLoop(
  options: LoopOptions
): AsyncGenerator<AgentEvent> {
  const { tools, workspaceRoot, providerStep } = options;
  const exec = options.executeToolFn ?? executeTool;
  // Direct library callers retain the historical opt-in behavior. The API
  // route always supplies the persisted profile, whose default is safe.
  const safetyProfile = options.safetyProfile ? normalizeAgentSafetyProfile(options.safetyProfile) : undefined;

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

  // Scope checkpoint resets to this run's workspace — a global clear would
  // erase another concurrent run's undo baselines mid-flight.
  clearCheckpoints(workspaceRoot);

  async function ensureCheckpoint(absPath: string): Promise<void> {
    if (getCheckpoint(absPath) !== undefined) return;
    try {
      const content = await readFile(absPath, "utf8");
      recordCheckpoint(absPath, content.length <= 1_000_000 ? content : CHECKPOINT_TOO_LARGE, workspaceRoot);
    } catch {
      recordCheckpoint(absPath, null, workspaceRoot);
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

  // Executes one resolved tool call through every gate (read-only block,
  // checkpointing, approvals) and streams its result. Shared by the
  // single-call path and the parallel-calls path so both behave identically.
  async function* handleToolCall(
    callId: string,
    tool: string,
    args: Record<string, unknown>,
    malformedError?: string,
  ): AsyncGenerator<AgentEvent> {
    toolCallCount++;
    yield { type: "tool_call", callId, tool, args };

    history.push({
      role: "assistant_tool_call",
      callId,
      tool,
      args,
    });

    // Malformed arguments JSON: don't execute — tell the model exactly what
    // went wrong so it can re-issue valid arguments. Executing with {} args
    // produces cryptic TypeErrors that burn iterations without recovery.
    if (malformedError) {
      const feedback = `Your tool call "${tool}" had invalid JSON arguments (${malformedError}). Re-issue the SAME tool call with correctly-encoded JSON arguments.`;
      yield { type: "tool_result", callId, output: feedback, truncated: false };
      history.push({ role: "tool_result", callId, content: feedback });
      return;
    }

    if (safetyProfile === "read-only" &&
        (tool === "write_file" || tool === "apply_patch" || tool === "run_command" || tool === "remember" || isGitMutation(tool))) {
      const rejection = "Blocked by the workspace safety profile: this agent is in read-only mode.";
      yield { type: "tool_result", callId, output: rejection, truncated: false };
      history.push({ role: "tool_result", callId, content: rejection });
      return;
    }

    // 1. Checkpoint files that are about to be modified
    if (tool === "write_file" || tool === "apply_patch") {
      const rel = args.path as string | undefined;
      if (rel) {
        try {
          const abs = assertSafePath(workspaceRoot, rel);
          await ensureCheckpoint(abs);
          yield { type: "checkpoint", path: abs };
        } catch {
          // executeTool will return the user-facing boundary error. Do not
          // inspect or expose a path that failed the workspace check.
        }
      }
    } else if (tool === "git_checkout") {
      const target = args.target as string | undefined;
      if (target) {
        try {
          const abs = assertSafePath(workspaceRoot, target);
          await ensureCheckpoint(abs);
          if (getCheckpoint(abs) !== null) {
            yield { type: "checkpoint", path: abs };
          }
        } catch {
          // Branch names and unsafe paths are handled by the git tool itself;
          // neither should cause a preflight read outside the workspace.
        }
      }
    }

    // 2a. Write-approval gate (opt-in, controlled by requireWriteApproval setting)
    if ((options.requireWriteApproval || safetyProfile === "ask-before-write" || safetyProfile === "ask-before-command") && (tool === "write_file" || tool === "apply_patch")) {
      const rel = args.path as string | undefined;
      if (rel) {
        let abs: string;
        try {
          abs = assertSafePath(workspaceRoot, rel);
        } catch {
          // Let executeTool produce the boundary error without previewing the
          // requested path or reading anything outside the workspace.
          abs = "";
        }
        const rawBefore = abs ? getCheckpoint(abs) : undefined;

        if (rawBefore === CHECKPOINT_TOO_LARGE) {
          const preview: WritePreview = {
            path: rel,
            before: "[file too large to snapshot]",
            after: "[full preview unavailable]",
            diff: `*** File too large to preview safely: ${rel}\n`,
          };
          yield {
            type: "pending_approval",
            callId,
            tool,
            args,
            preview,
          };
          const approved =
            options._testApprovalResult !== undefined
              ? options._testApprovalResult
              : await registerApproval(callId, 60_000);
          if (!approved) {
            const rejection = "Rejected by user.";
            yield { type: "tool_result", callId, output: rejection, truncated: false };
            history.push({ role: "tool_result", callId, content: rejection });
            return;
          }
        } else if (rawBefore !== undefined) {
          const before = rawBefore ?? "";
          let after: string | null = null;

          if (tool === "write_file") {
            after = unescapeModelString((args.content as string) ?? "");
          } else {
            const rawEdits = args.edits;
            if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
              // malformed call — skip gate, let executor produce its own error
            } else {
              const edits = (rawEdits as Array<{ search?: unknown; replace?: unknown }>).map((e) => ({
                search: typeof e.search === "string" ? unescapeModelString(e.search) : "",
                replace: typeof e.replace === "string" ? unescapeModelString(e.replace) : "",
              }));
              after = simulateApplyPatch(before, edits);
            }
          }

          if (after !== null) {
            const diff = createPatch(rel, before, after, "before", "after");
            const preview: WritePreview = { path: rel, before, after, diff };
            yield {
              type: "pending_approval",
              callId,
              tool,
              args,
              preview,
            };
            const approved =
              options._testApprovalResult !== undefined
                ? options._testApprovalResult
                : await registerApproval(callId, 60_000);
            if (!approved) {
              const rejection = "Rejected by user.";
              yield { type: "tool_result", callId, output: rejection, truncated: false };
              history.push({ role: "tool_result", callId, content: rejection });
              return;
            }
          }
        }
      }
    }

    // 2. Approval gating for git mutation tools
    if (isGitMutation(tool) && safetyProfile !== "trusted") {
      yield {
        type: "pending_approval",
        callId,
        tool,
        args,
      };
      const approved = await registerApproval(callId, 60_000);
      if (!approved) {
        const rejection = "Rejected by user.";
        yield {
          type: "tool_result",
          callId,
          output: rejection,
          truncated: false,
        };
        history.push({ role: "tool_result", callId, content: rejection });
        return;
      }
    }

    // 2c. Approval gating for shell command execution. run_command spawns an
    // arbitrary shell; the blocklist in tools.ts is only defense-in-depth, so
    // the human approval is the real safety boundary — always gate it.
    if (tool === "run_command" && safetyProfile !== "trusted") {
      yield {
        type: "pending_approval",
        callId,
        tool,
        args,
      };
      const approved =
        options._testApprovalResult !== undefined
          ? options._testApprovalResult
          : await registerApproval(callId, 60_000);
      if (!approved) {
        const rejection = "Rejected by user.";
        yield { type: "tool_result", callId, output: rejection, truncated: false };
        history.push({ role: "tool_result", callId, content: rejection });
        return;
      }
    }

    // 3. Execute tool with optional progress forwarding
    let output: string;
    try {
      const progressCb = options.onProgress
        ? (chunk: string) => options.onProgress!(callId, chunk)
        : undefined;
      output = await exec(tool, args, workspaceRoot, progressCb, recentReads);
    } catch (err) {
      output = `Error executing tool: ${err instanceof Error ? err.message : String(err)}`;
    }

    const truncated = output.length > 4_000;
    const trimmed = truncated ? output.slice(0, 4_000) + "\n[truncated]" : output;

    yield {
      type: "tool_result",
      callId,
      output: trimmed,
      truncated,
    };

    history.push({ role: "tool_result", callId, content: trimmed });

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
      const isTerminal = isTerminalText(result.content);

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

    // Parallel tool calls: providers can emit several calls in one response.
    // Execute each through the same gates sequentially; dropping un-executed
    // calls silently meant requested work never happened.
    if (result.type === "tool_calls") {
      for (const call of result.calls) {
        yield* handleToolCall(call.callId, call.tool, call.args, call.malformedError);
      }
      continue;
    }

    yield* handleToolCall(result.callId, result.tool, result.args);
  }

  yield {
    type: "error",
    code: "max_iterations",
    message: `Agent stopped after ${MAX_ITERATIONS} iterations.`,
  };
}
