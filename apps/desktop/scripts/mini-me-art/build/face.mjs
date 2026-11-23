// node face.mjs A 0,1 x0 y0 w h  -> face.png crop at 14x
import { createRequire } from 'node:module';
import { DIRECTIONS, compose } from '../art/render.mjs';
import { COLOURWAYS } from '../art/palette.mjs';
const sharp = createRequire(import.meta.url)('sharp');
const [, , key, idx, x0 = 10, y0 = 0, w = 28, h = 26] = process.argv;
const dir = DIRECTIONS[key], S = 14;
const list = idx.split(',').map(Number);
const comps = [];
for (let i = 0; i < list.length; i++) {
  const buf = await sharp(compose(dir, COLOURWAYS[list[i]]), { raw: { width: dir.size, height: dir.size, channels: 4 } })
    .extract({ left: +x0, top: +y0, width: +w, height: +h }).resize(w * S, h * S, { kernel: 'nearest' }).png().toBuffer();
  comps.push({ input: { create: { width: w * S, height: h * S, channels: 4, background: '#eef0f4' } }, left: i * (w * S + 10), top: 0 });
  comps.push({ input: buf, left: i * (w * S + 10), top: 0 });
}
await sharp({ create: { width: list.length * (w * S + 10), height: h * S, channels: 4, background: '#fff' } }).composite(comps).png().toFile('face.png');
