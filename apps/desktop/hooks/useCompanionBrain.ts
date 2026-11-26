"use client";

// Runs one Mini Me request end to end: timer, clipboard, Agent hand-off, or a
// /api/chat call (which also executes system commands server-side), streaming
// the reply into the bubble and optionally speaking it.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatRequest } from "@/types";
import { parseChatStream } from "@/lib/chatStream";
import { ChatStreamInterruptedError, chatErrorMessage, providerErrorMessage, readChatReply } from "@/lib/chatErrors";
import { getSystemPrompt } from "@/lib/systemPrompt";
import { loadChatModelMap, loadChatProvider } from "@/lib/modelPrefs";
import { loadMemories, loadProfile } from "@/lib/userProfile";
import { buildSystemPrompt } from "@/lib/chatPrompt";
import { clipboardPrompt } from "@/lib/chatIntents";
import { speak, stopSpeaking } from "@/lib/speak";
import { useT } from "@/lib/i18n";
import { getCompanionBridge, type CompanionSettingsPage } from "@/lib/companion/bridge";
import {
  appendHistory,
  buildCompanionPrompt,
  projectNameFor,
  looksLikeBuildMarkerPrefix,
  resolveChatReply,
  stripBuildMarker,
  type Personality,
  loadHistory,
  routeInput,
  saveHistory,
  type CompanionMessage,
} from "@/lib/companion/brain";
import { forgetProject, isRecentProject, loadProject, saveProject, type CompanionProject } from "@/lib/companion/project";

export type BrainEvent = "thinking" | "talking" | "succeeded" | "failed";
/** "open-in-agent" hands the request to Marven's Agent; "open-in-marven" opens the thread as a chat. */
export type BubbleAction = "retry" | "open-in-marven" | "open-in-agent" | "open-settings" | "retry-or-settings" | null;

export interface BrainReply {
  text: string;
  action: BubbleAction;
  done: boolean;
  /** With "open-settings": the Settings page that fixes the problem (default: AI keys). */
  settingsPage?: CompanionSettingsPage;
}

/** The last build or change Mini Me started, which a correction ("no, make a new one") is about. */
export interface LastJob {
  request: string;
  kind: "build" | "edit";
}

interface Options {
  speakReplies: boolean;
  personality?: Personality;
  onEvent: (event: BrainEvent) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  /** A timer fired. The brain has put the text in `reply`; the host should show the bubble. */
  onNotify?: (text: string) => void;
  /** Build `request` as a new project named `name`. */
  onBuild?: (request: string, name: string) => void;
  /** Make `request` as a change to the current project. */
  onEdit?: (request: string) => void;
  /** "No, make a new one" / "no, just tell me" / "stop", about `previous` (the last job started), if any. */
  onCorrection?: (kind: "new-instead" | "chat-instead" | "stop", previous: LastJob | null) => void;
  /** A build or change is running (so "stop" means it, even after other chat). */
  isJobRunning?: () => boolean;
  /** Show a project in the preview panel: the one `query` names, else the current one. */
  onPreview?: (query: string) => void;
}

/** The clipboard's text via Marven's main process (the page has no clipboard permission), or "" when unreadable. */
async function readClipboardText(): Promise<string> {
  try {
    const bridge = getCompanionBridge();
    const text = bridge ? await bridge.readClipboard() : await navigator.clipboard.readText();
    return typeof text === "string" ? text : "";
  } catch {
    return "";
  }
}

export async function loadGlobalMemories(): Promise<string[]> {
  try {
    const data = await (await fetch("/api/memory")).json();
    const global = data?.scopes?.global;
    return Array.isArray(global) ? global : [];
  } catch {
    return [];
  }
}

