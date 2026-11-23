// Build-time frame generator (NOT needed by the app).
// Reads the idle art (art/directionX.mjs), applies per-direction pose / face
// edits described in build/poses.mjs, and emits art/animX.mjs containing only
// plain final grids.
//
//   node build/anim.mjs [A|B|C]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, STATES } from './poses.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.resolve(HERE, '../art');

// ---------- grid helpers (grids are arrays of char arrays) ----------
const M = (rows) => rows.map((r) => [...r]);
const STR = (m) => m.map((r) => r.join(''));
const blank = (n) => Array.from({ length: n }, () => Array(n).fill('.'));
const clone = (m) => m.map((r) => r.slice());
const isFill = (c) => c !== '.' && c !== 'o';

function shiftRows(rows, k) { // move a whole layer down by k rows
  const n = rows.length;
  return [...Array(k).fill('.'.repeat(n)), ...rows.slice(0, n - k)];
}

// Close every exposed fill edge with an outline pixel (4-neighbour).
function closeOutline(g) {
  const n = g.length, add = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (g[y][x] !== '.') continue;
    const nb = [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([dy, dx]) => isFill(g[y + dy]?.[x + dx] ?? '.'));
    if (nb) add.push([y, x]);
  }
  for (const [y, x] of add) g[y][x] = 'o';
  return g;
}

// ---------- parts (material spans -> shaded, outlined cells) ----------
const MAT = { b: ['B', 'b', 'n'], s: ['S', 's', 't'], p: ['P', 'p', 'q'], f: ['F', 'f', 'v'], w: ['Y', 'Y', 'y'], c: ['n', 'n', 'n'] };

function mirrorSpans(spans, n) {
  return spans.map(([y, x, s]) => [y, n - x - s.length, [...s].reverse().join('')]);
}

/** spans: [[row, col, 'mat string'], ...]  ->  Map "y,x" -> code (fill + outline) */
function buildPart(spans, n, { outline = true, side = 'R' } = {}) {
  const fill = new Map();
  for (const [y, x, s] of spans) [...s].forEach((m, i) => { if (m !== ' ') fill.set(`${y},${x + i}`, m); });
  const out = new Map();
  const rows = new Map();
  for (const k of fill.keys()) { const [y, x] = k.split(',').map(Number); if (!rows.has(y)) rows.set(y, []); rows.get(y).push(x); }
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    let i = 0;
    while (i < xs.length) { // runs of same material, contiguous
      let j = i;
      const m = fill.get(`${y},${xs[i]}`);
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1 && fill.get(`${y},${xs[j + 1]}`) === m) j++;
      const len = j - i + 1, ramp = MAT[m];
      for (let k = 0; k < len; k++) {
        let c = m;
        if (ramp) {
          if (len === 1) c = ramp[1];
          else if (len === 2) c = k === 0 ? (side === 'L' ? ramp[0] : ramp[1]) : ramp[2];
          else c = k === 0 ? ramp[0] : k === len - 1 ? ramp[2] : ramp[1];
        }
        out.set(`${y},${xs[i + k]}`, c);
      }
      i = j + 1;
    }
  }
  if (outline) {
    for (const k of fill.keys()) {
      const [y, x] = k.split(',').map(Number);
      for (const [dy, dx] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const kk = `${y + dy},${x + dx}`;
        if (!fill.has(kk) && y + dy >= 0 && y + dy < n && x + dx >= 0 && x + dx < n) out.set(kk, 'o');
      }
    }
  }
  return out;
}

function paste(g, part, dx = 0, dy = 0) {
  for (const [k, c] of part) {
    const [y, x] = k.split(',').map(Number);
    const yy = y + dy, xx = x + dx;
    if (yy >= 0 && yy < g.length && xx >= 0 && xx < g.length) g[yy][xx] = c;
  }
}

// ---------- pose ops on a body grid ----------
function writeBox(g, x0, y0, rows) {
  rows.forEach((r, j) => [...r].forEach((c, i) => { g[y0 + j][x0 + i] = c; }));
}

function applyEyes(g, cfg, variant) {
  const E = cfg.eyes, v = E.variants[variant];
  if (!v) throw new Error(`${cfg.key}: no eye variant ${variant}`);
  const L = v.L ?? v, R = v.R ?? (E.rotate ? L.map((r) => r.slice(1) + r[0]) : L);
  writeBox(g, E.lx, E.y, L);
  writeBox(g, E.rx, E.y, R);
}

function applyMouth(g, cfg, variant) {
  const m = cfg.mouth, v = m.variants[variant];
  if (!v) throw new Error(`${cfg.key}: no mouth variant ${variant}`);
  writeBox(g, m.x, m.y, v);
}

