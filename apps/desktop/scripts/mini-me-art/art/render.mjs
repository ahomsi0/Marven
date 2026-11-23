// Mini Me — compositor + PNG writer.
//
//   node render.mjs            -> compare.png + sheet_A/B/C.png (per-direction review sheets)
//   node render.mjs check      -> validate grids only
//
// Layer order (all directions):
//   hair.back  ->  body  ->  beard  ->  hair.front  ->  glasses
// A hair style is either a grid (front only) or { back, front }. `bald` = null.
// '.' leaves lower layers untouched, '_' erases to transparent, anything else
// paints its slot colour (alpha-blended, so lenses tint the eyes beneath).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSlots, hexToRgba, COLOURWAYS } from './palette.mjs';
import A from './directionA.mjs';
import B from './directionB.mjs';
import C from './directionC.mjs';

const sharp = createRequire(import.meta.url)('sharp');
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DIRECTIONS = { A, B, C };

function gridsOf(dir) {
  const out = [['body', dir.layers.body], ['glasses', dir.layers.glasses], ['beard', dir.layers.beard]];
  for (const [k, v] of Object.entries(dir.layers.hair)) {
    if (!v) continue;
    if (Array.isArray(v)) out.push([`hair.${k}`, v]);
    else { if (v.back) out.push([`hair.${k}.back`, v.back]); if (v.front) out.push([`hair.${k}.front`, v.front]); }
  }
  return out;
}

export function validate(dir, key) {
  const known = new Set(['.', '_', ...Object.keys(buildSlots(COLOURWAYS[0].colours))]);
  const errs = [];
  for (const [name, g] of gridsOf(dir)) {
    if (!g) continue;
    if (g.length !== dir.size) errs.push(`${key}.${name}: ${g.length} rows (want ${dir.size})`);
    g.forEach((row, y) => {
      if (row.length !== dir.size) errs.push(`${key}.${name} row ${y}: len ${row.length}`);
      for (const ch of row) if (!known.has(ch)) errs.push(`${key}.${name} row ${y}: unknown slot '${ch}'`);
    });
  }
  return errs;
}

function stackFor(dir, look) {
  const hair = dir.layers.hair[look.hair] ?? null;
  const back = hair && !Array.isArray(hair) ? hair.back : null;
  const front = hair ? (Array.isArray(hair) ? hair : hair.front) : null;
  return [back, dir.layers.body, look.beard ? dir.layers.beard : null, front, look.glasses ? dir.layers.glasses : null].filter(Boolean);
}

/** Composite a look into a size*size RGBA buffer. */
export function compose(dir, look) {
  const n = dir.size;
  const slots = Object.fromEntries(Object.entries(buildSlots(look.colours)).map(([k, v]) => [k, hexToRgba(v)]));
  const px = new Float64Array(n * n * 4);
  for (const grid of stackFor(dir, look)) {
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      const i = (y * n + x) * 4;
      if (ch === '_') { px.fill(0, i, i + 4); continue; }
      const [r, g, b, a8] = slots[ch];
      const a = a8 / 255, da = px[i + 3] / 255, oa = a + da * (1 - a);
      if (oa === 0) continue;
      px[i] = (r * a + px[i] * da * (1 - a)) / oa;
      px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa;
      px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa;
      px[i + 3] = oa * 255;
    }
  }
  return Buffer.from(Uint8ClampedArray.from(px));
}

export async function spritePng(dir, look, scale) {
  return sharp(compose(dir, look), { raw: { width: dir.size, height: dir.size, channels: 4 } })
    .resize(dir.size * scale, dir.size * scale, { kernel: 'nearest' })
    .png().toBuffer();
}

