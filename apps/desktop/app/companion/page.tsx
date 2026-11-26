"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompanionSprite } from "./CompanionSprite";
import { SpeechBubble } from "./SpeechBubble";
import { useCompanionPointer } from "./useCompanionPointer";
import { useCompanionHitRects } from "./useCompanionHitRects";
import { useCompanionBrain, type BrainEvent, type BubbleAction } from "@/hooks/useCompanionBrain";
import { isBuildActive, prepareProjectFolder, useCompanionBuild, type BuildAttention } from "@/hooks/useCompanionBuild";
import { useVoice } from "@/hooks/useVoice";
import { stopSpeaking } from "@/lib/speak";
import { initialState, reduce, type BehaviourEvent, type BehaviourState, type Strip } from "@/lib/companion/behaviour";
import { useT } from "@/lib/i18n";
import { chatErrorMessage } from "@/lib/chatErrors";
import { voiceNotice } from "@/lib/companion/voiceNotice";
import { DEFAULT_LOOK, parseLook } from "@/lib/companion/look";
import { DEFAULT_COMPANION_SETTINGS, getCompanionBridge, getCompanionPlatform, type CompanionSettings, type CompanionSettingsPage } from "@/lib/companion/bridge";

const AUTO_CLOSE_MS = 8000;
/** A finished build's result stays up longer: it has buttons worth reaching for. */
const BUILD_RESULT_CLOSE_MS = 45_000;
/** Left alone this long, Mini Me sits down and stays seated. */
const REST_AFTER_MS = 120_000;
/** A voice-opened bubble that heard nothing closes itself after this. */
const VOICE_IDLE_CLOSE_MS = 4000;

