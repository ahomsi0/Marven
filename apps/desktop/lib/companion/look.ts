// What Mini Me looks like. Stored in settings as `miniMeLook`; every field
// falls back to the default on its own, so a bad value never breaks the character.

import { ART_STYLES, ART_STYLE_IDS, isArtStyle, type ArtStyle } from "./art";
import type { SlotColours } from "./palette";

export type { ArtStyle } from "./art";

/** Every hair style any art style has; each art style offers a subset (hairStylesFor). */
export type HairStyle = "short" | "long" | "curly" | "buzz" | "bald" | "bun" | "ponytail";

/** Editor order. */
export const ALL_HAIR_STYLES: readonly HairStyle[] = ["short", "long", "curly", "buzz", "bun", "ponytail", "bald"];

export interface Look {
  artStyle: ArtStyle;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  eyes: string;
  glasses: boolean;
  glassesColor: string;
  beard: boolean;
  shirt: string;
  pants: string;
  shoes: string;
}

export const DEFAULT_LOOK: Look = {
  artStyle: "chibiLarge",
  skin: "#e0ac7e",
  hair: "#2b1d14",
  hairStyle: "short",
  eyes: "#1b1b1f",
  glasses: false,
  glassesColor: "#1b1b1f",
  beard: false,
  shirt: "#3d6fb6",
  pants: "#2f3a56",
  shoes: "#1f1f24",
};

// Colours must be 6-digit hex like "#3d6fb6"; 3-digit shorthand is not accepted.
const HEX = /^#[0-9a-f]{6}$/i;

/** The hair styles an art style has, in editor order. */
export function hairStylesFor(artStyle: ArtStyle): readonly HairStyle[] {
  const hair = ART_STYLES[artStyle].hair;
  return ALL_HAIR_STYLES.filter((s) => Object.prototype.hasOwnProperty.call(hair, s));
}

/** A hair style the art style has: bun and ponytail stand in for each other, anything else becomes short. */
export function fitHairStyle(style: unknown, artStyle: ArtStyle): HairStyle {
  return fitHairStyleTo(style, hairStylesFor(artStyle));
}

/** fitHairStyle against an explicit list of available styles. */
export function fitHairStyleTo(style: unknown, available: readonly string[]): HairStyle {
  if (available.includes(style as string)) return style as HairStyle;
  const swap: HairStyle | null = style === "bun" ? "ponytail" : style === "ponytail" ? "bun" : null;
  if (swap && available.includes(swap)) return swap;
  return "short";
}

/** The look's colours as the palette's input. */
export function slotColours(look: Look): SlotColours {
  return {
    skin: look.skin,
    hair: look.hair,
    eyes: look.eyes,
    shirt: look.shirt,
    pants: look.pants,
    shoes: look.shoes,
    glasses: look.glassesColor,
  };
}
export type ColorKey = "skin" | "hair" | "eyes" | "glassesColor" | "shirt" | "pants" | "shoes";

/** Colour fields in editor order, with their preset swatches. */
export const COLOR_PRESETS: Record<ColorKey, readonly string[]> = {
  skin: ["#f6d7b8", "#e9bf94", "#e0ac7e", "#c68642", "#8d5a34", "#5a3722"],
  hair: ["#14110f", "#2b1d14", "#5a3825", "#8a3b1f", "#d8b25a", "#9a9a9f", "#e86aa8", "#4aa3e8"],
  eyes: ["#1b1b1f", "#5a3825", "#3d6fb6", "#3f8f5a", "#7a8794"],
  glassesColor: ["#1b1b1f", "#5a3825", "#c0392b", "#3d6fb6", "#d4a72c"],
  shirt: ["#3d6fb6", "#c0392b", "#3f8f5a", "#e0a82e", "#7c4dbd", "#2a9d8f", "#e07a9a", "#6b7280"],
  pants: ["#2f3a56", "#1f1f24", "#6b5b3e", "#4b6a88", "#6b7280", "#7a3b3b", "#3f5f4a", "#8a7fb0"],
  shoes: ["#1f1f24", "#5a3825", "#f4f1ea", "#c0392b", "#3d6fb6", "#6b7280"],
};

export function parseLook(raw: unknown): Look {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const color = (k: ColorKey) => (typeof o[k] === "string" && HEX.test(o[k] as string) ? (o[k] as string) : DEFAULT_LOOK[k]);
  const flag = (k: "glasses" | "beard") => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_LOOK[k]);
  const artStyle = isArtStyle(o.artStyle) ? o.artStyle : DEFAULT_LOOK.artStyle;
  return {
    artStyle,
    skin: color("skin"),
    hair: color("hair"),
    hairStyle: fitHairStyle(o.hairStyle, artStyle),
    eyes: color("eyes"),
    glasses: flag("glasses"),
    glassesColor: color("glassesColor"),
    beard: flag("beard"),
    shirt: color("shirt"),
    pants: color("pants"),
    shoes: color("shoes"),
  };
}

const pick = <T>(list: readonly T[], rand: () => number): T =>
  list[Math.min(list.length - 1, Math.max(0, Math.floor(rand() * list.length)))];

/** A random but tasteful look: an art style, one preset per colour, a hair style, and occasional glasses or beard. */
export function randomLook(rand: () => number = Math.random): Look {
  const artStyle = pick(ART_STYLE_IDS, rand);
  return {
    artStyle,
    skin: pick(COLOR_PRESETS.skin, rand),
    hair: pick(COLOR_PRESETS.hair, rand),
    hairStyle: pick(hairStylesFor(artStyle), rand),
    eyes: pick(COLOR_PRESETS.eyes, rand),
    glasses: rand() < 0.3,
    glassesColor: pick(COLOR_PRESETS.glassesColor, rand),
    beard: rand() < 0.25,
    shirt: pick(COLOR_PRESETS.shirt, rand),
    pants: pick(COLOR_PRESETS.pants, rand),
    shoes: pick(COLOR_PRESETS.shoes, rand),
  };
}
