import type { CSSProperties } from "react";
import {
  MINI_ME_STATES,
  MINI_ME_STYLES,
  SHEET_COLUMNS,
  type MiniMeLook,
  type MiniMeState,
  type MiniMeStyle,
} from "@/lib/miniMeArt";

/**
 * Mini Me, drawn from the app's own art (see scripts/render-mini-me.mjs).
 * `scale` is screen pixels per sprite pixel for the 48 px styles (the 32 px
 * style gets 1.5x that); leave it out to set `--mm-scale` from a class instead.
 * With prefers-reduced-motion it holds the first frame.
 */
export function MiniMeSprite({
  artStyle = "chibiLarge",
  look = "you",
  state = "idle",
  scale,
  loop,
  delay,
  label,
  className = "",
}: {
  artStyle?: MiniMeStyle;
  look?: MiniMeLook;
  state?: MiniMeState;
  scale?: number;
  /** Override the state's own looping (happy, stretch and confused play once by default). */
  loop?: boolean;
  /** Start part-way through the cycle (ms), so a row of them doesn't move in lockstep. */
  delay?: number;
  /** Accessible description; without one the sprite is decorative. */
  label?: string;
  className?: string;
}) {
  const st = MINI_ME_STATES[state];
  const size = MINI_ME_STYLES[artStyle].size;
  const once = !(loop ?? st.loop) && st.frames > 1;
  const style = {
    "--mm-sheet": `url(/mini-me/${artStyle}-${look}.png)`,
    "--mm-size": size,
    "--mm-cols": SHEET_COLUMNS,
    "--mm-row": st.row,
    "--mm-steps": once ? st.frames - 1 : st.frames,
    "--mm-end": once ? st.frames - 1 : st.frames,
    "--mm-dur": `${(st.frames / st.fps).toFixed(3)}s`,
    ...(scale ? { "--mm-scale": scale } : {}),
    ...(delay ? { animationDelay: `${-delay}ms` } : {}),
  } as CSSProperties;

  return (
    <span
      // A new key restarts the animation when the pose changes.
      key={`${artStyle}-${state}`}
      data-size={size}
      className={`mm-sprite ${once ? "mm-once" : ""} ${className}`}
      style={style}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    />
  );
}
