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
  type Personality,
  loadHistory,
  routeInput,
  saveHistory,
  type CompanionMessage,
} from "@/lib/companion/brain";

export type BrainEvent = "thinking" | "talking" | "succeeded" | "failed";
/** "open-in-agent" hands the request to Marven's Agent; "open-in-marven" opens the thread as a chat; "build-choice" offers to build the request as a project; "build-here" offers to build `build` right here. */
export type BubbleAction = "build-choice" | "build-here" | "retry" | "open-in-marven" | "open-in-agent" | "open-settings" | "retry-or-settings" | null;

export interface BrainReply {
  text: string;
  action: BubbleAction;
  done: boolean;
  /** Set with the "build-choice" / "build-here" actions: the request, the project name, and (build-here) the folder already made for it. */
  build?: { request: string; name: string; root?: string };
  /** With "open-settings": the Settings page that fixes the problem (default: AI keys). */
  settingsPage?: CompanionSettingsPage;
}

export type BuildChoice = "here" | "marven" | "chat";

interface Options {
  speakReplies: boolean;
  personality?: Personality;
  onEvent: (event: BrainEvent) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  /** A timer fired. The brain has put the text in `reply`; the host should show the bubble. */
  onNotify?: (text: string) => void;
  /** "Build it here" was chosen (Task 17B fills this in). */
  onBuildHere?: (request: string, name: string) => void;
  /** "Open in Marven" was chosen on a build request (Task 17C fills this in). */
  onBuildInMarven?: (request: string, name: string) => void;
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

  useEffect(() => {
    historyRef.current = loadHistory(localStorage);
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
    const route = routeInput(text, { allowCommands: !custom, allowBuild: !sendOpts?.skipBuild });

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
      if (route.kind === "build") {
        // Not remembered yet: history only gets the exchange once the user picks "Just tell me".
        const ask = tRef.current("companion.buildAsk");
        setReply({ text: ask, action: "build-choice", done: true, build: { request: text, name: route.name } });
        emit("talking");
        say(ask);
        setBusy(false);
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
        systemPrompt: buildCompanionPrompt(base, custom, optionsRef.current.personality),
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
          if (partial && !talking) {
            talking = true;
            emit("talking");
          }
          show(partial, null, false);
        }
      } catch (readErr) {
        if (controller.signal.aborted) return;
        const { text: partial } = parseChatStream(rawText);
        fail(
          partial.trim()
            ? `${partial}\n\n${tRef.current("companion.droppedNote")}`
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
      if (!full.trim()) {
        fail(tRef.current("companion.emptyReply"), "retry");
        return;
      }
      succeed(full);
    } catch (err) {
      if (controller.signal.aborted) return;
      fail(chatErrorMessage(err), "retry");
    }
  }, [say, notify]);

  const retry = useCallback(() => send(lastInputRef.current, { skipBuild: lastSkipBuildRef.current }), [send]);

  const dismiss = useCallback(() => {
    abortRef.current?.abort();
    stopSpeaking();
    optionsRef.current.onSpeakingChange?.(false);
    setReply(null);
    setBusy(false);
  }, []);

  const history = useCallback(() => historyRef.current, []);

  /**
   * Show a line from outside the chat (e.g. how a hand-off went), not recorded
   * in the history. `done: false` keeps it up without buttons while work goes on.
   */
  const announce = useCallback(
    (
      text: string,
      opts?: { action?: BubbleAction; settingsPage?: CompanionSettingsPage; build?: BrainReply["build"]; done?: boolean; speak?: boolean },
    ) => {
      abortRef.current?.abort();
      setBusy(false);
      setReply({ text, action: opts?.action ?? null, done: opts?.done ?? true, settingsPage: opts?.settingsPage, build: opts?.build });
      if (opts?.speak) say(text);
    },
    [say],
  );

  const chooseBuild = useCallback(
    (choice: BuildChoice) => {
      const build = reply?.build;
      if (!build) return;
      if (choice === "chat") {
        void send(build.request, { skipBuild: true });
        return;
      }
      setReply(null);
      const { onBuildHere, onBuildInMarven } = optionsRef.current;
      (choice === "here" ? onBuildHere : onBuildInMarven)?.(build.request, build.name);
    },
    [reply, send],
  );

  return { reply, busy, send, retry, dismiss, history, chooseBuild, announce };
}
