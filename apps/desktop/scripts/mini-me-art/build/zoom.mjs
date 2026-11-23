// node zoom.mjs B 0,2,3 [hair]  -> zoom.png (colourways side by side, big scale, light bg)
import { createRequire } from 'node:module';
import { DIRECTIONS, spritePng } from '../art/render.mjs';
import { COLOURWAYS } from '../art/palette.mjs';
const sharp = createRequire(import.meta.url)('sharp');
const [, , key, idx = '0,1,2,3', hair] = process.argv;
const dir = DIRECTIONS[key];
const scale = Math.round(380 / dir.size), sz = dir.size * scale;
const list = idx.split(',').map(Number);
const comps = [];
for (let i = 0; i < list.length; i++) {
  const look = { ...COLOURWAYS[list[i]] };
  if (hair) Object.assign(look, JSON.parse(hair));
  comps.push({ input: { create: { width: sz, height: sz, channels: 4, background: i % 2 ? '#23252b' : '#eef0f4' } }, left: i * sz, top: 0 });
  comps.push({ input: await spritePng(dir, look, scale), left: i * sz, top: 0 });
}
await sharp({ create: { width: sz * list.length, height: sz, channels: 4, background: '#fff' } }).composite(comps).png().toFile('zoom.png');
