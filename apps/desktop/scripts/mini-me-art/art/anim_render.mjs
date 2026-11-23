// Mini Me — animation compositor + review renders.
//
//   node anim_render.mjs            -> anim_sheet_{A,B,C}.png, anim_preview_{A,B,C}.gif
//   node anim_render.mjs B          -> just direction B
//
// composeFrame() is the reference implementation of the layer order the app
// should follow (see the header of animX.mjs).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildSlots, hexToRgba, COLOURWAYS } from './palette.mjs';

const sharp = createRequire(import.meta.url)('sharp');
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ANIMS = {
  A: (await import('./animA.mjs').catch(() => ({ default: null }))).default,
  B: (await import('./animB.mjs').catch(() => ({ default: null }))).default,
  C: (await import('./animC.mjs').catch(() => ({ default: null }))).default,
};

/** look = { hair, glasses, beard, colours }  ->  RGBA Buffer (size*size*4) */
export function composeFrame(anim, look, state, index) {
  const n = anim.size;
  const fr = anim.frames[state][index];
  const slots = Object.fromEntries(Object.entries(buildSlots(look.colours)).map(([k, v]) => [k, hexToRgba(v)]));
  const hair = anim.hair[look.hair] ?? null;
  const { dx, dy } = fr.head;
  const stack = [
    [hair?.back, dx, dy],
    [fr.body, 0, 0],
    [look.beard ? anim.beard : null, dx, dy],
    [hair?.front, dx, dy],
    [look.glasses ? anim.glasses : null, dx, dy],
    [fr.front, 0, 0],
    [fr.effect, 0, 0],
  ];
  const px = new Float64Array(n * n * 4);
  for (const [grid, ox, oy] of stack) {
    if (!grid) continue;
    for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
      const ch = grid[gy][gx];
      if (ch === '.') continue;
      const x = gx + ox, y = gy + oy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const i = (y * n + x) * 4;
      if (ch === '_') { px.fill(0, i, i + 4); continue; }
      const [r, g, b, a8] = slots[ch];
      const a = a8 / 255, da = px[i + 3] / 255, oa = a + da * (1 - a);
      px[i] = (r * a + px[i] * da * (1 - a)) / oa;
      px[i + 1] = (g * a + px[i + 1] * da * (1 - a)) / oa;
      px[i + 2] = (b * a + px[i + 2] * da * (1 - a)) / oa;
      px[i + 3] = oa * 255;
    }
  }
  return Buffer.from(Uint8ClampedArray.from(px));
}

export async function framePng(anim, look, state, i, scale) {
  return sharp(composeFrame(anim, look, state, i), { raw: { width: anim.size, height: anim.size, channels: 4 } })
    .resize(anim.size * scale, anim.size * scale, { kernel: 'nearest' }).png().toBuffer();
}

