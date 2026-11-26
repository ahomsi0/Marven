"use client";

// Mini Me's builds and changes: makes (or reopens) a project folder, runs
// Marven's real Agent on it in the background with the user's agent settings
// and the project's history, and turns the Agent's event stream into a calm
// bubble view (latest step, approvals, result). What you ask for while a run
// is going is queued; queued changes run together when it ends.
//
// Mini Me answers an approval itself only for file writes inside the folder it
// just created (shouldAutoApprove); everything else is asked in the bubble.

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AIProvider } from "@/types";
import i18n from "@/lib/i18n";
import { consumeSse } from "@/lib/agent/sse";
import { normalizeAgentSafetyProfile, type AgentSafetyProfile } from "@/lib/agent/safety";
import {
  approvalSummary,
  extractLiveUrl,
  packageScripts,
  plainSummary,
  progressLabel,
  runsProjectCode,
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
import { appendThread, loadThread, type CompanionProject } from "@/lib/companion/project";
import { editRequestText, takeNext, type Job, type QueuedJob } from "@/lib/companion/queue";
import type { CompanionSettingsPage } from "@/lib/companion/bridge";

export type BuildPhase = "preparing" | "running" | "done" | "failed" | "stopped" | "blocked";

export interface BuildApproval {
  callId: string;
  kind: ApprovalKind;
  detail: string;
  /** A command that runs code from the project (install hooks, scripts, files the Agent wrote). */
  runsProjectCode: boolean;
  /** The project's package.json scripts, when the command runs project code and there are any. */
  scripts: string | null;
  /** The answer is on its way to the server. */
  sending: boolean;
}

export interface BuildView {
  phase: BuildPhase;
  name: string;
  request: string;
  /** A change to a project Mini Me built before (its folder is reused), not a new build. */
  edit: boolean;
  /** The project folder, once created. */
  root: string | null;
  /** Tool calls so far. */
  steps: number;
  label: ProgressLabel;
  /** Something only the user may answer. */
  approval: BuildApproval | null;
  /** Requests queued behind this run, shown as "Next: …". */
  queue: string[];
  summary: string;
  liveUrl: string | null;
  /** Why it failed (or is blocked), in plain words. */
  error: string | null;
  /** The Settings page that fixes the error, offered as a button. */
  settingsPage: CompanionSettingsPage | null;
  /** A short note under the progress line (e.g. an approval that timed out). */
  note: string | null;
}

/** Why the bubble should come up: the host opens it (unfocused) and reacts. */
export type BuildAttention = "approval" | "done" | "failed" | "blocked";

interface Options {
  /** Where projects go (Settings → Mini Me); a leading ~ is the home folder. */
  projectsDir: string;
  speakReplies: boolean;
  onSpeakingChange?: (speaking: boolean) => void;
  onAttention: (reason: BuildAttention) => void;
  /** The project a change applies to, read when the change runs. */
  getProject: () => CompanionProject | null;
  /** The project folder is ready (made, or reused for an edit): it is now Mini Me's current project. */
  onFolderReady?: (root: string, name: string) => void;
  /** The current project's folder is gone. */
  onProjectGone?: (root: string) => void;
  /** The Agent wrote or patched a file in the project (the preview reloads). */
  onFileWritten?: () => void;
  /** The Agent finished: what was asked and what it said, for Mini Me's history. */
  onDone?: (result: { request: string; name: string; root: string; summary: string; edit: boolean }) => void;
}

const APPROVE_RETRIES = 8;
const APPROVE_RETRY_MS = 250;
const ERROR_DETAIL_MAX = 160;
const NOTE_MS = 8000;
const PACKAGE_JSON_MAX = 64_000;
const WRITE_TOOLS = new Set(["write_file", "apply_patch"]);

export const isBuildActive = (view: BuildView | null) => !!view && (view.phase === "preparing" || view.phase === "running");

/** The request, plus what the Agent needs to know about where it is. */
function buildPrompt(request: string, name: string, edit: boolean): string {
  if (edit) {
    return `${request}\n\n(You're working in the existing project "${name}", which you built earlier in this folder. Look at its files first, then make this change to them. Don't start a new project or make a new folder. When you're done, end with a short, friendly summary of what you changed.)`;
  }
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

export type FolderPrep =
  | {
      ok: true;
      root: string;
      settings: { agentSafetyProfile?: unknown; liteAgentMode?: unknown } | null;
      profile: AgentSafetyProfile;
    }
  | { ok: false; message: string; settingsPage: CompanionSettingsPage | null; blocked: boolean; gone?: boolean };

/**
 * Gets a project ready for the Agent, for "Build it here" and "Open in Marven"
 * alike: checks the user's real safety profile (read-only means no building at
 * all), makes a fresh folder under the projects folder, and marks it trusted
 * (Mini Me made it; the main window agrees when it opens it). Network errors throw.
 */
export async function prepareProjectFolder(
  name: string,
  parent: string,
  signal?: AbortSignal,
  existingRoot?: string,
  opts?: { edit?: boolean },
): Promise<FolderPrep> {
  const settings = await readAgentSettings();
  const profile = normalizeAgentSafetyProfile(settings?.agentSafetyProfile);
  if (profile === "read-only") {
    return { ok: false, message: i18n.t("companion.build.readOnly"), settingsPage: "general", blocked: true };
  }
  if (existingRoot && opts?.edit) {
    // A project Mini Me built before: the server approves it for the Agent
    // again (approvals don't survive a restart), if it's still a folder
    // directly inside the projects folder.
    const res = await fetch("/api/workspace/reopen-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: existingRoot, parent }),
      signal,
    });
    const folder = (await res.json().catch(() => ({}))) as { root?: unknown };
    if (!res.ok || typeof folder.root !== "string") {
      return { ok: false, message: i18n.t("companion.build.error.reopen", { name }), settingsPage: null, blocked: false, gone: res.status === 404 };
    }
    setWorkspaceTrusted(folder.root, true);
    return { ok: true, root: folder.root, settings, profile };
  }
  if (existingRoot) {
    // A folder this flow already made (e.g. Marven's Agent was busy, so the
    // user chose to build here instead): reuse it rather than make another.
    setWorkspaceTrusted(existingRoot, true);
    return { ok: true, root: existingRoot, settings, profile };
  }
  const res = await fetch("/api/workspace/new-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, parent }),
    signal,
  });
  const folder = (await res.json().catch(() => ({}))) as { root?: unknown; error?: unknown };
  if (!res.ok || typeof folder.root !== "string") {
    if (res.status === 400) return { ok: false, message: i18n.t("companion.build.error.folderSetting"), settingsPage: "mini-me", blocked: false };
    return {
      ok: false,
      message: i18n.t("companion.build.error.folder", { detail: typeof folder.error === "string" ? folder.error : String(res.status) }),
      settingsPage: null,
      blocked: false,
    };
  }
  setWorkspaceTrusted(folder.root, true);
  return { ok: true, root: folder.root, settings, profile };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Answers a pending approval. A 404 right after the event can mean the server
 * hasn't registered it yet, so that is retried; afterwards it means the
 * approval is gone (answered, timed out, or the run ended). True when accepted by the server.
 */
async function postApproval(callId: string, accept: boolean, retries = 0, keepTrying: () => boolean = () => true): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    if (attempt > 0 && !keepTrying()) return false;
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

/** The project's package.json scripts, via the read-only file API (approved roots only; the active workspace is untouched). */
async function readProjectScripts(root: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ root, path: "package.json" });
    const res = await fetch(`/api/workspace/files/raw?${params}`);
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > PACKAGE_JSON_MAX ? null : packageScripts(text);
  } catch {
    return null;
  }
}

