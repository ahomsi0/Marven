"use client";

// Your picture, wherever Marven shows you: your initial on a colour, a photo
// you chose, or your Mini Me's face (cropped from his idle frame, in the look
// you gave him in Settings → Mini Me).

import { useEffect, useRef, useState } from "react";
import type { ProfileAvatar as Avatar } from "@/lib/userProfile";
import { AVATAR_COLORS } from "@/lib/userProfile";
import { DEFAULT_LOOK, parseLook, type Look } from "@/lib/companion/look";
import { artSize, composeFrame } from "@/lib/companion/sprite";

/** Your Mini Me's look from Marven's settings (the default look outside the desktop app). */
function useMiniMeLook(enabled: boolean): Look {
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = (window as any).marvenElectron;
    if (!electron?.getSettings) return;
    void electron.getSettings().then(
      (s: { miniMeLook?: unknown } | null) => {
        if (!cancelled && s?.miniMeLook) setLook(parseLook(s.miniMeLook));
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return look;
}

/** His face: the head of his first idle frame, drawn crisp onto a canvas. */
function MiniMeFace({ size }: { size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const look = useMiniMeLook(true);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const n = artSize(look.artStyle);
    const frame = document.createElement("canvas");
    frame.width = n;
    frame.height = n;
    frame.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(composeFrame(look, "idle", 0)), n, n), 0, 0);
    // The head sits in the upper middle of every style's frame.
    const box = Math.round(n * 0.625);
    const sx = Math.round(n * 0.19);
    const sy = Math.round(n * 0.08);
    canvas.width = box;
    canvas.height = box;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, box, box);
    ctx.drawImage(frame, sx, sy, box, box, 0, 0, box, box);
  }, [look]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="block"
      style={{ width: size - 2, height: size - 2, marginTop: Math.round(size * 0.12), imageRendering: "pixelated" }}
    />
  );
}

export function ProfileAvatar({ avatar, name, size = 30 }: { avatar?: Avatar; name: string; size?: number }) {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const box = { width: size, height: size };
  if (avatar?.kind === "photo") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar.dataUrl} alt="" aria-hidden style={box} className="shrink-0 rounded-full object-cover" />;
  }
  if (avatar?.kind === "minime") {
    return (
      <span style={box} className="flex shrink-0 items-start justify-center overflow-hidden rounded-full bg-[var(--m-surface-3)]">
        <MiniMeFace size={size} />
      </span>
    );
  }
  const color = avatar?.kind === "initial" ? avatar.color : null;
  return (
    <span
      aria-hidden
      style={{ ...box, fontSize: Math.round(size * 0.43), ...(color ? { background: color, color: "#16110b" } : {}) }}
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${
        color ? "" : "bg-[var(--m-accent-soft)] text-[var(--m-accent)]"
      }`}
    >
      {initial}
    </span>
  );
}

export { AVATAR_COLORS };
