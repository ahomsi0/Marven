// Authoring helper (not needed at runtime): fills '#' cells of a mask with a
// curl texture, outlines the mask edge with 'k', lights from top-left.
// node tex.mjs mask.txt [cx cy]
import fs from 'node:fs';
const [, , file, cxs, cys] = process.argv;
const g = fs.readFileSync(file, 'utf8').split('\n').filter((r) => r.length);
const H = g.length, W = g[0].length;
const filled = (x, y) => y >= 0 && y < H && x >= 0 && x < W && g[y][x] !== '.';
let xs = [], ys = [];
g.forEach((r, y) => [...r].forEach((c, x) => { if (c !== '.') { xs.push(x); ys.push(y); } }));
const cx = cxs ? +cxs : (Math.min(...xs) + Math.max(...xs)) / 2, cy = cys ? +cys : Math.min(...ys) + 3;
const levels = ['k', 'j', 'h', 'H'];
const out = g.map((r, y) => [...r].map((c, x) => {
  if (c !== '#') return c;
  const edge = !filled(x - 1, y) || !filled(x + 1, y) || !filled(x, y - 1) || !filled(x, y + 1);
  if (edge) return 'k';
  const u = (x + 2 * Math.floor(y / 2)) % 4, v = y % 2;
  let lv = [[2, 3, 2, 2], [1, 2, 2, 2]][v][u];
  const light = ((cx - x) * 0.6 + (cy - y) * 0.8) / 9; // + toward top-left
  lv = Math.max(0, Math.min(3, Math.round(lv + light - 0.2)));
  return levels[lv];
}).join(''));
console.log(out.map((r) => `  '${r}',`).join('\n'));