const LIGHT = '#eef0f4', DARK = '#23252b';
const svgText = (w, h, items) => Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${items.map(({ x, y, text, size = 20, fill = '#1d1f24', weight = 700, anchor = 'middle' }) =>
    `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${text}</text>`).join('')}</svg>`);

async function compare() {
  const cols = [
    ['A', 'A — Detailed', '48×48 · 4×'],
    ['B', 'B — Chibi small', '32×32 · 6×'],
    ['C', 'C — Chibi large', '48×48 · 4×'],
  ];
  const cellW = 260, cellH = 216, head = 74, w = cellW * 3, h = head + cellH * COLOURWAYS.length;
  const comps = [];
  for (let r = 0; r < COLOURWAYS.length; r++) {
    comps.push({ input: { create: { width: w, height: cellH, channels: 4, background: r % 2 ? DARK : LIGHT } }, left: 0, top: head + r * cellH });
  }
  for (let c = 0; c < 3; c++) {
    const dir = DIRECTIONS[cols[c][0]];
    const scale = Math.round(196 / dir.size);
    const sz = dir.size * scale;
    for (let r = 0; r < COLOURWAYS.length; r++) {
      comps.push({ input: await spritePng(dir, COLOURWAYS[r], scale), left: c * cellW + Math.round((cellW - sz) / 2), top: head + r * cellH + Math.round((cellH - sz) / 2) });
    }
  }
  comps.push({
    input: svgText(w, h, cols.flatMap(([, t, sub], c) => [
      { x: c * cellW + cellW / 2, y: 34, text: t, size: 22 },
      { x: c * cellW + cellW / 2, y: 58, text: sub, size: 14, weight: 400, fill: '#5b606b' },
    ])), left: 0, top: 0,
  });
  await sharp({ create: { width: w, height: h, channels: 4, background: '#ffffff' } }).composite(comps).png().toFile(path.join(HERE, 'compare.png'));
}

// Review sheet: every hair style (+ glasses / beard variants) on light & dark, plus 1x/2x/3x previews.
async function sheet(key) {
  const dir = DIRECTIONS[key];
  const scale = Math.round(144 / dir.size);
  const sz = dir.size * scale, pad = 10;
  const styles = Object.keys(dir.layers.hair);
  const looks = styles.map((hs, i) => ({ ...COLOURWAYS[i % COLOURWAYS.length], hair: hs, glasses: false, beard: false }));
  looks.push({ ...COLOURWAYS[2], hair: 'short', glasses: true, beard: true });
  looks.push({ ...COLOURWAYS[0], hair: 'bun' in dir.layers.hair ? 'bun' : 'ponytail', colours: { ...COLOURWAYS[1].colours, hair: '#b0442a' } });
  const W = looks.length * (sz + pad) + pad, H = 2 * (sz + pad) + pad + 26 + dir.size * 3 + pad;
  const comps = [
    { input: { create: { width: W, height: sz + pad * 2, channels: 4, background: LIGHT } }, left: 0, top: 26 },
    { input: { create: { width: W, height: sz + pad, channels: 4, background: DARK } }, left: 0, top: 26 + sz + pad * 2 },
  ];
  for (let i = 0; i < looks.length; i++) {
    const png = await spritePng(dir, looks[i], scale);
    comps.push({ input: png, left: pad + i * (sz + pad), top: 26 + pad });
    comps.push({ input: png, left: pad + i * (sz + pad), top: 26 + sz + pad * 2 });
  }
  let x = pad;
  for (const s of [1, 2, 3]) for (const bg of [LIGHT, DARK]) {
    comps.push({ input: { create: { width: dir.size * s + 8, height: dir.size * 3 + 8, channels: 4, background: bg } }, left: x, top: H - dir.size * 3 - 8 - pad / 2 });
    comps.push({ input: await spritePng(dir, looks[0], s), left: x + 4, top: H - dir.size * s - 4 - pad / 2 });
    x += dir.size * s + 12;
  }
  comps.push({ input: svgText(W, 26, looks.map((l, i) => ({ x: pad + i * (sz + pad) + sz / 2, y: 18, text: l.hair + (l.glasses ? '+g' : '') + (l.beard ? '+b' : ''), size: 13, weight: 400 }))), left: 0, top: 0 });
  await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } }).composite(comps).png().toFile(path.join(HERE, `sheet_${key}.png`));
}

const MAIN = process.argv[1]?.endsWith("render.mjs");
const errs = Object.entries(DIRECTIONS).flatMap(([k, d]) => validate(d, k));
if (MAIN && errs.length) { console.error(errs.slice(0, 40).join('\n')); process.exit(1); }
if (MAIN && process.argv[2] !== "check") {
  const only = process.argv[2];
  for (const k of Object.keys(DIRECTIONS)) if (!only || only === k) await sheet(k);
  if (!only) await compare();
  console.log('ok');
}
