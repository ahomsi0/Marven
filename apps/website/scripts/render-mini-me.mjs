// Renders the Mini Me sprite sheets the landing page uses (public/mini-me/*.png)
// and their frame table (lib/miniMeArt.ts) from the app's own art and compositor.
//
//   node scripts/render-mini-me.mjs            (from apps/website; needs apps/desktop's node_modules)
//   node scripts/render-mini-me.mjs --review   (also writes a 4x review sheet to $REVIEW_DIR or the OS temp dir)
//
// Each sheet (public/mini-me/<style>-<look>.png) is one look in one art style at 1x: a row per animation state,
// a column per frame. The page scales them up with image-rendering: pixelated
// and steps through the frames with CSS, so a still frame is just "no animation".
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, "..");
const DESKTOP = path.resolve(SITE, "../desktop");
const ART_SRC = path.join(DESKTOP, "scripts/mini-me-art/art");
const OUT = path.join(SITE, "public/mini-me");

const sharp = createRequire(path.join(DESKTOP, "package.json"))("sharp");
// The reference compositor and palette the app's sprite.ts / palette.ts are ported from.
const { composeFrame } = await import(path.join(ART_SRC, "anim_render.mjs"));

const STYLES = {
  chibiLarge: { label: "Chibi" },
  chibi: { label: "Chibi mini" },
  detailed: { label: "Detailed" },
};

const art = Object.fromEntries(
  await Promise.all(
    Object.keys(STYLES).map(async (id) => [
      id,
      JSON.parse(await readFile(path.join(DESKTOP, `lib/companion/art/${id}.json`), "utf8")),
    ]),
  ),
);

// The app's default look (DEFAULT_LOOK in apps/desktop/lib/companion/look.ts).
const DEFAULT = {
  hair: "short",
  glasses: false,
  beard: false,
  colours: { skin: "#e0ac7e", hair: "#2b1d14", eyes: "#1b1b1f", shirt: "#3d6fb6", pants: "#2f3a56", shoes: "#1f1f24", glasses: "#1b1b1f" },
};

// Looks for the "make it look like you" picker; every colour is one of the editor's preset swatches.
const LOOKS = {
  you: DEFAULT,
  auburn: {
    hair: "long", glasses: false, beard: false,
    colours: { skin: "#f6d7b8", hair: "#8a3b1f", eyes: "#3f8f5a", shirt: "#3f8f5a", pants: "#4b6a88", shoes: "#f4f1ea", glasses: "#1b1b1f" },
  },
  curly: {
    hair: "curly", glasses: true, beard: true,
    colours: { skin: "#8d5a34", hair: "#14110f", eyes: "#1b1b1f", shirt: "#c0392b", pants: "#1f1f24", shoes: "#f4f1ea", glasses: "#d4a72c" },
  },
  blonde: {
    hair: "buzz", glasses: true, beard: false,
    colours: { skin: "#e9bf94", hair: "#d8b25a", eyes: "#3d6fb6", shirt: "#6b7280", pants: "#2f3a56", shoes: "#c0392b", glasses: "#1b1b1f" },
  },
  pink: {
    hair: "bun", glasses: false, beard: false,
    colours: { skin: "#c68642", hair: "#e86aa8", eyes: "#5a3825", shirt: "#7c4dbd", pants: "#8a7fb0", shoes: "#f4f1ea", glasses: "#1b1b1f" },
  },
  silver: {
    hair: "bald", glasses: true, beard: true,
    colours: { skin: "#5a3722", hair: "#9a9a9f", eyes: "#5a3825", shirt: "#2a9d8f", pants: "#6b5b3e", shoes: "#5a3825", glasses: "#3d6fb6" },
  },
  blue: {
    hair: "short", glasses: false, beard: false,
    colours: { skin: "#e0ac7e", hair: "#4aa3e8", eyes: "#7a8794", shirt: "#e0a82e", pants: "#3f5f4a", shoes: "#3d6fb6", glasses: "#1b1b1f" },
  },
};

/** A hair style the art style has: bun and ponytail stand in for each other (fitHairStyle in look.ts). */
const fitHair = (hair, style) =>
  hair in art[style].hair ? hair : hair === "bun" && "ponytail" in art[style].hair ? "ponytail" : hair === "ponytail" && "bun" in art[style].hair ? "bun" : "short";

// Every look in every art style: a few KB each.
const SHEETS = Object.keys(STYLES).flatMap((style) =>
  Object.entries(LOOKS).map(([name, look]) => ({ name: `${style}-${name}`, style, look: { ...look, hair: fitHair(look.hair, style) } })),
);

