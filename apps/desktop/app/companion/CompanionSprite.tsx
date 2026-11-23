"use client";

import { useEffect, useMemo, useRef } from "react";
import { ANIMATIONS, SPRITE_SIZE, renderFrame } from "@/lib/companion/sprite";
import type { AnimState } from "@/lib/companion/behaviour";
import type { Look } from "@/lib/companion/look";

interface Props {
  look: Look;
  anim: AnimState;
  facing: 1 | -1;
  scale: number;
  onOneshotDone: () => void;
}

/** Plays Mini Me's current animation on a canvas, scaled up with crisp pixels. */
export function CompanionSprite({ look, anim, facing, scale, onOneshotDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onOneshotDone);
  doneRef.current = onOneshotDone;

  // Rendered frames, per animation, for the current look.
  const framesFor = useMemo(() => {
    const cache = new Map<AnimState, HTMLCanvasElement[]>();
    return (state: AnimState) => {
      let list = cache.get(state);
      if (!list) {
        list = ANIMATIONS[state].frames.map((spec) => {
          const c = document.createElement("canvas");
          c.width = SPRITE_SIZE;
          c.height = SPRITE_SIZE;
          const ctx = c.getContext("2d");
          if (ctx) {
            renderFrame(look, spec).forEach((color, i) => {
              if (!color) return;
              ctx.fillStyle = color;
              ctx.fillRect(i % SPRITE_SIZE, Math.floor(i / SPRITE_SIZE), 1, 1);
            });
          }
          return c;
        });
        cache.set(state, list);
      }
      return list;
    };
  }, [look]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const animation = ANIMATIONS[anim];
    const frames = framesFor(anim);
    let i = 0;
    const draw = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      if (facing < 0) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(frames[i], 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    draw();
    const timer = setInterval(() => {
      if (i === frames.length - 1 && !animation.loop) {
        clearInterval(timer);
        doneRef.current();
        return;
      }
      i = (i + 1) % frames.length;
      draw();
    }, 1000 / animation.fps);
    return () => clearInterval(timer);
  }, [anim, facing, framesFor]);

  const px = SPRITE_SIZE * scale;
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
