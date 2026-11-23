"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CompanionSprite } from "./CompanionSprite";
import { SpeechBubble } from "./SpeechBubble";
import { useCompanionBrain, type BrainEvent, type BubbleAction } from "@/hooks/useCompanionBrain";
import { useVoice } from "@/hooks/useVoice";
import { stopSpeaking } from "@/lib/speak";
import { initialState, reduce, type BehaviourEvent, type BehaviourState, type Strip } from "@/lib/companion/behaviour";
import { DEFAULT_LOOK, parseLook, type Look } from "@/lib/companion/look";
import { DEFAULT_COMPANION_SETTINGS, getCompanionBridge, type CompanionSettings } from "@/lib/companion/bridge";

const AUTO_CLOSE_MS = 8000;

export default function CompanionPage() {
  const bridge = useMemo(getCompanionBridge, []);
  const [settings, setSettings] = useState<CompanionSettings>(DEFAULT_COMPANION_SETTINGS);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const behaviourRef = useRef<BehaviourState>(initialState(Date.now()));
  const [behaviour, setBehaviour] = useState<BehaviourState>(behaviourRef.current);
  const [facing, setFacing] = useState<1 | -1>(1);
  const stripRef = useRef<Strip>({ minX: 0, maxX: 0 });
  const [bubbleOpen, setBubbleOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const interactiveRef = useRef(false);
  const hoveredRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pendingDropRef = useRef(false);

  const dispatch = useCallback(
    (event: BehaviourEvent) => {
      const { state, effect } = reduce(behaviourRef.current, event);
      behaviourRef.current = state;
      setBehaviour(state);
      if (effect.stop) bridge?.stop();
      if (effect.walkTo !== undefined) bridge?.walkTo(effect.walkTo);
      if (effect.returnHome) bridge?.returnHome();
    },
    [bridge],
  );

  const setInteractive = useCallback(
    (on: boolean) => {
      if (on === interactiveRef.current) return;
      interactiveRef.current = on;
      bridge?.setInteractive(on);
    },
    [bridge],
  );

  // ── Brain and voice ────────────────────────────────────────────────────────
  const voiceRef = useRef<{ pause: () => void; resume: () => void }>({ pause: () => {}, resume: () => {} });
  // Destructured so the callbacks below depend on the hook's stable functions,
  // not on the object it returns (which is new every render).
  const { reply, busy, send, retry, dismiss, history } = useCompanionBrain({
    speakReplies: settings.speak,
    onEvent: (e: BrainEvent) => dispatch({ type: e, now: Date.now() }),
    onSpeakingChange: (speaking) => (speaking ? voiceRef.current.pause() : voiceRef.current.resume()),
  });

  const openBubble = useCallback(
    (focus: boolean) => {
      setBubbleOpen(true);
      dispatch({ type: "interact", now: Date.now() });
      dispatch({ type: "bubble-open", now: Date.now() });
      setInteractive(true);
      if (focus) {
        bridge?.setFocusable(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [bridge, dispatch, setInteractive],
  );

  const closeBubble = useCallback(() => {
    setBubbleOpen(false);
    setDraft("");
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
      openBubble(false);
      setDraft("");
      void send(text);
    },
    () => {
      stopSpeaking();
      openBubble(false);
    },
    (interim) => setDraft(interim),
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
    const offs = [
      bridge.onSettings(setSettings),
      bridge.onPosition((p) => {
        stripRef.current = p.strip;
        setFacing(p.facing);
        if (p.arrived) dispatch({ type: "arrived", now: Date.now() });
        if (pendingDropRef.current) {
          pendingDropRef.current = false;
          dispatch({ type: "drop", now: Date.now(), inDock: p.inDock });
        }
      }),
      bridge.onOpenInput(() => openBubble(true)),
      bridge.onListen(() => {
        openBubble(false);
        startListenRef.current();
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [bridge, dispatch, openBubble]);

  useEffect(() => {
    fetch("/companion/look.json")
      .then((r) => r.json())
      .then((j) => setLook(parseLook(j)))
      .catch(() => {});
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
        walkAround: s.walk,
        sleepAfterMs: s.sleepMinutes * 60_000,
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [dispatch]);

  // Click-through: take the mouse only over the character or the bubble.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const hit = !!(e.target as Element | null)?.closest?.("[data-hit]");
      setInteractive(hit || !!dragRef.current);
      if (hit !== hoveredRef.current) {
        hoveredRef.current = hit;
        setHovered(hit);
        if (hit) dispatch({ type: "interact", now: Date.now() });
      }
    };
    const onLeave = () => {
      if (!dragRef.current) setInteractive(false);
      hoveredRef.current = false;
      setHovered(false);
    };
    document.addEventListener("mousemove", onMove);
    document.documentElement.addEventListener("mouseleave", onLeave);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, [dispatch, setInteractive]);

  // Fade the bubble after a finished reply unless the user is engaged with it.
  useEffect(() => {
    if (!bubbleOpen || !reply?.done || hovered || draft) return;
    const timer = setTimeout(closeBubble, AUTO_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [bubbleOpen, reply, hovered, draft, closeBubble]);

  const onAction = (action: Exclude<BubbleAction, null>) => {
    if (action === "retry") void retry();
    else if (action === "open-in-marven") {
      bridge?.openInMarven(history());
      closeBubble();
    } else {
      bridge?.openSettings();
      closeBubble();
    }
  };

  const endPointer = (clicked: boolean) => {
    const d = dragRef.current;
    if (!d) return; // already ended (e.g. lostpointercapture right after pointerup)
    dragRef.current = null;
    if (d.moved) {
      pendingDropRef.current = true;
      bridge?.drop();
    } else if (clicked) {
      if (bubbleOpen) closeBubble();
      else openBubble(true);
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
            notice={voiceError}
            draft={draft}
            inputRef={inputRef}
            onDraftChange={setDraft}
            onSubmit={() => {
              const text = draft;
              setDraft("");
              void send(text);
            }}
            onClose={closeBubble}
            onAction={onAction}
          />
        </div>
      )}
      <div
        data-hit
        className="cursor-grab active:cursor-grabbing"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { x: e.screenX, y: e.screenY, moved: false };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          const dx = e.screenX - d.x;
          const dy = e.screenY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 4) return;
          if (!d.moved) {
            d.moved = true;
            dispatch({ type: "drag-start", now: Date.now() });
          }
          d.x = e.screenX;
          d.y = e.screenY;
          bridge?.drag(dx, dy);
        }}
        onPointerUp={() => endPointer(true)}
        onPointerCancel={() => endPointer(false)}
        onLostPointerCapture={() => endPointer(false)}
        onDoubleClick={() => {
          if (bubbleOpen) closeBubble();
          dispatch({ type: "return-home", now: Date.now() });
        }}
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