const STATES = Object.keys(art.chibiLarge.frames);
const COLS = Math.max(...Object.values(art).flatMap((a) => Object.values(a.frames).map((f) => f.length)));

/** Rows of transparent pixels under the feet in the idle pose, so the page can stand it on a line. */
function footGap(a, look) {
  const n = a.size;
  let lowest = 0;
  for (let i = 0; i < a.frames.idle.length; i++) {
    const px = composeFrame(a, look, "idle", i);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (px[(y * n + x) * 4 + 3] > 0) lowest = Math.max(lowest, y);
  }
  return n - 1 - lowest;
}

async function renderSheet({ style, look }) {
  const a = art[style];
  const n = a.size;
  const comps = [];
  STATES.forEach((s, row) =>
    a.frames[s].forEach((_, col) =>
      comps.push({
        input: composeFrame(a, look, s, col),
        raw: { width: n, height: n, channels: 4 },
        left: col * n,
        top: row * n,
      }),
    ),
  );
  return sharp({ create: { width: COLS * n, height: STATES.length * n, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png({ compressionLevel: 9, effort: 10 });
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
for (const sheet of SHEETS) await (await renderSheet(sheet)).toFile(path.join(OUT, `${sheet.name}.png`));

// Frame table for the page. Timing is the same in every style; check rather than assume.
const timing = (style) => JSON.stringify(STATES.map((s) => [art[style].frames[s].length, art[style].timing[s]]));
for (const style of Object.keys(STYLES)) if (timing(style) !== timing("chibiLarge")) throw new Error(`${style} timing differs`);

const stateRows = STATES.map((s, row) => {
  const t = art.chibiLarge.timing[s];
  return `  ${s}: { row: ${row}, frames: ${art.chibiLarge.frames[s].length}, fps: ${t.fps}, loop: ${t.loop} },`;
}).join("\n");
const styleRows = Object.entries(STYLES)
  .map(([id, { label }]) => `  ${id}: { label: ${JSON.stringify(label)}, size: ${art[id].size}, footGap: ${footGap(art[id], DEFAULT)} },`)
  .join("\n");

await writeFile(
  path.join(SITE, "lib/miniMeArt.ts"),
  `// Generated by scripts/render-mini-me.mjs from the app's Mini Me art. Don't edit by hand.

/** Columns in every sheet in public/mini-me/. */
export const SHEET_COLUMNS = ${COLS};

/** One row per animation state. */
export const MINI_ME_STATES = {
${stateRows}
} as const;

export type MiniMeState = keyof typeof MINI_ME_STATES;

/** size: sprite pixels per frame; footGap: transparent rows under the feet when idle. */
export const MINI_ME_STYLES = {
${styleRows}
} as const;

export type MiniMeStyle = keyof typeof MINI_ME_STYLES;

/** Looks; each style has a sheet per look at /mini-me/<style>-<look>.png. */
export const MINI_ME_LOOKS = ${JSON.stringify(Object.keys(LOOKS))} as const;

export type MiniMeLook = (typeof MINI_ME_LOOKS)[number];
`,
);

let total = 0;
for (const f of await readdir(OUT)) total += (await stat(path.join(OUT, f))).size;
console.log(`wrote ${SHEETS.length} sheets to public/mini-me (${(total / 1024).toFixed(1)} KB) and lib/miniMeArt.ts`);

// Optional review sheet: every sheet at 4x on a light and a dark background.
if (process.argv.includes("--review")) {
  const dir = process.env.REVIEW_DIR ?? os.tmpdir();
  const scale = 4;
  for (const bg of ["#f6f5f1", "#090b10"]) {
    const imgs = [];
    let x = 0, h = 0;
    for (const sheet of SHEETS) {
      const meta = await sharp(path.join(OUT, `${sheet.name}.png`)).metadata();
      const buf = await sharp(path.join(OUT, `${sheet.name}.png`))
        .resize(meta.width * scale, meta.height * scale, { kernel: "nearest" })
        .png()
        .toBuffer();
      imgs.push({ input: buf, left: x, top: 0 });
      x += meta.width * scale + 16;
      h = Math.max(h, meta.height * scale);
    }
    const file = path.join(dir, `mini-me-review-${bg === "#090b10" ? "dark" : "light"}.png`);
    await sharp({ create: { width: x, height: h, channels: 4, background: bg } }).composite(imgs).png().toFile(file);
    console.log("review:", file);
  }
}