function armRect(cfg, side) {
  const r = cfg.armR, n = cfg.size;
  return side === 'R' ? r : { ...r, x0: n - 1 - r.x1, x1: n - 1 - r.x0 };
}

function clearArm(g, cfg, side) {
  const r = armRect(cfg, side);
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) g[y][x] = '.';
}

function swingArm(g, cfg, side) {
  const r = armRect(cfg, side);
  for (let y = cfg.swingRow; y < r.y1; y++) for (let x = r.x0; x <= r.x1; x++) g[y][x] = g[y + 1][x];
  for (let x = r.x0; x <= r.x1; x++) g[r.y1][x] = '.';
}

function raiseLeg(g, cfg, side) {
  const n = cfg.size, half = n / 2;
  const [x0, x1] = side === 'L' ? [0, half - 1] : [half, n - 1];
  for (let y = cfg.legTop; y < n - 1; y++) for (let x = x0; x <= x1; x++) g[y][x] = g[y + 1][x];
  for (let x = x0; x <= x1; x++) g[n - 1][x] = '.';
}

function spreadLegs(g, cfg) {
  const n = cfg.size, half = n / 2;
  for (let y = cfg.legTop; y < n; y++) {
    for (let x = 0; x < half - 1; x++) g[y][x] = g[y][x + 1];
    g[y][half - 1] = '.';
    for (let x = n - 1; x > half; x--) g[y][x] = g[y][x - 1];
    g[y][half] = '.';
  }
}

function dropRow(g, r) { // everything above row r moves down 1 (row r is deleted)
  const n = g.length;
  g.splice(r, 1);
  g.unshift(Array(n).fill('.'));
}

function sitDown(g, cfg, D) {
  const n = cfg.size, out = blank(n);
  for (const side of ['L', 'R']) {
    const spans = side === 'R' ? cfg.sitLegs : mirrorSpans(cfg.sitLegs, n);
    paste(out, buildPart(spans, n, { side }));
  }
  const armCols = new Set();
  for (const side of ['L', 'R']) { const r = armRect(cfg, side); for (let x = r.x0; x <= r.x1; x++) armCols.add(x); }
  for (let y = 0; y <= cfg.handBottom; y++) for (let x = 0; x < n; x++) {
    if (y > cfg.hip && !armCols.has(x)) continue;
    if (g[y][x] !== '.' && y + D < n) out[y + D][x] = g[y][x];
  }
  return out;
}

function shiftHead(g, cfg, dx, dy) {
  if (!dx) return;
  const n = cfg.size;
  for (let y = 0; y <= cfg.chinRow + dy; y++) {
    const row = g[y].slice();
    for (let x = 0; x < n; x++) g[y][x] = row[x - dx] ?? '.';
  }
}

// ---------- frame builder ----------
function buildFrame(cfg, f) {
  let g = M(cfg.body);
  applyEyes(g, cfg, f.eyes ?? 'open');
  applyMouth(g, cfg, f.mouth ?? 'base');
  const arms = { L: f.armL ?? f.arms ?? 'down', R: f.armR ?? f.arms ?? 'down' };
  for (const side of ['L', 'R']) {
    if (arms[side] === 'swing') for (let i = 0; i < (cfg.swingN ?? 1); i++) swingArm(g, cfg, side);
    else if (arms[side] !== 'down') clearArm(g, cfg, side);
  }
  let dy = 0;
  const legs = f.legs ?? 'stand';
  if (legs === 'sit') { dy = cfg.sitD + (f.bob ?? 0); g = sitDown(g, cfg, dy); }
  else {
    if (f.spread) spreadLegs(g, cfg);
    if (legs === 'raiseL') raiseLeg(g, cfg, 'L');
    if (legs === 'raiseR') raiseLeg(g, cfg, 'R');
    if (f.bob) { dropRow(g, cfg.bobRow); dy = 1; }
  }
  const dx = f.dx ?? 0;
  shiftHead(g, cfg, dx, dy);
  closeOutline(g);
  // raised / bent arms: drawn into the body AND into the `front` layer so
  // hair, beard and glasses never cover them.
  let front = null;
  for (const side of ['L', 'R']) {
    const pose = arms[side];
    if (pose === 'down' || pose === 'swing') continue;
    const spans = cfg.arms[pose];
    if (!spans) throw new Error(`${cfg.key}: no arm pose ${pose}`);
    const part = buildPart(side === 'R' ? spans : mirrorSpans(spans, cfg.size), cfg.size, { side });
    paste(g, part, 0, dy);
    front ??= blank(cfg.size);
    paste(front, part, 0, dy);
  }
  let effect = null;
  for (const fx of f.fx ?? []) {
    const def = cfg.fx[fx];
    if (!def) throw new Error(`${cfg.key}: no fx ${fx}`);
    const glyph = cfg.glyphs[def.glyph];
    const spans = glyph.map((r, i) => [def.y + i, def.x, r.replace(/\./g, ' ')]);
    effect ??= blank(cfg.size);
    paste(effect, buildPart(spans, cfg.size), dx, dy);
  }
  const out = { body: STR(g), head: { dx, dy } };
  if (front) out.front = STR(front);
  if (effect) out.effect = STR(effect);
  return out;
}

