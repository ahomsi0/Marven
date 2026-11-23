"use client";

// Pointer handling for the Mini Me window: dragging the character, click vs.
// double-click, and click-through hit-testing (the window only takes the mouse
// while the pointer is over something marked `data-hit`).

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { BehaviourEvent } from "@/lib/companion/behaviour";
import type { CompanionBridge } from "@/lib/companion/bridge";

/** A second click inside this window is a double-click, not two toggles. */
const CLICK_DELAY_MS = 250;
const DRAG_THRESHOLD_PX = 4;

interface Options {
  bridge: CompanionBridge | null;
  dispatch: (event: BehaviourEvent) => void;
  onClick: () => void;
  onDoubleClick: () => void;
}

export function useCompanionPointer({ bridge, dispatch, onClick, onDoubleClick }: Options) {
  const [hovered, setHovered] = useState(false);
  const hoveredRef = useRef(false);
  const interactiveRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacksRef = useRef({ onClick, onDoubleClick });
  callbacksRef.current = { onClick, onDoubleClick };

  const setInteractive = useCallback(
    (on: boolean) => {
      if (on === interactiveRef.current) return;
      interactiveRef.current = on;
      bridge?.setInteractive(on);
    },
    [bridge],
  );

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

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  const endPointer = (clicked: boolean) => {
    const d = dragRef.current;
    if (!d) return; // already ended (e.g. lostpointercapture right after pointerup)
    dragRef.current = null;
    if (d.moved) {
      bridge?.drop(); // the main process answers with a position flagged `dropped`
    } else if (clicked) {
      // Wait out a possible double-click before treating this as a single click.
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        callbacksRef.current.onClick();
      }, CLICK_DELAY_MS);
    }
  };

  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { x: e.screenX, y: e.screenY, moved: false };
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.screenX - d.x;
      const dy = e.screenY - d.y;
      if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      if (!d.moved) {
        d.moved = true;
        dispatch({ type: "drag-start", now: Date.now() });
      }
      d.x = e.screenX;
      d.y = e.screenY;
      bridge?.drag(dx, dy);
    },
    onPointerUp: () => endPointer(true),
    onPointerCancel: () => endPointer(false),
    onLostPointerCapture: () => endPointer(false),
    onDoubleClick: () => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      callbacksRef.current.onDoubleClick();
    },
  };

  return { hovered, handlers };
}
