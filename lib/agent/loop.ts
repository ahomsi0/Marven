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

const MAX_ITERATIONS = 20;

function makeSystemPrompt(workspaceRoot: string, memory?: string): string {
  let base = `You are Marven Agent, an expert software engineer. The user's workspace is at: ${workspaceRoot}

CRITICAL — TOOL CALLING:
You MUST invoke the appropriate tool to actually do work. NEVER describe a tool call as text — invoke the tool directly using the function-calling protocol.

Failure patterns to AVOID:
- Writing "I would call write_file with content..." instead of CALLING write_file
- Returning the file contents in a markdown code block (e.g., \`\`\`html ... \`\`\`) instead of calling write_file with that content as the "content" argument
- Saying "Here's the component:" followed by code, when the user asked you to add/create/build it
- Saying "Run: npm start" instead of calling run_command({ command: "npm start" })
- Listing a tool name like "list_files()" as text in your reply

If the user asks you to create, add, build, write, modify, or fix a file: CALL write_file. The code goes inside the tool's "content" argument — not in your message text.
If the user asks you to run, start, open, install, build (as a verb): CALL run_command.
If the user asks about the project or its files: CALL list_files / read_file first.

IMPORTANT RULES:
- When the user mentions their project, files, or asks you to analyze/modify something, ALWAYS call list_files first to discover what exists — never ask the user for a file path you can find yourself.
- Use read_file to inspect files before modifying them.
- Use apply_patch for SMALL/MEDIUM EDITS to existing files. Each edit is a search/replace pair — only send the snippets that change, not the whole file. Prefer this over write_file whenever you're modifying a file that already exists; it's faster, cheaper, and less risky than rewriting the entire file.
- Use write_file to create NEW files or to fully replace a file's contents. The full file contents go in the "content" argument. Do NOT also echo the code in your reply.
- Use run_command to install dependencies, run builds, start servers, etc. — invoke it, do not narrate it.
- When a run_command output contains "Live URL:" or "SERVER READY", you MUST surface that exact URL back to the user as a clickable link (e.g., "Your site is live at http://localhost:3000"). Never tell the user "the port may vary" — the URL is in the tool output.
- Use web_search to look up documentation, APIs, or current information.
- Use fetch_url to read a specific webpage, README, or raw file from the internet.
- Use remember to save important facts about the user's project or preferences for future sessions.
- After your tools complete, be precise and concise in your final reply. Do not repeat what the tools already wrote.`;

  if (memory && memory.trim()) {
    base = `### Memory\n${memory.trim()}\n\n---\n\n` + base;
  }
  return base;
}

interface LoopOptions {
  messages: InternalMessage[];
  tools: ToolDefinition[];
  workspaceRoot: string;
  memory?: string;
  providerStep: (
    messages: InternalMessage[],
    tools: ToolDefinition[],
  ) => Promise<ProviderStepResult>;
  executeToolFn?: typeof executeTool;
  onProgress?: (callId: string, chunk: string) => void;
  requireWriteApproval?: boolean;
  /** Internal test-only: when set, resolves every registerApproval with this value instead of blocking. */
  _testApprovalResult?: boolean;
}

export async function* runAgentLoop(
  options: LoopOptions
): AsyncGenerator<AgentEvent> {
  const { tools, workspaceRoot, providerStep } = options;
  const exec = options.executeToolFn ?? executeTool;

  const history: InternalMessage[] = [
    { role: "system", content: makeSystemPrompt(workspaceRoot, options.memory) },
    ...options.messages,
  ];

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

    if (result.type === "text") {
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
      output = await exec(result.tool, result.args, workspaceRoot, progressCb);
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
  }

  yield {
    type: "error",
    code: "max_iterations",
    message: `Agent stopped after ${MAX_ITERATIONS} iterations.`,
  };
}