export default function CompanionPage() {
  const { t } = useT();
  const bridge = useMemo(getCompanionBridge, []);
  // Linux shapes the window to the [data-hit] elements instead of forwarding mouse moves.
  const shapeWindow = useMemo(() => getCompanionPlatform() === "linux", []);
  const rootRef = useRef<HTMLElement>(null);
  useCompanionHitRects(bridge, shapeWindow, rootRef);
  const [settings, setSettings] = useState<CompanionSettings>(DEFAULT_COMPANION_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Keyed on content, not identity: every settings push is a new object.
  const lookKey = JSON.stringify(settings.look ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const look = useMemo(() => (settings.look ? parseLook(settings.look) : DEFAULT_LOOK), [lookKey]);
  const behaviourRef = useRef<BehaviourState>(initialState(Date.now()));
  const [behaviour, setBehaviour] = useState<BehaviourState>(behaviourRef.current);
  const [facing, setFacing] = useState<1 | -1>(1);
  const stripRef = useRef<Strip>({ minX: 0, maxX: 0 });
  const xRef = useRef(0);
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const bubbleOpenRef = useRef(false);
  bubbleOpenRef.current = bubbleOpen;
  const [draft, setDraft] = useState("");
  const [interim, setInterim] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const noticeShownRef = useRef(false);
  const openedByVoiceRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const dispatch = useCallback(
    (event: BehaviourEvent) => {
      const { state, effect } = reduce(behaviourRef.current, { rand: Math.random, ...event } as BehaviourEvent);
      behaviourRef.current = state;
      setBehaviour(state);
      if (effect.stop) bridge?.stop();
      if (effect.walkTo !== undefined) bridge?.walkTo(effect.walkTo);
      if (effect.returnHome) bridge?.returnHome();
    },
    [bridge],
  );

  // ── Brain and voice ────────────────────────────────────────────────────────
  const voiceRef = useRef<{ pause: () => void; resume: () => void }>({ pause: () => {}, resume: () => {} });
  // Destructured so the callbacks below depend on the hook's stable functions,
  // not on the object it returns (which is new every render).
  const { reply, busy, send, retry, dismiss, history, chooseBuild, announce } = useCompanionBrain({
    speakReplies: settings.speak,
    personality: settings.personality,
    onEvent: (e: BrainEvent) => dispatch({ type: e, now: Date.now() }),
    onSpeakingChange: (speaking) => (speaking ? voiceRef.current.pause() : voiceRef.current.resume()),
    onNotify: () => openBubble(false),
    onBuildHere: (request, name) => void buildStart(request, name),
    onBuildInMarven: (request, name) => void buildInMarven(request, name),
  });

  // ── Building projects ("Build it here") ────────────────────────────────────
  const {
    view: build,
    start: buildStart,
    stop: buildStop,
    answer: buildAnswer,
    keepGoing: buildKeepGoing,
    switchTo: buildSwitchTo,
    clear: buildClear,
  } = useCompanionBuild({
    projectsDir: settings.projectsDir,
    speakReplies: settings.speak,
    onSpeakingChange: (speaking) => (speaking ? voiceRef.current.pause() : voiceRef.current.resume()),
    onAttention: (reason: BuildAttention) => {
      // Bring the bubble up without stealing focus, then react.
      if (!bubbleOpenRef.current) openBubble(false);
      // A result replaces a chat reply that's already finished (one still
      // streaming keeps the bubble; the result waits for the next opening).
      if (reason !== "approval" && reason !== "conflict" && replyRef.current?.done && !busyRef.current) dismiss();
      const now = Date.now();
      if (reason === "done") dispatch({ type: "succeeded", now });
      else if (reason === "failed" || reason === "blocked") dispatch({ type: "failed", now });
      else dispatch({ type: "talking", now });
    },
  });
  const buildNeedsUser = !!build && (!!build.approval || !!build.conflict);
  // The build takes the bubble when it needs the user, or when there's no reply to show.
  const showBuild = !!build && (buildNeedsUser || (!reply && !busy));
  const buildWorking = showBuild && isBuildActive(build) && !buildNeedsUser;
  const buildFinished = showBuild && !isBuildActive(build);
  const replyRef = useRef(reply);
  replyRef.current = reply;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const showBuildRef = useRef(showBuild);
  showBuildRef.current = showBuild;

  const focusInput = useCallback(() => {
    bridge?.setFocusable(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [bridge]);

  const openBubble = useCallback(
    (focus: boolean, viaVoice = false) => {
      setBubbleOpen(true);
      noticeShownRef.current = false;
      openedByVoiceRef.current = viaVoice;
      dispatch({ type: "interact", now: Date.now() });
      dispatch({ type: "bubble-open", now: Date.now() });
      if (focus) focusInput();
    },
    [dispatch, focusInput],
  );

  const closeBubble = useCallback(() => {
    setBubbleOpen(false);
    setDraft("");
    setNotice(null);
    openedByVoiceRef.current = false;
    dismiss();
    // Forget a build result once it has been seen; a running build carries on.
    if (showBuildRef.current) buildClear();
    bridge?.setFocusable(false);
    dispatch({ type: "bubble-close", now: Date.now() });
  }, [dismiss, buildClear, bridge, dispatch]);

  // ── "Open in Marven" on a build request ────────────────────────────────────
  // Same folder as "Build it here" (fresh, trusted, read-only profile refused),
  // then Marven's main window opens an Agent conversation on it and starts it.
  const handOffRunRef = useRef(0);
  const buildInMarven = useCallback(
    async (request: string, name: string) => {
      const run = ++handOffRunRef.current;
      const show = (text: string, outcome: "succeeded" | "failed", opts?: Parameters<typeof announce>[1]) => {
        if (run !== handOffRunRef.current) return;
        if (!bubbleOpenRef.current) openBubble(false);
        announce(text, opts);
        dispatch({ type: outcome, now: Date.now() });
      };
      announce(t("companion.build.preparing", { name }), { done: false });
      dispatch({ type: "thinking", now: Date.now() });
      try {
        const prep = await prepareProjectFolder(name, settingsRef.current.projectsDir);
        if (!prep.ok) {
          show(prep.message, "failed", prep.settingsPage ? { action: "open-settings", settingsPage: prep.settingsPage } : undefined);
          return;
        }
        const result = bridge
          ? await bridge.openInMarven([{ role: "user", content: request }], "agent", { workspaceRoot: prep.root, autostart: true })
          : { ok: false };
        if (result.ok) show(t("companion.build.inMarven"), "succeeded", { speak: true });
        else if (result.reason === "busy")
          // Marven's Agent is on something else: offer to build it here, in the folder just made.
          show(t("companion.build.agentBusy"), "failed", { action: "build-here", build: { request, name, root: prep.root }, speak: true });
        else show(t("companion.build.handOffRefused"), "failed");
      } catch (err) {
        show(chatErrorMessage(err), "failed");
      }
    },
    [announce, bridge, dispatch, openBubble, t],
  );

  const {
    voiceState,
    voiceError,
    wakeEnabled,
    toggleWakeWord,
    startManualListen,
    pauseVoiceCapture,
    resumeWakeWord,
  } = useVoice(
    (text) => {
      openBubble(false, true);
      setDraft("");
      void send(text);
    },
    () => {
      stopSpeaking();
      openBubble(false, true);
    },
    // Empty updates just mean "capture ended"; keep the last text out of the draft entirely.
    (text) => text && setInterim(text),
  );
  voiceRef.current = { pause: pauseVoiceCapture, resume: resumeWakeWord };
  // useVoice recreates startManualListen every render; keep the latest in a ref
  // so the IPC subscriptions below aren't torn down and rebuilt each render.
  const startListenRef = useRef(startManualListen);
  startListenRef.current = startManualListen;

  // "Listen for Hey Marven" setting drives this window's wake listener.
  useEffect(() => {
    if (settings.wakeWord !== wakeEnabled) toggleWakeWord();
    // toggleWakeWord is recreated every render; only the two flags matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wakeWord, wakeEnabled]);

  // ── Wiring to the main process ─────────────────────────────────────────────
  useEffect(() => {
    if (!bridge) return;
    void bridge.getSettings().then((s) => s && setSettings(s));
    // Seed the strip and position now, rather than waiting for the first move.
    void bridge.getPosition().then((p) => {
      if (!p) return;
      stripRef.current = p.strip;
      xRef.current = p.x;
      setFacing(p.facing);
    });
    const offs = [
      bridge.onSettings(setSettings),
      bridge.onPosition((p) => {
        stripRef.current = p.strip;
        xRef.current = p.x;
        setFacing(p.facing);
        if (p.arrived) dispatch({ type: "arrived", now: Date.now(), rand: Math.random, activity: settingsRef.current.activity });
        if (p.dropped) dispatch({ type: "drop", now: Date.now(), inDock: p.inDock, falling: p.falling });
      }),
      bridge.onOpenInput(() => openBubble(true)),
      bridge.onListen(() => {
        openBubble(false, true);
        startListenRef.current();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [bridge, dispatch, openBubble]);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  // Idle clock
  useEffect(() => {
    const timer = setInterval(() => {
      const s = settingsRef.current;
      dispatch({
        type: "tick",
        now: Date.now(),
        rand: Math.random,
        strip: stripRef.current,
        activity: s.activity,
        x: xRef.current,
        restAfterMs: Math.min(REST_AFTER_MS, (s.sleepMinutes * 60_000) / 2),
        sleepAfterMs: s.sleepMinutes * 60_000,
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [dispatch]);

  const { hovered, handlers } = useCompanionPointer({
    bridge,
    dispatch,
    shapeWindow,
    onClick: () => (bubbleOpenRef.current ? closeBubble() : openBubble(true)),
    onDoubleClick: () => {
      if (bubbleOpenRef.current) closeBubble();
      dispatch({ type: "return-home", now: Date.now() });
    },
  });

  // Show a voice problem once per bubble opening.
  useEffect(() => {
    if (!bubbleOpen || !voiceError || noticeShownRef.current) return;
    noticeShownRef.current = true;
    setNotice(voiceNotice(voiceError, t as unknown as (key: string, opts?: Record<string, unknown>) => string));
    // t changes with the language; the notice is shown once per opening either way.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbleOpen, voiceError]);

  // A bubble opened by voice that heard nothing shouldn't linger.
  useEffect(() => {
    if (!bubbleOpen || !openedByVoiceRef.current) return;
    if (voiceState !== "idle" || draft || reply || busy || build) return;
    const timer = setTimeout(closeBubble, VOICE_IDLE_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [bubbleOpen, voiceState, draft, reply, busy, build, closeBubble]);

  // Fade the bubble after a finished reply unless the user is engaged with it.
  useEffect(() => {
    // A pending build choice (or "build it here instead?") waits for the user
    // rather than fading away. So does a build that's asking something.
    if (!bubbleOpen || !reply?.done || reply.action === "build-choice" || reply.action === "build-here" || buildNeedsUser || hovered || draft) return;
    const timer = setTimeout(closeBubble, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [bubbleOpen, reply, buildNeedsUser, hovered, draft, closeBubble]);

  // A build's result fades too, just later.
  useEffect(() => {
    if (!bubbleOpen || !buildFinished || hovered || draft) return;
    const timer = setTimeout(closeBubble, BUILD_RESULT_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [bubbleOpen, buildFinished, hovered, draft, closeBubble]);

  // Mini Me thinks while a build runs in front of the user; with the bubble
  // closed he goes about his day. (Closing the bubble clears "busy" as usual.)
  useEffect(() => {
    if (bubbleOpen && buildWorking) dispatch({ type: "thinking", now: Date.now() });
  }, [bubbleOpen, buildWorking, dispatch]);

  // Escape closes the bubble from anywhere in it (cards and results have no text input).
  useEffect(() => {
    if (!bubbleOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeBubble();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [bubbleOpen, closeBubble]);

  const buildHandlers = {
    onStop: () => {
      buildStop();
      // Leave the thinking pose: a small shrug, then back to standing.
      dispatch({ type: "failed", now: Date.now() });
    },
    onSwitch: buildSwitchTo,
    onClose: closeBubble,
    onAnswer: (accept: boolean) => void buildAnswer(accept),
    onKeepGoing: buildKeepGoing,
    onOpenFolder: () => {
      if (!build?.root || !bridge) return;
      void bridge.openPath(build.root).then(
        (error) => error && setNotice(t("companion.build.openFolderFailed")),
        () => setNotice(t("companion.build.openFolderFailed")),
      );
    },
    onOpenInMarven: () => {
      if (!build?.root) return;
      const summary = build.summary || t("companion.build.emptySummary");
      void bridge?.openInMarven(
        [
          { role: "user", content: build.request },
          { role: "assistant", content: summary },
        ],
        "agent",
        { workspaceRoot: build.root },
      );
      closeBubble();
    },
    onOpenUrl: (url: string) => {
      if (!bridge) return;
      void bridge.openUrl(url).then(
        (ok) => !ok && setNotice(t("companion.build.openUrlFailed")),
        () => setNotice(t("companion.build.openUrlFailed")),
      );
    },
    onOpenSettings: (page: CompanionSettingsPage) => {
      bridge?.openSettings(page);
      closeBubble();
    },
  };

  const onAction = (action: Exclude<BubbleAction, null>) => {
    if (action === "build-choice") return;
    if (action === "build-here") {
      const b = reply?.build;
      if (!b) return;
      // The question goes; the build takes the bubble.
      dismiss();
      void buildStart(b.request, b.name, b.root);
      return;
    }
    if (action === "retry") void retry();
    else if (action === "open-in-marven" || action === "open-in-agent") {
      void bridge?.openInMarven(history(), action === "open-in-agent" ? "agent" : "chat");
      closeBubble();
    } else {
      bridge?.openSettings(reply?.settingsPage);
      closeBubble();
    }
  };

  return (
    <main ref={rootRef} className="flex h-screen w-screen select-none flex-col items-center justify-end overflow-hidden">
      <style>{`html,body{background:transparent!important;overflow:hidden}`}</style>
      {bubbleOpen && (
        <div className="mb-3">
          <SpeechBubble
            reply={reply}
            busy={busy}
            listening={voiceState === "command-listening"}
            notice={notice}
            draft={draft}
            interim={interim}
            inputRef={inputRef}
            onDraftChange={setDraft}
            onSubmit={() => {
              const text = draft;
              setDraft("");
              void send(text);
            }}
            onClose={closeBubble}
            onEngage={() => {
              openedByVoiceRef.current = false;
              focusInput();
            }}
            onAction={onAction}
            onBuildChoice={chooseBuild}
            build={showBuild ? build : null}
            buildHandlers={buildHandlers}
          />
        </div>
      )}
      <div
        data-hit
        className="cursor-grab active:cursor-grabbing"
        {...handlers}
      >
        <CompanionSprite
          look={look}
          anim={behaviour.anim}
          facing={facing}
          scale={settings.scale}
          onOneshotDone={() => dispatch({ type: "oneshot-done", now: Date.now() })}
        />
      </div>
    </main>
  );
}