export function useCompanionBrain(options: Options) {
  const { t } = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [reply, setReply] = useState<BrainReply | null>(null);
  const [busy, setBusy] = useState(false);
  const historyRef = useRef<CompanionMessage[]>([]);
  const lastInputRef = useRef("");
  const lastSkipBuildRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const busyRef = useRef(false);
  busyRef.current = busy;
  const pendingNotesRef = useRef<string[]>([]);
  /** The project Mini Me built last: changes to it are edits, not new projects. */
  const projectRef = useRef<CompanionProject | null>(null);
  /** The build or change started by the previous message; corrections are about it. */
  const lastJobRef = useRef<LastJob | null>(null);
  const sendRef = useRef<(raw: string, sendOpts?: { skipBuild?: boolean }) => Promise<void>>(async () => {});

  useEffect(() => {
    historyRef.current = loadHistory(localStorage);
    projectRef.current = loadProject(localStorage);
  }, []);

  const say = useCallback((text: string) => {
    const { speakReplies, onSpeakingChange } = optionsRef.current;
    if (!speakReplies || !text) return;
    onSpeakingChange?.(true);
    void speak(text, () => optionsRef.current.onSpeakingChange?.(false));
  }, []);

  // Fired timers wait here while a request is in flight, so they never overwrite its reply.
  const notify = useCallback(
    (text: string) => {
      setReply({ text, action: null, done: true });
      optionsRef.current.onNotify?.(text);
      optionsRef.current.onEvent("succeeded");
      say(text);
    },
    [say],
  );

  useEffect(() => {
    if (busy) return;
    if (pendingNotesRef.current.length === 0) return;
    const text = pendingNotesRef.current.join("\n");
    pendingNotesRef.current = [];
    notify(text);
  }, [busy, notify]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);

  const send = useCallback(async (raw: string, sendOpts?: { skipBuild?: boolean }) => {
    const text = raw.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    lastInputRef.current = text;
    lastSkipBuildRef.current = !!sendOpts?.skipBuild;
    stopSpeaking();
    optionsRef.current.onSpeakingChange?.(false);
    setBusy(true);

    const emit = (e: BrainEvent) => optionsRef.current.onEvent(e);
    const show = (t: string, action: BubbleAction, done: boolean) => setReply({ text: t, action, done });
    const remember = (answer: string) => {
      if (!answer.trim()) return;
      historyRef.current = appendHistory(
        historyRef.current,
        { role: "user", content: text },
        { role: "assistant", content: answer },
      );
      saveHistory(localStorage, historyRef.current);
    };
    const succeed = (answer: string) => {
      remember(answer);
      show(answer, null, true);
      emit("succeeded");
      say(answer);
      setBusy(false);
    };
    const fail = (message: string, action: BubbleAction) => {
      show(message, action, true);
      emit("failed");
      say(message);
      setBusy(false);
    };

    const custom = getSystemPrompt().trim();
    const project = projectRef.current;
    const route = routeInput(text, {
      allowCommands: !custom,
      allowBuild: !sendOpts?.skipBuild,
      project: project && !sendOpts?.skipBuild ? { recent: isRecentProject(project, Date.now()) } : undefined,
      afterRun: !sendOpts?.skipBuild && (lastJobRef.current !== null || !!optionsRef.current.isJobRunning?.()),
    });
    // A build or a change starts straight away; the build card takes the bubble.
    const startJob = (kind: "build" | "edit", name?: string) => {
      lastJobRef.current = { request: text, kind };
      setReply(null);
      setBusy(false);
      emit("thinking");
      if (kind === "build") optionsRef.current.onBuild?.(text, name ?? projectNameFor(text));
      else optionsRef.current.onEdit?.(text);
    };

    if (route.kind === "new-instead" || route.kind === "chat-instead" || route.kind === "stop") {
      const previous = lastJobRef.current;
      lastJobRef.current = null;
      setReply(null);
      setBusy(false);
      optionsRef.current.onCorrection?.(route.kind, previous);
      if (route.kind === "chat-instead" && previous) void sendRef.current(previous.request, { skipBuild: true });
      return;
    }
    // "Show me the preview of …": not a job, and not chat (the model can't open anything).
    const showPreview = (query: string) => {
      lastJobRef.current = null;
      setReply(null);
      setBusy(false);
      optionsRef.current.onPreview?.(query);
    };
    if (route.kind === "preview") {
      showPreview(route.query);
      return;
    }
    if (route.kind === "build") {
      startJob("build", route.name);
      return;
    }
    if (route.kind === "edit" && project) {
      startJob("edit");
      return;
    }
    lastJobRef.current = null;

    try {
      if (route.kind === "timer") {
        const id = setTimeout(() => {
          timersRef.current.delete(id);
          const done = tRef.current("companion.timerDone", { label: route.label });
          if (busyRef.current) pendingNotesRef.current.push(done);
          else notify(done);
        }, route.ms);
        timersRef.current.add(id);
        succeed(tRef.current("companion.timerSet", { label: route.label }));
        return;
      }
      if (route.kind === "agent") {
        const handoff = tRef.current("companion.agentHandoff");
        remember(handoff);
        fail(handoff, "open-in-agent");
        return;
      }

      let prompt = text;
      if (route.kind === "clipboard") {
        const clip = await readClipboardText();
        if (controller.signal.aborted) return;
        if (!clip.trim()) {
          fail(tRef.current("companion.clipboardFailed"), null);
          return;
        }
        prompt = clipboardPrompt(route.action, clip);
      }

      // The model may answer a project request with [[BUILD: name]]; only on plain chat that hasn't opted out.
      const markerEnabled = route.kind === "chat" && !sendOpts?.skipBuild;
      emit("thinking");
      show("", null, false);
      const provider = loadChatProvider() ?? "groq";
      const model = loadChatModelMap()?.[provider] ?? "";
      const globalMemories = await loadGlobalMemories();
      if (controller.signal.aborted) return;
      const base = buildSystemPrompt(loadProfile()?.name ?? null, {
        global: globalMemories,
        project: [],
        conversation: [],
        legacy: loadMemories(),
      });
      const body: ChatRequest = {
        messages: [...historyRef.current, { role: "user", content: prompt }],
        model,
        provider,
        systemPrompt: buildCompanionPrompt(base, custom, optionsRef.current.personality, {
          allowBuild: markerEnabled,
          project: project ? { name: project.name } : undefined,
        }),
        allowCommands: route.kind === "command",
        commandText: text,
      };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!(res.headers.get("content-type") ?? "").includes("text/plain")) {
        // JSON: a command result, or a setup error the route caught before streaming (e.g. no API key).
        const data = await readChatReply(res);
        if (data.commandExecuted) succeed(data.reply);
        else fail(data.reply, route.kind === "command" ? null : "retry-or-settings");
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("The reply had no body.");
      const decoder = new TextDecoder();
      let rawText = "";
      let talking = false;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          rawText += decoder.decode(value, { stream: true });
          const { text: partial } = parseChatStream(rawText);
          if (markerEnabled && looksLikeBuildMarkerPrefix(partial)) continue;
          if (partial && !talking) {
            talking = true;
            emit("talking");
          }
          show(partial, null, false);
        }
      } catch (readErr) {
        if (controller.signal.aborted) return;
        const { text: partial } = parseChatStream(rawText);
        const shown = markerEnabled && looksLikeBuildMarkerPrefix(partial) ? "" : stripBuildMarker(partial);
        fail(
          shown.trim()
            ? `${shown}\n\n${tRef.current("companion.droppedNote")}`
            : chatErrorMessage(new ChatStreamInterruptedError(readErr)),
          "retry",
        );
        return;
      }
      rawText += decoder.decode();
      const { text: full, error } = parseChatStream(rawText, true);
      if (error) {
        const why = providerErrorMessage(error);
        fail(full ? `${full}\n\n${why}` : why, "retry");
        return;
      }
      const resolved = resolveChatReply(full, markerEnabled, markerEnabled && !!project);
      if (resolved.kind === "edit" && project) {
        startJob("edit");
        return;
      }
      if (resolved.kind === "preview") {
        showPreview(resolved.query);
        return;
      }
      if (resolved.kind === "edit") {
        fail(tRef.current("companion.emptyReply"), "retry");
        return;
      }
      if (resolved.kind === "build") {
        // Same as the phrase route; the marker is never spoken or remembered.
        startJob("build", resolved.name);
        return;
      }
      if (!resolved.text) {
        fail(tRef.current("companion.emptyReply"), "retry");
        return;
      }
      succeed(resolved.text);
    } catch (err) {
      if (controller.signal.aborted) return;
      fail(chatErrorMessage(err), "retry");
    }
  }, [say, notify]);
  sendRef.current = send;

  const retry = useCallback(() => send(lastInputRef.current, { skipBuild: lastSkipBuildRef.current }), [send]);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    stopSpeaking();
    optionsRef.current.onSpeakingChange?.(false);
    setReply(null);
    setBusy(false);
  }, []);

  const history = useCallback(() => historyRef.current, []);

  const getProject = useCallback(() => projectRef.current, []);

  /** The current project's folder is gone: forget it and its history. */
  const forgetCurrentProject = useCallback(() => {
    const p = projectRef.current;
    projectRef.current = null;
    if (p) forgetProject(localStorage, p.root);
  }, []);

  /** The folder Mini Me just made (or reused) is now its current project. */
  const setProject = useCallback((root: string, name: string) => {
    projectRef.current = { root, name, at: Date.now() };
    saveProject(localStorage, projectRef.current);
  }, []);

  /** Add an exchange that happened outside chat (a finished build or edit) to the history the model sees. */
  const recordExchange = useCallback((user: string, assistant: string) => {
    if (!user.trim() || !assistant.trim()) return;
    historyRef.current = appendHistory(historyRef.current, { role: "user", content: user }, { role: "assistant", content: assistant });
    saveHistory(localStorage, historyRef.current);
  }, []);

  /**
   * Show a line from outside the chat (e.g. how a hand-off went), not recorded
   * in the history. `done: false` keeps it up without buttons while work goes on.
   */
  const announce = useCallback(
    (text: string, opts?: { action?: BubbleAction; settingsPage?: CompanionSettingsPage; done?: boolean; speak?: boolean }) => {
      abortRef.current?.abort();
      setBusy(false);
      setReply({ text, action: opts?.action ?? null, done: opts?.done ?? true, settingsPage: opts?.settingsPage });
      if (opts?.speak) say(text);
    },
    [say],
  );

  return { reply, busy, send, retry, dismiss, history, announce, setProject, getProject, forgetCurrentProject, recordExchange };
}
