"use client";

// Mini Me's "Build it here": makes a fresh project folder, runs Marven's real
// Agent on it in the background with the user's agent settings, and turns the
// Agent's event stream into a calm bubble view (latest step, approvals, result).
//
// Mini Me answers an approval itself only for file writes inside the folder it
// just created (shouldAutoApprove); everything else is asked in the bubble.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AIProvider } from "@/types";
import i18n from "@/lib/i18n";
import { consumeSse } from "@/lib/agent/sse";
import { normalizeAgentSafetyProfile } from "@/lib/agent/safety";
import {
  approvalSummary,
  extractLiveUrl,
  plainSummary,
  progressLabel,
  shouldAutoApprove,
  type ApprovalKind,
  type ProgressLabel,
} from "@/lib/companion/buildRun";
import { setWorkspaceTrusted } from "@/lib/workspaceTrust";
import { loadAgentModelMap, loadAgentProvider } from "@/lib/modelPrefs";
import { buildMemoryContext } from "@/lib/chatPrompt";
import { loadMemories } from "@/lib/userProfile";
import { chatErrorMessage, classifyProviderError, providerErrorMessage } from "@/lib/chatErrors";
import { speak } from "@/lib/speak";
import { loadGlobalMemories } from "@/hooks/useCompanionBrain";

export type BuildPhase = "preparing" | "running" | "done" | "failed" | "stopped" | "blocked";

export interface BuildApproval {
  callId: string;
  kind: ApprovalKind;
  detail: string;
  /** The answer is on its way to the server. */
  sending: boolean;
}

export interface BuildView {
  phase: BuildPhase;
  name: string;
  request: string;
  /** The project folder, once created. */
  root: string | null;
  /** Tool calls so far. */
  steps: number;
  label: ProgressLabel;
  /** Something only the user may answer. */
  approval: BuildApproval | null;
  /** Another build was asked for while this one runs. */
  conflict: { name: string } | null;
  summary: string;
  liveUrl: string | null;
  /** Why it failed (or is blocked), in plain words. */
  error: string | null;
  /** The error is fixed in Settings: offer to open them. */
  settingsHint: boolean;
}

/** Why the bubble should come up: the host opens it (unfocused) and reacts. */
export type BuildAttention = "approval" | "conflict" | "done" | "failed" | "blocked";

interface Options {
  /** Where projects go (Settings → Mini Me); a leading ~ is the home folder. */
  projectsDir: string;
  speakReplies: boolean;
  onSpeakingChange?: (speaking: boolean) => void;
  onAttention: (reason: BuildAttention) => void;
}

const APPROVE_RETRIES = 8;
const APPROVE_RETRY_MS = 250;
const ERROR_DETAIL_MAX = 160;

export const isBuildActive = (view: BuildView | null) => !!view && (view.phase === "preparing" || view.phase === "running");

/** The request, plus what the Agent needs to know about where it is. */
function buildPrompt(request: string): string {
  return `${request}\n\n(You're working in a brand-new, empty project folder made for this request. Build it there. When you're done, end with a short, friendly summary of what you made and how to open it.)`;
}

async function readAgentSettings(): Promise<{ agentSafetyProfile?: unknown; liteAgentMode?: unknown } | null> {
  try {
    const electron = (window as unknown as { marvenElectron?: { getSettings?: () => Promise<unknown> } }).marvenElectron;
    const s = electron?.getSettings ? await electron.getSettings() : null;
    return s && typeof s === "object" ? (s as { agentSafetyProfile?: unknown; liteAgentMode?: unknown }) : null;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Answers a pending approval. A 404 right after the event can mean the server
 * hasn't registered it yet, so that is retried; afterwards it means the
 * approval is gone (answered, timed out, or the run ended). True when accepted by the server.
 */
async function postApproval(callId: string, accept: boolean, retries = 0): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId, accept }),
      });
      if (res.ok) return true;
      if (res.status !== 404 || attempt >= retries) return false;
    } catch {
      if (attempt >= retries) return false;
    }
    await sleep(APPROVE_RETRY_MS);
  }
}

