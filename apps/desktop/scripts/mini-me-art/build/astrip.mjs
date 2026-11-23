// Review helper: node build/astrip.mjs C state1,state2 [lookIdx] [scale] [hair] [g] [b] -> scripts/mini-me-art/astrip.png
import { createRequire } from 'node:module';
import { ANIMS, framePng } from '../art/anim_render.mjs';
import { COLOURWAYS } from '../art/palette.mjs';
const sharp = createRequire(import.meta.url)('sharp');
const [, , key, states, li = '0', sc, hair, g, b] = process.argv;
const anim = ANIMS[key];
const scale = +(sc ?? (anim.size === 32 ? 7 : 5)), sz = anim.size * scale, gap = 4;
const look = { ...COLOURWAYS[+li] };
if (hair) look.hair = hair;
if (g) look.glasses = g === '1';
if (b) look.beard = b === '1';
const list = states.split(',');
const maxF = Math.max(...list.map((s) => anim.frames[s].length));
const comps = [];
for (let r = 0; r < list.length; r++) for (let i = 0; i < anim.frames[list[r]].length; i++) {
  comps.push({ input: { create: { width: sz, height: sz, channels: 4, background: (i + r) % 2 ? '#e2e5eb' : '#eef0f4' } }, left: i * (sz + gap), top: r * (sz + gap) });
  comps.push({ input: await framePng(anim, look, list[r], i, scale), left: i * (sz + gap), top: r * (sz + gap) });
}
await sharp({ create: { width: maxF * (sz + gap), height: list.length * (sz + gap), channels: 4, background: '#fff' } }).composite(comps).png().toFile(new URL('../astrip.png', import.meta.url).pathname);
