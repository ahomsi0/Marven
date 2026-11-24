"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompanionSprite } from "./CompanionSprite";
import { SpeechBubble } from "./SpeechBubble";
import { useCompanionPointer } from "./useCompanionPointer";
import { useCompanionBrain, type BrainEvent, type BubbleAction } from "@/hooks/useCompanionBrain";
import { useVoice } from "@/hooks/useVoice";
import { stopSpeaking } from "@/lib/speak";
import { initialState, reduce, type BehaviourEvent, type BehaviourState, type Strip } from "@/lib/companion/behaviour";
import { useT } from "@/lib/i18n";
import { voiceNotice } from "@/lib/companion/voiceNotice";
import { DEFAULT_LOOK, parseLook } from "@/lib/companion/look";
import { DEFAULT_COMPANION_SETTINGS, getCompanionBridge, type CompanionSettings } from "@/lib/companion/bridge";

const AUTO_CLOSE_MS = 8000;
/** Left alone this long, Mini Me sits down and stays seated. */
const REST_AFTER_MS = 120_000;
/** A voice-opened bubble that heard nothing closes itself after this. */
const VOICE_IDLE_CLOSE_MS = 4000;

export default function CompanionPage() {
  const { t } = useT();
  const bridge = useMemo(getCompanionBridge, []);
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
  const { reply, busy, send, retry, dismiss, history } = useCompanionBrain({
    speakReplies: settings.speak,
    personality: settings.personality,
    onEvent: (e: BrainEvent) => dispatch({ type: e, now: Date.now() }),
    onSpeakingChange: (speaking) => (speaking ? voiceRef.current.pause() : voiceRef.current.resume()),
    onNotify: () => openBubble(false),
  });

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
    bridge?.setFocusable(false);
    dispatch({ type: "bubble-close", now: Date.now() });
  }, [dismiss, bridge, dispatch]);

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
        if (p.dropped) dispatch({ type: "drop", now: Date.now(), inDock: p.inDock });
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
    if (voiceState !== "idle" || draft || reply || busy) return;
    const timer = setTimeout(closeBubble, VOICE_IDLE_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [bubbleOpen, voiceState, draft, reply, busy, closeBubble]);

  // Fade the bubble after a finished reply unless the user is engaged with it.
  useEffect(() => {
    if (!bubbleOpen || !reply?.done || hovered || draft) return;
    const timer = setTimeout(closeBubble, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [bubbleOpen, reply, hovered, draft, closeBubble]);

  const onAction = (action: Exclude<BubbleAction, null>) => {
    if (action === "retry") void retry();
    else if (action === "open-in-marven" || action === "open-in-agent") {
      bridge?.openInMarven(history(), action === "open-in-agent" ? "agent" : "chat");
      closeBubble();
    } else {
      bridge?.openSettings();
      closeBubble();
    }
  };

  return (
    <main className="flex h-screen w-screen select-none flex-col items-center justify-end overflow-hidden">
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
