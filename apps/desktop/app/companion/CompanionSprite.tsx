"use client";

import { useCallback, useEffect, useRef } from "react";
import { ANIMATIONS, artSize, composeFrame, pixelScale } from "@/lib/companion/sprite";
import type { AnimState } from "@/lib/companion/behaviour";
import type { Look } from "@/lib/companion/look";

// Composed frames as small canvases, shared by every sprite on the page.
// Keyed by look, state and frame; a colour-picker drag makes many looks, so
// the oldest entries are dropped past the cap.
const FRAME_CACHE_MAX = 400;
const frameCache = new Map<string, HTMLCanvasElement>();

function frameCanvas(look: Look, lookKey: string, state: AnimState, index: number): HTMLCanvasElement {
  const key = `${lookKey}|${state}|${index}`;
  const hit = frameCache.get(key);
  if (hit) {
    // Refresh its place in the eviction order.
    frameCache.delete(key);
    frameCache.set(key, hit);
    return hit;
  }
  const size = artSize(look.artStyle);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const data = composeFrame(look, state, index);
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(data), size, size), 0, 0);
  frameCache.set(key, canvas);
  while (frameCache.size > FRAME_CACHE_MAX) frameCache.delete(frameCache.keys().next().value as string);
  return canvas;
}

function paint(canvas: HTMLCanvasElement, frame: HTMLCanvasElement, facing: 1 | -1) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (facing < 0) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/** On-screen size in CSS pixels for a look and size step. */
const displaySize = (look: Look, scale: number) => {
  const size = artSize(look.artStyle);
  return size * pixelScale(size, scale);
};

interface Props {
  look: Look;
  anim: AnimState;
  facing: 1 | -1;
  /** Size step: 2, 3 or 4 (see pixelScale). */
  scale: number;
  onOneshotDone: () => void;
}

/**
 * Plays Mini Me's current animation on a canvas, scaled up with crisp pixels.
 * A new look redraws the current frame in place; a new state starts from frame 0.
 */
export function CompanionSprite({ look, anim, facing, scale, onOneshotDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onOneshotDone);
  doneRef.current = onOneshotDone;
  const lookKey = JSON.stringify(look);
  const latest = useRef({ look, lookKey, anim, facing });
  latest.current = { look, lookKey, anim, facing };
  const frameRef = useRef(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { look, lookKey, anim, facing } = latest.current;
    paint(canvas, frameCanvas(look, lookKey, anim, frameRef.current), facing);
  }, []);

  // Play the animation; restart only when the state changes.
  useEffect(() => {
    const { frames, fps, loop } = ANIMATIONS[anim];
    frameRef.current = 0;
    draw();
    const timer = setInterval(() => {
      if (frameRef.current === frames - 1 && !loop) {
        clearInterval(timer);
        doneRef.current();
        return;
      }
      frameRef.current = (frameRef.current + 1) % frames;
      draw();
    }, 1000 / fps);
    return () => clearInterval(timer);
  }, [anim, draw]);

  // Look, facing or size changed: redraw the current frame without restarting.
  // (Resizing the canvas also clears it.)
  const px = displaySize(look, scale);
  useEffect(draw, [lookKey, facing, px, draw]);

  return (
    <canvas
      ref={canvasRef}
      width={px}
      height={px}
      style={{ width: px, height: px, imageRendering: "pixelated" }}
      aria-label="Mini Me"
    />
  );
}

/** One still frame (idle, first frame by default), e.g. for a thumbnail. */
export function SpriteStill({
  look,
  scale,
  state = "idle",
  index = 0,
  className,
}: {
  look: Look;
  scale: number;
  state?: AnimState;
  index?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lookKey = JSON.stringify(look);
  const px = displaySize(look, scale);
  useEffect(() => {
    if (canvasRef.current) paint(canvasRef.current, frameCanvas(look, lookKey, state, index), 1);
    // `look` is represented by lookKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookKey, state, index, px]);
  return (
    <canvas
      ref={canvasRef}
      width={px}
      height={px}
      className={className}
      style={{ width: px, height: px, imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}
