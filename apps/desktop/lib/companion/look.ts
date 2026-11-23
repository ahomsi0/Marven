// What Mini Me looks like. Loaded from public/companion/look.json; every field
// falls back to the default on its own, so a typo never breaks the character.

export type HairStyle = "short" | "long" | "curly" | "buzz" | "bald";

export interface Look {
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
const HAIR_STYLES: readonly HairStyle[] = ["short", "long", "curly", "buzz", "bald"];
type ColorKey = "skin" | "hair" | "eyes" | "glassesColor" | "shirt" | "pants" | "shoes";

export function parseLook(raw: unknown): Look {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const color = (k: ColorKey) => (typeof o[k] === "string" && HEX.test(o[k] as string) ? (o[k] as string) : DEFAULT_LOOK[k]);
  const flag = (k: "glasses" | "beard") => (typeof o[k] === "boolean" ? (o[k] as boolean) : DEFAULT_LOOK[k]);
  const hairStyle = HAIR_STYLES.includes(o.hairStyle as HairStyle) ? (o.hairStyle as HairStyle) : DEFAULT_LOOK.hairStyle;
  return {
    skin: color("skin"),
    hair: color("hair"),
    hairStyle,
    eyes: color("eyes"),
    glasses: flag("glasses"),
    glassesColor: color("glassesColor"),
    beard: flag("beard"),
    shirt: color("shirt"),
    pants: color("pants"),
    shoes: color("shoes"),
  };
}