const LIGHT = '#eef0f4', DARK = '#23252b';
const svg = (w, h, items) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${items.map(({ x, y, t, size = 15, fill = '#1d1f24', anchor = 'start', weight = 600 }) =>
  `<text x="${x}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${t}</text>`).join('')}</svg>`);

export const LOOK_PLAIN = { ...COLOURWAYS[0] };                    // short hair, no glasses/beard
export const LOOK_GB = { ...COLOURWAYS[2] };                       // curly + glasses + beard

// One row per state: frames for the plain look on light, then the glasses+beard look on dark.
async function sheet(key) {
  const anim = ANIMS[key];
  const scale = anim.size === 32 ? 4 : 3, sz = anim.size * scale, gap = 6, label = 170;
  const states = Object.keys(anim.frames);
  const maxF = Math.max(...states.map((s) => anim.frames[s].length));
  const half = maxF * (sz + gap) + gap;
  const W = label + half * 2, rowH = sz + 2 * gap, H = 34 + states.length * rowH;
  const comps = [
    { input: { create: { width: half, height: H - 34, channels: 4, background: LIGHT } }, left: label, top: 34 },
    { input: { create: { width: half, height: H - 34, channels: 4, background: DARK } }, left: label + half, top: 34 },
  ];
  const text = [
    { x: 12, y: 22, t: anim.name, size: 15, weight: 700 },
    { x: label + gap, y: 22, t: 'short hair, plain', size: 13, weight: 400, fill: '#5b606b' },
    { x: label + half + gap, y: 22, t: 'curly + glasses + beard', size: 13, weight: 400, fill: '#5b606b' },
  ];
  for (let r = 0; r < states.length; r++) {
    const s = states[r], fr = anim.frames[s], t = anim.timing[s];
    text.push({ x: 12, y: 34 + r * rowH + rowH / 2, t: s, size: 15 });
    text.push({ x: 12, y: 34 + r * rowH + rowH / 2 + 17, t: `${fr.length}f ${t.fps}fps ${t.loop ? 'loop' : 'once'}`, size: 11, weight: 400, fill: '#5b606b' });
    for (let i = 0; i < fr.length; i++) {
      const top = 34 + r * rowH + gap;
      comps.push({ input: await framePng(anim, LOOK_PLAIN, s, i, scale), left: label + gap + i * (sz + gap), top });
      comps.push({ input: await framePng(anim, LOOK_GB, s, i, scale), left: label + half + gap + i * (sz + gap), top });
    }
  }
  comps.push({ input: svg(W, H, text), left: 0, top: 0 });
  await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } }).composite(comps).png().toFile(path.join(HERE, `anim_sheet_${key}.png`));
}

// Animated GIF: idle / walk / talk / happy side by side at 4x, each at its own fps,
// sampled on a 25 fps timeline (40 ms per GIF frame) for 4 seconds.
async function preview(key) {
  const anim = ANIMS[key];
  const states = ['idle', 'walk', 'talk', 'happy'];
  const looks = [LOOK_PLAIN, { ...COLOURWAYS[1] }, LOOK_GB, { ...COLOURWAYS[3] }];
  const scale = 4, sz = anim.size * scale, gap = 8;
  const W = states.length * (sz + gap) + gap, H = sz + 2 * gap;
  const cache = new Map();
  const get = async (s, i, li) => {
    const k = `${s}/${i}/${li}`;
    if (!cache.has(k)) cache.set(k, await sharp(composeFrame(anim, looks[li], s, i), { raw: { width: anim.size, height: anim.size, channels: 4 } }).resize(sz, sz, { kernel: 'nearest' }).raw().toBuffer());
    return cache.get(k);
  };
  const tickMs = 40, total = 100; // 4 s
  const pages = [];
  for (let t = 0; t < total; t++) {
    const comps = [];
    for (let c = 0; c < states.length; c++) {
      const s = states[c], n = anim.frames[s].length, fps = anim.timing[s].fps;
      const i = Math.floor((t * tickMs) / (1000 / fps)) % n;
      comps.push({ input: await get(s, i, c), raw: { width: sz, height: sz, channels: 4 }, left: gap + c * (sz + gap), top: gap });
    }
    pages.push(await sharp({ create: { width: W, height: H, channels: 4, background: LIGHT } }).composite(comps).raw().toBuffer());
  }
  const strip = Buffer.concat(pages);
  await sharp(strip, { raw: { width: W, height: H * total, channels: 4, pageHeight: H } })
    .gif({ delay: Array(total).fill(tickMs), loop: 0, effort: 7 })
    .toFile(path.join(HERE, `anim_preview_${key}.gif`));
}

if (process.argv[1]?.endsWith('anim_render.mjs')) {
  const only = process.argv[2];
  for (const k of Object.keys(ANIMS)) {
    if ((only && only !== k) || !ANIMS[k]) continue;
    await sheet(k);
    if (process.argv[3] !== 'nogif') await preview(k);
    console.log('rendered', k);
  }
}
