// Overlay alignment check: every hair style x (glasses+beard) over representative
// frames of every head offset / arm pose.  node build/ocheck.mjs C [scale] -> ocheck.png
import { createRequire } from 'node:module';
import { ANIMS, framePng } from '../art/anim_render.mjs';
import { COLOURWAYS } from '../art/palette.mjs';
const sharp = createRequire(import.meta.url)('sharp');
const [, , key, sc = '3', all] = process.argv;
const anim = ANIMS[key];
const scale = +sc, sz = anim.size * scale, gap = 2;
let picks = [['idle', 1], ['walk', 0], ['look', 1], ['look', 3], ['sit', 1], ['sleep', 1], ['listen', 1], ['think', 2], ['happy', 0], ['confused', 1], ['dangle', 0], ['stretch', 2]];
if (all) picks = Object.entries(anim.frames).flatMap(([s, f]) => f.map((_, i) => [s, i]));
const styles = Object.keys(anim.hair);
const comps = [];
for (let r = 0; r < styles.length; r++) for (let c = 0; c < picks.length; c++) {
  const look = { ...COLOURWAYS[r % 4], hair: styles[r], glasses: true, beard: r % 2 === 0 };
  comps.push({ input: { create: { width: sz, height: sz, channels: 4, background: r % 2 ? '#23252b' : '#eef0f4' } }, left: c * (sz + gap), top: r * (sz + gap) });
  comps.push({ input: await framePng(anim, look, picks[c][0], picks[c][1], scale), left: c * (sz + gap), top: r * (sz + gap) });
}
await sharp({ create: { width: picks.length * (sz + gap), height: styles.length * (sz + gap), channels: 4, background: '#fff' } }).composite(comps).png().toFile(new URL('../ocheck.png', import.meta.url).pathname);