/** Plain words for an `error` event from the Agent, and whether Settings fixes it. */
function describeAgentError(
  event: Extract<AgentEvent, { type: "error" }>,
  provider: AIProvider,
  model: string,
): { message: string; settingsPage: CompanionSettingsPage | null } {
  switch (event.code) {
    case "workspace_not_set":
      return { message: i18n.t("companion.build.error.workspace"), settingsPage: null };
    case "tools_not_supported":
      return { message: i18n.t("companion.build.error.tools"), settingsPage: "keys-ai" };
    case "max_iterations":
      return { message: i18n.t("companion.build.error.steps"), settingsPage: null };
    case "provider_error": {
      const err = { provider, model: model || undefined, message: event.message };
      const kind = classifyProviderError(err);
      return { message: providerErrorMessage(err), settingsPage: kind === "auth" || kind === "model" ? "keys-ai" : null };
    }
    default:
      return {
        message: i18n.t("companion.build.error.unexpected", { detail: (event.message || event.code).slice(0, ERROR_DETAIL_MAX) }),
        settingsPage: null,
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
  const queueRef = useRef<QueuedJob[]>([]);
  const queueLabels = () => queueRef.current.map((j) => j.request);

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

  const runRef = useRef<(job: Job) => Promise<void>>(async () => {});

  /** Runs one job; when it ends (done or failed, not stopped or replaced), the queue drains. */
  const run = useCallback(
    async (job: Job) => {
      const project = job.kind === "edit" ? optionsRef.current.getProject() : null;
      if (job.kind === "edit" && !project) return;
      const edit = job.kind === "edit";
      const request = job.kind === "edit" ? editRequestText(job.requests) : job.request;
      const name = project ? project.name : job.kind === "build" ? job.name : "";
      const runId = ++runIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;
      const alive = () => runId === runIdRef.current && !controller.signal.aborted;
      commit({
        phase: "preparing",
        name,
        request,
        edit,
        root: null,
        steps: 0,
        label: { key: edit ? "companion.build.opening" : "companion.build.preparing", params: { name } },
        approval: null,
        queue: queueLabels(),
        summary: "",
        liveUrl: null,
        error: null,
        settingsPage: null,
        note: null,
      });

      let root: string | null = null;
      let settled = false;
      const note = (content: string) => {
        if (root) appendThread(localStorage, root, [{ role: "assistant", content }]);
      };
      const fail = (message: string, settingsPage: CompanionSettingsPage | null = null, phase: BuildPhase = "failed") => {
        if (runId !== runIdRef.current) return;
        settled = true;
        note(i18n.t("companion.build.failedNote", { error: message }));
        patch(runId, { phase, error: message, settingsPage, approval: null, note: null, queue: queueLabels() });
        optionsRef.current.onAttention(phase === "blocked" ? "blocked" : "failed");
      };

      try {
        const prep = await prepareProjectFolder(name, optionsRef.current.projectsDir, controller.signal, project?.root, { edit });
        if (!alive()) return;
        if (!prep.ok) {
          if (prep.gone && project) optionsRef.current.onProjectGone?.(project.root);
          fail(prep.message, prep.settingsPage, prep.blocked ? "blocked" : "failed");
          return;
        }
        const runRoot = prep.root;
        root = runRoot;
        const { settings } = prep;
        // The project's history so far goes to the Agent, then this request joins it.
        const history = loadThread(localStorage, runRoot).map(({ role, content }) => ({ role, content }));
        appendThread(localStorage, runRoot, [{ role: "user", content: request }]);
        // A background run never runs commands unattended: "trusted" becomes
        // "ask-before-command" here, so every command (and git, fetch, MCP,
        // global memory) still asks in the bubble. Writes inside the project
        // folder are approved by shouldAutoApprove, so building stays hands-free.
        const safetyProfile = prep.profile === "trusted" ? "ask-before-command" : prep.profile;
        patch(runId, { root: runRoot, phase: "running", label: { key: "companion.build.planning" } });
        optionsRef.current.onFolderReady?.(runRoot, name);

        const provider: AIProvider = loadAgentProvider() ?? "groq";
        const model = loadAgentModelMap()?.[provider] ?? "";
        const memory =
          buildMemoryContext({ global: await loadGlobalMemories(), project: [], conversation: [], legacy: loadMemories() }) || undefined;
        if (!alive()) return;

        const res = await fetch("/api/agent/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: buildPrompt(request, name, edit),
            history,
            provider,
            model,
            workspaceRoot: runRoot,
            conversationId: `minime-${edit ? "edit" : "build"}-${Date.now()}`,
            memory,
            // No MCP tools: each call would need its own approval in the bubble,
            // and a small project doesn't need them.
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
        const tools = new Map<string, string>();
        await consumeSse(res, async (event) => {
          if (!alive() || finished) return;
          const current = viewRef.current;
          if (!current) return;
          switch (event.type) {
            case "tool_call": {
              tools.set(event.callId, event.tool);
              patch(runId, { steps: current.steps + 1, label: progressLabel(event) ?? current.label });
              return;
            }
            case "tool_result": {
              const liveUrl = extractLiveUrl(event.output);
              const changes: Partial<BuildView> = {};
              if (current.approval?.callId === event.callId) {
                changes.approval = null;
                // Still on screen and unanswered: the server's 60 s timeout said no.
                if (!current.approval.sending) {
                  changes.note = i18n.t("companion.build.skipped");
                  setTimeout(() => {
                    if (viewRef.current?.note) patch(runId, { note: null });
                  }, NOTE_MS);
                }
              }
              // The step is over; the model is thinking until its next call.
              changes.label = { key: "companion.build.step.next" };
              if (liveUrl) changes.liveUrl = liveUrl;
              patch(runId, changes);
              if (WRITE_TOOLS.has(tools.get(event.callId) ?? "")) optionsRef.current.onFileWritten?.();
              return;
            }
            case "pending_approval": {
              if (shouldAutoApprove(event, runRoot)) {
                if (await postApproval(event.callId, true, APPROVE_RETRIES, alive)) return;
                if (!alive()) return;
                // Couldn't answer it: fall through and let the user decide.
              }
              if (event.tool === "__plan__") {
                void postApproval(event.callId, false); // plan mode is off; never expected
                return;
              }
              const asked = approvalSummary(event);
              const runsCode = asked.kind === "command" && runsProjectCode(asked.detail);
              const scripts = runsCode ? await readProjectScripts(runRoot) : null;
              if (!alive()) return;
              patch(runId, { approval: { callId: event.callId, ...asked, runsProjectCode: runsCode, scripts, sending: false }, note: null });
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
              const { message, settingsPage } = describeAgentError(event, provider, model);
              fail(message, settingsPage);
              return;
            }
            case "done": {
              finished = true;
              settled = true;
              const text = plainSummary(summary);
              note(text || i18n.t(edit ? "companion.build.editDoneTitle" : "companion.build.doneTitle", { name }));
              patch(runId, {
                phase: "done",
                summary: text,
                liveUrl: viewRef.current?.liveUrl ?? extractLiveUrl(summary),
                approval: null,
                queue: queueLabels(),
              });
              optionsRef.current.onAttention("done");
              optionsRef.current.onDone?.({ request, name, root: runRoot, summary: text, edit });
              say(i18n.t(edit ? "companion.build.editDoneSay" : "companion.build.doneSay", { name }));
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
        if (abortRef.current === controller && runId === runIdRef.current) abortRef.current = null;
        // Done or failed (not stopped, not replaced): run what was asked for meanwhile.
        if (settled && runId === runIdRef.current && !controller.signal.aborted) {
          const next = takeNext(queueRef.current);
          if (next) {
            queueRef.current = next.rest;
            void runRef.current(next.job);
          }
        }
      }
    },
    [commit, patch, say],
  );
  runRef.current = run;

  /** Run a job now, or queue it behind the one that's running. */
  const submit = useCallback(
    (job: QueuedJob) => {
      if (isBuildActive(viewRef.current)) {
        queueRef.current = [...queueRef.current, job];
        commit({ ...viewRef.current!, queue: queueLabels() });
        return;
      }
      const next = takeNext([...queueRef.current, job]);
      if (!next) return;
      queueRef.current = next.rest;
      void run(next.job);
    },
    [commit, run],
  );

  /** Stop the running job and drop the queue (a pending approval is denied first). False when nothing was running. */
  const stop = useCallback(() => {
    queueRef.current = [];
    const current = viewRef.current;
    if (!isBuildActive(current)) {
      if (current?.queue.length) commit({ ...current, queue: [] });
      return false;
    }
    if (current!.approval) void postApproval(current!.approval.callId, false);
    abortRef.current?.abort();
    abortRef.current = null;
    if (current!.root) appendThread(localStorage, current!.root, [{ role: "assistant", content: i18n.t("companion.build.stoppedNote") }]);
    commit({ ...current!, phase: "stopped", approval: null, queue: [] });
    return true;
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

  /** The bubble closed: forget a finished run; a running one carries on. */
  const clear = useCallback(() => {
    if (!isBuildActive(viewRef.current)) commit(null);
  }, [commit]);

  return { view, submit, stop, answer, clear };
}
