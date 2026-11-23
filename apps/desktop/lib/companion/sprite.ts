// Procedural 32×32 pixel art for Mini Me. Each frame is a few flat shapes
// (legs, torso, arms, head, hair, face) followed by a one-pixel outline pass.
// Coordinates: x 0–31 left to right, y 0–31 top to bottom, feet on row 31.

import type { AnimState } from "./behaviour";
import type { Look } from "./look";

export const SPRITE_SIZE = 32;
export const OUTLINE = "#141418";
const EFFECT = "#f4f1ea";
const GOLD = "#ffd75e";

export type Eyes = "open" | "closed" | "look-left" | "look-right" | "happy";
export type Mouth = "closed" | "smile" | "open" | "o" | "frown";
export type Arms = "down" | "up" | "ear" | "chin" | "shrug";
export type Legs = "stand" | "walk1" | "walk3" | "sit";
export type Extra = "zzz1" | "zzz2" | "dots1" | "dots2" | "dots3" | "question" | "sparkle";

export interface FrameSpec {
  dy?: 0 | 1;
  eyes?: Eyes;
  mouth?: Mouth;
  arms?: Arms;
  legs?: Legs;
  extra?: Extra;
}

export interface Animation {
  frames: FrameSpec[];
  fps: number;
  loop: boolean;
}

export const ANIMATIONS: Record<AnimState, Animation> = {
  idle: { frames: [{}, { dy: 1 }, {}, { dy: 1 }, {}, { eyes: "closed" }], fps: 4, loop: true },
  walk: { frames: [{ legs: "walk1" }, { legs: "stand", dy: 1 }, { legs: "walk3" }, { legs: "stand", dy: 1 }], fps: 8, loop: true },
  look: { frames: [{ eyes: "look-left" }, { eyes: "look-left" }, { eyes: "look-right" }, { eyes: "look-right" }], fps: 2, loop: true },
  sit: { frames: [{ legs: "sit" }, { legs: "sit", dy: 1 }], fps: 2, loop: true },
  stretch: {
    frames: [{ arms: "up" }, { arms: "up", mouth: "o" }, { arms: "up", mouth: "o", eyes: "closed" }, { arms: "down" }],
    fps: 4,
    loop: false,
  },
  sleep: {
    frames: [
      { legs: "sit", eyes: "closed", extra: "zzz1" },
      { legs: "sit", eyes: "closed", dy: 1, extra: "zzz2" },
    ],
    fps: 1.5,
    loop: true,
  },
  listen: { frames: [{ arms: "ear", eyes: "look-right" }, { arms: "ear", eyes: "look-right", dy: 1 }], fps: 2, loop: true },
  think: {
    frames: [
      { arms: "chin", eyes: "look-left", extra: "dots1" },
      { arms: "chin", eyes: "look-left", extra: "dots2" },
      { arms: "chin", eyes: "look-left", extra: "dots3" },
    ],
    fps: 3,
    loop: true,
  },
  talk: { frames: [{ mouth: "open" }, { mouth: "closed" }, { mouth: "o" }, { mouth: "closed" }], fps: 8, loop: true },
  happy: {
    frames: [
      { arms: "up", eyes: "happy", mouth: "smile", extra: "sparkle" },
      { arms: "down", eyes: "happy", mouth: "smile", dy: 1 },
      { arms: "up", eyes: "happy", mouth: "smile", extra: "sparkle" },
      { arms: "down", eyes: "happy", mouth: "smile", dy: 1 },
    ],
    fps: 6,
    loop: false,
  },
  confused: {
    frames: [
      { arms: "shrug", mouth: "frown", extra: "question" },
      { arms: "shrug", mouth: "frown", extra: "question", dy: 1 },
      { arms: "shrug", mouth: "frown", extra: "question" },
      { arms: "shrug", mouth: "frown", extra: "question", dy: 1 },
    ],
    fps: 3,
    loop: false,
  },
  dangle: { frames: [{ arms: "up", mouth: "o" }, { arms: "up", mouth: "o", dy: 1 }], fps: 3, loop: true },
};