/** Plain words for an `error` event from the Agent, and whether Settings fixes it. */
function describeAgentError(event: Extract<AgentEvent, { type: "error" }>, provider: AIProvider, model: string): { message: string; settings: boolean } {
  switch (event.code) {
    case "workspace_not_set":
      return { message: i18n.t("companion.build.error.workspace"), settings: false };
    case "tools_not_supported":
      return { message: i18n.t("companion.build.error.tools"), settings: true };
    case "max_iterations":
      return { message: i18n.t("companion.build.error.steps"), settings: false };
    case "provider_error": {
      const err = { provider, model: model || undefined, message: event.message };
      const kind = classifyProviderError(err);
      return { message: providerErrorMessage(err), settings: kind === "auth" || kind === "model" };
    }
    default:
      return {
        message: i18n.t("companion.build.error.unexpected", { detail: (event.message || event.code).slice(0, ERROR_DETAIL_MAX) }),
        settings: false,
      };
  }
}

export function useCompanionBuild(options: Options) {
  const [view, setView] = useState<BuildView | null>(null);
  const viewRef = useRef<BuildView | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const commit = useCallback((next: BuildView | null) => {
    viewRef.current = next;
    setView(next);
  }, []);
  const patch = useCallback(
    (runId: number, changes: Partial<BuildView>) => {
      if (runId !== runIdRef.current || !viewRef.current) return;
      commit({ ...viewRef.current, ...changes });
    },
    [commit],
  );

  const say = useCallback((text: string) => {
    const { speakReplies, onSpeakingChange } = optionsRef.current;
    if (!speakReplies || !text) return;
    onSpeakingChange?.(true);
    void speak(text, () => optionsRef.current.onSpeakingChange?.(false));
  }, []);

  // Mini Me switched off (window closed) or the page reloads: end the run.
  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(
    async (request: string, name: string) => {
      if (isBuildActive(viewRef.current)) {
        commit({ ...viewRef.current!, conflict: { name } });
        optionsRef.current.onAttention("conflict");
        return;
      }
      const runId = ++runIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      const alive = () => runId === runIdRef.current && !controller.signal.aborted;
      commit({
        phase: "preparing",
        name,
        request,
        root: null,
        steps: 0,
        label: { key: "companion.build.preparing", params: { name } },
        approval: null,
        conflict: null,
        summary: "",
        liveUrl: null,
        error: null,
        settingsHint: false,
      });

      const fail = (message: string, settingsHint = false, phase: BuildPhase = "failed") => {
        if (runId !== runIdRef.current) return;
        patch(runId, { phase, error: message, settingsHint, approval: null, conflict: null });
        optionsRef.current.onAttention(phase === "blocked" ? "blocked" : "failed");
      };

      try {
        // The user's real safety profile: read-only means no building at all.
        const settings = await readAgentSettings();
        if (!alive()) return;
        const safetyProfile = normalizeAgentSafetyProfile(settings?.agentSafetyProfile);
        if (safetyProfile === "read-only") {
          fail(i18n.t("companion.build.readOnly"), true, "blocked");
          return;
        }

        const folderRes = await fetch("/api/workspace/new-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, parent: optionsRef.current.projectsDir }),
          signal: controller.signal,
        });
        const folder = (await folderRes.json().catch(() => ({}))) as { root?: unknown; error?: unknown };
        if (!alive()) return;
        if (!folderRes.ok || typeof folder.root !== "string") {
          if (folderRes.status === 400) fail(i18n.t("companion.build.error.folderSetting"), true);
          else fail(i18n.t("companion.build.error.folder", { detail: typeof folder.error === "string" ? folder.error : String(folderRes.status) }));
          return;
        }
        const root = folder.root;
        // Mini Me made this folder, so it is trusted (the main window agrees when it opens it).
        setWorkspaceTrusted(root, true);
        patch(runId, { root, phase: "running", label: { key: "companion.build.planning" } });

        const provider: AIProvider = loadAgentProvider() ?? "groq";
        const model = loadAgentModelMap()?.[provider] ?? "";
        const memory =
          buildMemoryContext({ global: await loadGlobalMemories(), project: [], conversation: [], legacy: loadMemories() }) || undefined;
        if (!alive()) return;

        const res = await fetch("/api/agent/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: buildPrompt(request),
            history: [],
            provider,
            model,
            workspaceRoot: root,
            conversationId: `minime-build-${Date.now()}`,
            memory,
            // No MCP tools: each call would need its own approval in the bubble,
            // and a fresh project doesn't need them.
            mcpServers: [],
            requireWriteApproval: false,
            planMode: false,
            attachments: [],
            liteAgentMode: typeof settings?.liteAgentMode === "boolean" ? settings.liteAgentMode : undefined,
            safetyProfile,
            mentions: [],
            browsing: false,
          }),
          signal: controller.signal,
        });
        if (!alive()) return;
        if (!res.ok) {
          fail(i18n.t("companion.build.error.server", { status: res.status }));
          return;
        }

        let finished = false;
        let summary = "";
        await consumeSse(res, async (event) => {
          if (!alive() || finished) return;
          const current = viewRef.current;
          if (!current) return;
          switch (event.type) {
            case "tool_call": {
              patch(runId, { steps: current.steps + 1, label: progressLabel(event) ?? current.label });
              return;
            }
            case "tool_result": {
              const liveUrl = extractLiveUrl(event.output);
              const changes: Partial<BuildView> = {};
              if (current.approval?.callId === event.callId) changes.approval = null; // answered, or timed out on the server
              // The step is over; the model is thinking until its next call.
              changes.label = { key: "companion.build.step.next" };
              if (liveUrl) changes.liveUrl = liveUrl;
              patch(runId, changes);
              return;
            }
            case "pending_approval": {
              if (shouldAutoApprove(event, root)) {
                if (await postApproval(event.callId, true, APPROVE_RETRIES)) return;
                if (!alive()) return;
                // Couldn't answer it: fall through and let the user decide.
              }
              if (event.tool === "__plan__") {
                void postApproval(event.callId, false); // plan mode is off; never expected
                return;
              }
              patch(runId, { approval: { callId: event.callId, ...approvalSummary(event), sending: false } });
              optionsRef.current.onAttention("approval");
              return;
            }
            case "browser_action": {
              // Browsing is off for builds; answer so the loop never waits on it.
              void fetch("/api/agent/browser-result", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ callId: event.callId, runId: event.runId, result: { kind: "error", text: "The browser isn't available here." } }),
              }).catch(() => {});
              return;
            }
            case "text_delta":
              summary += event.delta;
              return;
            case "error": {
              finished = true;
              const { message, settings: hint } = describeAgentError(event, provider, model);
              fail(message, hint);
              return;
            }
            case "done": {
              finished = true;
              const text = plainSummary(summary);
              patch(runId, {
                phase: "done",
                summary: text,
                liveUrl: viewRef.current?.liveUrl ?? extractLiveUrl(summary),
                approval: null,
                conflict: null,
              });
              optionsRef.current.onAttention("done");
              say(i18n.t("companion.build.doneSay", { name }));
              return;
            }
            default:
              return;
          }
        });
        if (!alive()) return;
        if (!finished) fail(i18n.t("companion.build.error.dropped"));
      } catch (err) {
        if (!alive()) return;
        fail(chatErrorMessage(err));
      } finally {
        if (abortRef.current === controller && runId === runIdRef.current && !isBuildActive(viewRef.current)) abortRef.current = null;
      }
    },
    [commit, patch, say],
  );

  /** Stop the running build (a pending approval is denied first). */
  const stop = useCallback(() => {
    const current = viewRef.current;
    if (!isBuildActive(current)) return;
    if (current!.approval) void postApproval(current!.approval.callId, false);
    abortRef.current?.abort();
    abortRef.current = null;
    commit({ ...current!, phase: "stopped", approval: null, conflict: null });
  }, [commit]);

  /** The user's Allow / Deny on the approval card. */
  const answer = useCallback(
    async (accept: boolean) => {
      const current = viewRef.current;
      const approval = current?.approval;
      if (!approval || approval.sending) return;
      const runId = runIdRef.current;
      patch(runId, { approval: { ...approval, sending: true } });
      await postApproval(approval.callId, accept);
      // Accepted, denied, or already gone (timed out): the card is done either way.
      if (viewRef.current?.approval?.callId === approval.callId) patch(runId, { approval: null });
    },
    [patch],
  );

  /** "Keep going" on the still-building question. */
  const keepGoing = useCallback(() => {
    if (viewRef.current?.conflict) commit({ ...viewRef.current, conflict: null });
  }, [commit]);

  /** The bubble closed: forget a finished build; a running one carries on. */
  const clear = useCallback(() => {
    const current = viewRef.current;
    if (!current) return;
    if (isBuildActive(current)) {
      if (current.conflict) commit({ ...current, conflict: null });
      return;
    }
    commit(null);
  }, [commit]);

  return { view, start, stop, answer, keepGoing, clear };
}
