// Mini Me's hand-drawn art: three styles, each a full set of layered,
// palette-indexed grids for every animation state. The JSON is generated from
// scripts/mini-me-art (see its README); don't edit it by hand.

import type { AnimState } from "../behaviour";
import detailed from "./detailed.json";
import chibi from "./chibi.json";
import chibiLarge from "./chibiLarge.json";

export type ArtStyle = "detailed" | "chibi" | "chibiLarge";

/** Rows of one-character slot codes (see palette.ts). */
export type Grid = readonly string[];

export interface ArtFrame {
  /** How far the head (and the hair, beard and glasses drawn on it) moved from the idle pose. */
  head: { dx: number; dy: number };
  body: Grid;
  /** Arms redrawn on top of hair, beard and glasses. */
  front?: Grid;
  /** Zzz, thought dots, question mark, sparkles. */
  effect?: Grid;
}

export interface ArtData {
  name: string;
  /** Width and height of every grid, in sprite pixels. */
  size: number;
  layerOrder: readonly string[];
  timing: Record<AnimState, { fps: number; loop: boolean }>;
  /** null = bald (no hair layer). */
  hair: Record<string, { front: Grid; back?: Grid } | null>;
  beard: Grid;
  glasses: Grid;
  frames: Record<AnimState, readonly ArtFrame[]>;
}

export const ART_STYLES: Record<ArtStyle, ArtData> = {
  detailed: detailed as ArtData,
  chibi: chibi as ArtData,
  chibiLarge: chibiLarge as ArtData,
};

/** Display order in the appearance editor. */
export const ART_STYLE_IDS: readonly ArtStyle[] = ["chibiLarge", "chibi", "detailed"];

export const isArtStyle = (v: unknown): v is ArtStyle =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(ART_STYLES, v);