/** Colours for one 32×32 frame, row-major; null is transparent. */
export function renderFrame(look: Look, spec: FrameSpec): (string | null)[] {
  const N = SPRITE_SIZE;
  const px: (string | null)[] = new Array(N * N).fill(null);
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && x < N && y >= 0 && y < N) px[y * N + x] = c;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c);
  };
  const box = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    rect(x0, y0, x1, y0, c);
    rect(x0, y1, x1, y1, c);
    rect(x0, y0, x0, y1, c);
    rect(x1, y0, x1, y1, c);
  };

  const legs = spec.legs ?? "stand";
  const d = (spec.dy ?? 0) + (legs === "sit" ? 5 : 0);

  // Legs and shoes (planted: not shifted by dy)
  if (legs === "sit") {
    rect(12, 27, 23, 29, look.pants);
    rect(24, 26, 25, 29, look.shoes);
  } else if (legs === "walk1") {
    rect(10, 24, 12, 29, look.pants);
    rect(19, 24, 21, 29, look.pants);
    rect(9, 30, 12, 31, look.shoes);
    rect(19, 30, 22, 31, look.shoes);
  } else if (legs === "walk3") {
    rect(13, 24, 15, 29, look.pants);
    rect(16, 24, 18, 29, look.pants);
    rect(13, 30, 16, 31, look.shoes);
    rect(16, 30, 19, 31, look.shoes);
  } else {
    rect(12, 24, 14, 29, look.pants);
    rect(17, 24, 19, 29, look.pants);
    rect(11, 30, 14, 31, look.shoes);
    rect(17, 30, 20, 31, look.shoes);
  }

  // Torso
  rect(11, 15 + d, 20, 23 + d, look.shirt);

  // Arms (sleeves in shirt colour, hands in skin)
  const arms = spec.arms ?? "down";
  const leftDown = () => {
    rect(9, 16 + d, 10, 21 + d, look.shirt);
    rect(9, 22 + d, 10, 22 + d, look.skin);
  };
  const rightDown = () => {
    rect(21, 16 + d, 22, 21 + d, look.shirt);
    rect(21, 22 + d, 22, 22 + d, look.skin);
  };
  if (arms === "up") {
    rect(9, 8 + d, 10, 15 + d, look.shirt);
    rect(9, 7 + d, 10, 7 + d, look.skin);
    rect(21, 8 + d, 22, 15 + d, look.shirt);
    rect(21, 7 + d, 22, 7 + d, look.skin);
  } else if (arms === "ear") {
    leftDown();
    rect(21, 12 + d, 22, 17 + d, look.shirt);
    rect(21, 10 + d, 22, 11 + d, look.skin);
  } else if (arms === "chin") {
    leftDown();
    rect(21, 16 + d, 22, 19 + d, look.shirt);
    rect(18, 17 + d, 20, 18 + d, look.skin);
  } else if (arms === "shrug") {
    rect(9, 16 + d, 10, 17 + d, look.shirt);
    rect(7, 14 + d, 8, 16 + d, look.shirt);
    rect(7, 13 + d, 8, 13 + d, look.skin);
    rect(21, 16 + d, 22, 17 + d, look.shirt);
    rect(23, 14 + d, 24, 16 + d, look.shirt);
    rect(23, 13 + d, 24, 13 + d, look.skin);
  } else {
    leftDown();
    rightDown();
  }

  // Head, beard, hair
  rect(11, 5 + d, 20, 14 + d, look.skin);
  if (look.beard) rect(11, 12 + d, 20, 14 + d, look.hair);
  const shortHair = () => {
    rect(11, 4 + d, 20, 6 + d, look.hair);
    rect(10, 5 + d, 10, 9 + d, look.hair);
    rect(21, 5 + d, 21, 9 + d, look.hair);
  };
  if (look.hairStyle === "short") shortHair();
  else if (look.hairStyle === "long") {
    shortHair();
    rect(10, 5 + d, 10, 16 + d, look.hair);
    rect(21, 5 + d, 21, 16 + d, look.hair);
  } else if (look.hairStyle === "curly") {
    rect(10, 3 + d, 21, 6 + d, look.hair);
    for (const x of [11, 14, 17, 20]) set(x, 2 + d, look.hair);
    rect(10, 7 + d, 10, 10 + d, look.hair);
    rect(21, 7 + d, 21, 10 + d, look.hair);
  } else if (look.hairStyle === "buzz") {
    rect(11, 4 + d, 20, 5 + d, look.hair);
  }

  // Eyes
  const eyes = spec.eyes ?? "open";
  if (eyes === "closed") {
    rect(12, 10 + d, 13, 10 + d, look.eyes);
    rect(18, 10 + d, 19, 10 + d, look.eyes);
  } else if (eyes === "happy") {
    set(12, 10 + d, look.eyes); set(13, 9 + d, look.eyes); set(14, 10 + d, look.eyes);
    set(17, 10 + d, look.eyes); set(18, 9 + d, look.eyes); set(19, 10 + d, look.eyes);
  } else {
    const shift = eyes === "look-left" ? -1 : eyes === "look-right" ? 1 : 0;
    rect(13 + shift, 9 + d, 13 + shift, 10 + d, look.eyes);
    rect(18 + shift, 9 + d, 18 + shift, 10 + d, look.eyes);
  }

  // Mouth
  const mouth = spec.mouth ?? "closed";
  if (mouth === "smile") {
    set(14, 12 + d, OUTLINE); rect(15, 13 + d, 16, 13 + d, OUTLINE); set(17, 12 + d, OUTLINE);
  } else if (mouth === "open") {
    rect(14, 12 + d, 17, 13 + d, OUTLINE);
  } else if (mouth === "o") {
    rect(15, 12 + d, 16, 13 + d, OUTLINE);
  } else if (mouth === "frown") {
    set(14, 13 + d, OUTLINE); rect(15, 12 + d, 16, 12 + d, OUTLINE); set(17, 13 + d, OUTLINE);
  } else {
    rect(15, 12 + d, 16, 12 + d, OUTLINE);
  }

  // Glasses: two frames around the eyes, touching in the middle
  if (look.glasses) {
    box(11, 8 + d, 15, 11 + d, look.glassesColor);
    box(16, 8 + d, 20, 11 + d, look.glassesColor);
  }

  // Effects (fixed position, above the head)
  const extra = spec.extra;
  if (extra === "zzz1" || extra === "zzz2") {
    rect(23, 3, 25, 3, EFFECT); set(24, 4, EFFECT); rect(23, 5, 25, 5, EFFECT);
    if (extra === "zzz2") {
      rect(26, 0, 28, 0, EFFECT); set(27, 1, EFFECT); rect(26, 2, 28, 2, EFFECT);
    }
  } else if (extra === "dots1" || extra === "dots2" || extra === "dots3") {
    set(25, 6, EFFECT);
    if (extra !== "dots1") set(27, 6, EFFECT);
    if (extra === "dots3") set(29, 6, EFFECT);
  } else if (extra === "question") {
    for (const [x, y] of [[26, 1], [27, 0], [28, 0], [29, 1], [29, 2], [28, 3], [27, 4], [27, 6]]) set(x, y, GOLD);
  } else if (extra === "sparkle") {
    set(4, 6, GOLD); rect(3, 7, 5, 7, GOLD); set(4, 8, GOLD);
    set(27, 3, GOLD); rect(26, 4, 28, 4, GOLD); set(27, 5, GOLD);
  }

  // Outline: every empty pixel touching a filled one
  const filled = px.slice();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      if (filled[y * N + x]) continue;
      const touches = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ox, oy]) => {
        const nx = x + ox;
        const ny = y + oy;
        return nx >= 0 && nx < N && ny >= 0 && ny < N && filled[ny * N + nx] !== null;
      });
      if (touches) px[y * N + x] = OUTLINE;
    }
  }
  return px;
}