// ---------- emit ----------
function loadBase(key) {
  return import(path.join(ART, `direction${key}.mjs`)).then((m) => m.default);
}

const fmt = (rows) => '[\n' + rows.map((r) => `      '${r}',`).join('\n') + '\n    ]';

async function emit(key) {
  const base = await loadBase(key);
  const cfg = CONFIG[key];
  const k = cfg.shiftDown ?? 0;
  const L = (rows) => (rows && k ? shiftRows(rows, k) : rows);
  cfg.key = key;
  cfg.size = base.size;
  cfg.body = L(base.layers.body);
  // sanity: outline closure must not change the idle art
  const chk = STR(closeOutline(M(cfg.body)));
  chk.forEach((r, y) => { if (r !== cfg.body[y]) console.warn(`${key}: closeOutline changes idle row ${y}`); });

  const hair = {};
  for (const [name, v] of Object.entries(base.layers.hair)) {
    if (!v) { hair[name] = null; continue; }
    hair[name] = Array.isArray(v) ? { front: L(v) } : { front: L(v.front), ...(v.back ? { back: L(v.back) } : {}) };
  }
  const frames = {};
  for (const [state, def] of Object.entries(STATES)) frames[state] = def.frames.map((f) => buildFrame(cfg, f));

  const timing = Object.fromEntries(Object.entries(STATES).map(([s, d]) => [s, { fps: d.fps, loop: d.loop }]));
  let src = `// Mini Me — ${base.name} — animation data (generated by build/anim.mjs; plain grids, no build step needed)
//
// Coordinates: every grid is ${base.size}x${base.size}, one char per pixel, '.' = transparent.
// Slot codes are resolved with palette.mjs buildSlots(look) (effects use the fixed Z / Q slots).
//
// Draw order per frame (layerOrder):
//   hairBack   hair[style].back   at (head.dx, head.dy)
//   body       frame.body          at (0, 0)       (face, arms, legs, clothes — everything)
//   beard      beard               at (head.dx, head.dy)   if enabled
//   hairFront  hair[style].front  at (head.dx, head.dy)
//   glasses    glasses            at (head.dx, head.dy)   if enabled
//   front      frame.front         at (0, 0)       (optional) raised/bent arms re-drawn on top so
//                                                  hair, beard and glasses never hide a hand
//   effect     frame.effect        at (0, 0)       (optional) zzz, thought dots, ?, sparkles
// Overlays (hair/beard/glasses) are authored for the idle head position; head.{dx,dy}
// is how far the head has moved in this frame (breathing bob, sitting, look-turn).
// bald = null (no hair layer). timing[state] = { fps, loop } (loop:false = play once).
export default {
  name: ${JSON.stringify(base.name)},
  size: ${base.size},
  layerOrder: ['hairBack', 'body', 'beard', 'hairFront', 'glasses', 'front', 'effect'],
  timing: ${JSON.stringify(timing)},
  hair: {
`;
  for (const [name, v] of Object.entries(hair)) {
    if (!v) { src += `    ${name}: null,\n`; continue; }
    src += `    ${name}: {\n      front: ${fmt(v.front).replace(/\n/g, '\n  ')},\n`;
    if (v.back) src += `      back: ${fmt(v.back).replace(/\n/g, '\n  ')},\n`;
    src += '    },\n';
  }
  src += '  },\n';
  src += `  beard: ${fmt(L(base.layers.beard))},\n`;
  src += `  glasses: ${fmt(L(base.layers.glasses))},\n`;
  src += '  frames: {\n';
  for (const [state, fr] of Object.entries(frames)) {
    src += `    ${state}: [\n`;
    for (const f of fr) {
      src += `      { // ${state}\n        head: { dx: ${f.head.dx}, dy: ${f.head.dy} },\n`;
      for (const k2 of ['body', 'front', 'effect']) if (f[k2]) src += `        ${k2}: ${fmt(f[k2]).replace(/\n/g, '\n    ')},\n`;
      src += '      },\n';
    }
    src += '    ],\n';
  }
  src += '  },\n};\n';
  fs.writeFileSync(path.join(ART, `anim${key}.mjs`), src);
  console.log(`anim${key}.mjs`, Object.values(frames).reduce((a, b) => a + b.length, 0), 'frames');
}

const only = process.argv[2];
for (const key of Object.keys(CONFIG)) if (!only || only === key) await emit(key);
