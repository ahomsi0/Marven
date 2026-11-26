// Pose / face / effect definitions used by build/anim.mjs.
// Arms are authored for the SCREEN-RIGHT side as material spans
// [row, col, 'mats'] (b sleeve, c cuff, s skin) and mirrored for the left;
// shading (light on the left, shadow on the right of each run) and the 1-px
// outline are added automatically. Coordinates are in idle-frame space.

// ---------- shared state list (frame recipes) ----------
const up = { arms: 'up' };
export const STATES = {
  idle: { fps: 4, loop: true, frames: [{}, { bob: 1 }, {}, { bob: 1 }, {}, { eyes: 'closed' }] },
  walk: {
    fps: 8, loop: true, frames: [
      { legs: 'raiseL', armR: 'swing' },
      { bob: 1 },
      { legs: 'raiseR', armL: 'swing' },
      { bob: 1 },
    ],
  },
  look: { fps: 2, loop: true, frames: [{ eyes: 'left' }, { eyes: 'left', dx: -1 }, { eyes: 'right' }, { eyes: 'right', dx: 1 }] },
  sit: { fps: 2, loop: true, frames: [{ legs: 'sit' }, { legs: 'sit', bob: 1 }] },
  stretch: { fps: 4, loop: false, frames: [{ ...up }, { ...up, mouth: 'o' }, { ...up, eyes: 'closed', mouth: 'o' }, {}] },
  sleep: {
    fps: 1.5, loop: true, frames: [
      { legs: 'sit', eyes: 'closed', mouth: 'closed', fx: ['z1'] },
      { legs: 'sit', bob: 1, eyes: 'closed', mouth: 'closed', fx: ['z1', 'z2'] },
    ],
  },
  listen: { fps: 2, loop: true, frames: [{ armR: 'ear', eyes: 'right' }, { armR: 'ear', eyes: 'right', bob: 1 }] },
  // Thinking: he looks up and a thought cloud fills with dots (his face stays clear).
  think: {
    fps: 3, loop: true, frames: [
      { eyes: 'upright', mouth: 'closed', fx: ['t1', 'c0'] },
      { eyes: 'upright', mouth: 'closed', fx: ['t1', 't2', 'c1'] },
      { eyes: 'upright', mouth: 'closed', fx: ['t1', 't2', 'c2'], bob: 1 },
      { eyes: 'upright', mouth: 'closed', fx: ['t1', 't2', 'c3'], bob: 1 },
      { eyes: 'upright', mouth: 'closed', fx: ['t1', 't2', 'c3'] },
    ],
  },
  // Building or changing a project: he rolls gold paint up a canvas beside him,
  // then white paint back down, so the loop ends where it started.
  paint: {
    fps: 5, loop: true, frames: [
      { armR: 'paintLow', eyes: 'right', mouth: 'closed', fx: ['gripLow', 'rollLow'] },
      { armR: 'paintMid', eyes: 'right', mouth: 'closed', fx: ['gripMid', 'rollMid', 'fl4', 'fl5'] },
      { armR: 'paintHigh', eyes: 'upright', mouth: 'o', fx: ['gripHigh', 'rollHigh', 'fl1', 'fl2', 'fl6'] },
      { armR: 'paintHigh', eyes: 'happy', mouth: 'big', fx: ['gripHigh', 'rollHigh', 'fl3', 'shine'] },
      { armR: 'paintMid', eyes: 'right', mouth: 'closed', fx: ['gripMid', 'rollMid', 'fl4', 'fl6'] },
      { armR: 'paintLow', eyes: 'right', mouth: 'closed', fx: ['gripLow', 'rollLow', 'fl2', 'fl6'] },
    ],
  },
  talk: { fps: 8, loop: true, frames: [{ mouth: 'open' }, { mouth: 'closed' }, { mouth: 'o' }, { mouth: 'closed' }] },
  happy: {
    fps: 6, loop: false, frames: [
      { ...up, eyes: 'happy', mouth: 'big', fx: ['s1', 's2', 's3'] },
      { eyes: 'happy', mouth: 'big', bob: 1 },
      { ...up, eyes: 'happy', mouth: 'big', fx: ['s4', 's5', 's6'] },
      { eyes: 'happy', mouth: 'big', bob: 1 },
    ],
  },
  confused: {
    fps: 3, loop: false, frames: [
      { arms: 'shrug', mouth: 'wavy', fx: ['q'] },
      { arms: 'shrug', mouth: 'wavy', fx: ['q'], bob: 1 },
      { arms: 'shrug', mouth: 'wavy', eyes: 'left', fx: ['q'] },
      { arms: 'shrug', mouth: 'wavy', eyes: 'left', fx: ['q'], bob: 1 },
    ],
  },
  dangle: {
    fps: 3, loop: true, frames: [
      { ...up, mouth: 'o', spread: true, legs: 'raiseL' },
      { ...up, mouth: 'o', spread: true, legs: 'raiseR' },
    ],
  },
};

// ---------- glyphs for effects (Z = white-ish, Q = gold; outline added) ----------
const GLYPHS_BIG = {
  z: ['ZZZ', '..Z', '.Z.', 'ZZZ'],
  Z: ['ZZZZ', '..Z.', '.Z..', 'ZZZZ'],
  dot1: ['ZZ', 'ZZ'],
  dot2: ['.Z.', 'ZZZ', '.Z.'],
  dot3: ['.ZZ.', 'ZZZZ', 'ZZZZ', '.ZZ.'],
  q: ['.QQQ.', 'QQ.QQ', '...QQ', '..QQ.', '..Q..', '.....', '..Q..'],
  star: ['..Q..', '..Q..', 'QQZQQ', '..Q..', '..Q..'],
  star3: ['.Q.', 'QZQ', '.Q.'],
  spark: ['Q'],
};
const GLYPHS_SMALL = {
  z: ['ZZZ', '..Z', '.Z.', 'ZZZ'],
  Z: ['ZZZ', '..Z', '.Z.', 'ZZZ'],
  dot1: ['Z'],
  dot2: ['ZZ', 'ZZ'],
  dot3: ['.Z.', 'ZZZ', '.Z.'],
  q: ['QQQ', '..Q', '.Q.', '...', '.Q.'],
  star: ['.Q.', 'QZQ', '.Q.'],
  star3: ['.Q.', 'QZQ', '.Q.'],
  spark: ['Q'],
};

// ---------- thought cloud (C and A use the big one, B the small one) ----------
const CLOUD_BIG = {
  cloud0: ['...ZZZ.ZZ..', '.ZZZZZZZZZ.', 'ZZZZZZZZZZZ', 'ZZZZZZZZZZZ', 'ZZZZZZZZZZZ', '.ZZZZZZZZZ.', '..ZZZ.ZZZ..'],
  cloud1: ['...ZZZ.ZZ..', '.ZZZZZZZZZ.', 'ZZZZZZZZZZZ', 'ZZoZZZZZZZZ', 'ZZZZZZZZZZZ', '.ZZZZZZZZZ.', '..ZZZ.ZZZ..'],
  cloud2: ['...ZZZ.ZZ..', '.ZZZZZZZZZ.', 'ZZZZZZZZZZZ', 'ZZoZZoZZZZZ', 'ZZZZZZZZZZZ', '.ZZZZZZZZZ.', '..ZZZ.ZZZ..'],
  cloud3: ['...ZZZ.ZZ..', '.ZZZZZZZZZ.', 'ZZZZZZZZZZZ', 'ZZoZZoZZoZZ', 'ZZZZZZZZZZZ', '.ZZZZZZZZZ.', '..ZZZ.ZZZ..'],
  dot0: ['Z'],
};
const CLOUD_SMALL = {
  cloud0: ['..ZZ.Z..', '.ZZZZZZ.', 'ZZZZZZZZ', 'ZZZZZZZZ', '.ZZ.ZZZ.'],
  cloud1: ['..ZZ.Z..', '.ZZZZZZ.', 'ZoZZZZZZ', 'ZZZZZZZZ', '.ZZ.ZZZ.'],
  cloud2: ['..ZZ.Z..', '.ZZZZZZ.', 'ZoZoZZZZ', 'ZZZZZZZZ', '.ZZ.ZZZ.'],
  cloud3: ['..ZZ.Z..', '.ZZZZZZ.', 'ZoZoZoZZ', 'ZZZZZZZZ', '.ZZ.ZZZ.'],
  dot0: ['Z'],
};

/**
 * The paint roller he swipes up and down while building, paint flicking off
 * it. Per style: `roller` (the head, w × h, in gold), the head's spot and the
 * handle pixels for each arm height (`low` / `mid` / `high`: { x, y, grip:
 * [[x, y], ...] }), paint flicks (`flicks`: name -> { x, y, big }) and the
 * sparkle at the top (`shine`).
 */
function paintRoller({ roller, low, mid, high, flicks, shine, smallFlicks }) {
  const glyphs = {
    rollerHead: Array.from({ length: roller.h }, () => 'Q'.repeat(roller.w)),
    flickBig: smallFlicks ? ['Q'] : ['QQ', 'QQ'],
    flickSmall: ['Q'],
  };
  const fx = { shine: { glyph: 'star3', x: shine.x, y: shine.y } };
  for (const [name, pos] of [['Low', low], ['Mid', mid], ['High', high]]) {
    fx[`roll${name}`] = { glyph: 'rollerHead', x: pos.x, y: pos.y };
    const xs = pos.grip.map(([x]) => x), ys = pos.grip.map(([, y]) => y);
    const gx = Math.min(...xs), gy = Math.min(...ys);
    const grid = Array.from({ length: Math.max(...ys) - gy + 1 }, () => Array(Math.max(...xs) - gx + 1).fill('.'));
    for (const [x, y] of pos.grip) grid[y - gy][x - gx] = 'p';
    glyphs[`grip${name}`] = grid.map((r) => r.join(''));
    fx[`grip${name}`] = { glyph: `grip${name}`, x: gx, y: gy };
  }
  for (const [name, f] of Object.entries(flicks)) fx[name] = { glyph: f.big ? 'flickBig' : 'flickSmall', x: f.x, y: f.y };
  return { glyphs, fx };
}

// ---------- C — Chibi large (48) ----------
const C = {
  chinRow: 24, legTop: 38, bobRow: 40, hip: 37, handBottom: 36, sitD: 5,
  armR: { x0: 31, x1: 34, y0: 28, y1: 36 }, swingRow: 33, swingN: 2,
  sitLegs: [[43, 24, 'pppppp'], [44, 26, 'ffffff'], [45, 26, 'fwwwwf'], [46, 27, 'wwww']],
  eyes: {
    y: 14, lx: 15, rx: 28, rotate: true, // 5-wide box incl. the outer lash flick (col 0 of the left eye)
    variants: {
      open: ['ooooo', 'oeLLe', 'seLeE', 'sEeeE', 'sEIIE'],
      closed: ['sssss', 'sssss', 'ossss', 'soooo', 'sssss'],
      happy: ['sssss', 'sssss', 'ssoos', 'sosso', 'sssss'],
      left: ['ooooo', 'oeLeW', 'sLeEW', 'sEeEW', 'sEIEW'],
      right: { L: ['ooooo', 'oWeLe', 'sWLeE', 'sWEeE', 'sWEIE'], R: ['ooooo', 'WeLeo', 'WLeEs', 'WEeEs', 'WEIEs'] },
      upright: { L: ['ooooo', 'oWLee', 'sWeeE', 'sWEIE', 'sWWWs'], R: ['ooooo', 'WLeeo', 'WeeEs', 'WEIEs', 'WWWss'] },
    },
  },
  mouth: {
    x: 21, y: 20,
    variants: {
      base: ['sMssMs', 'ssMMss', 'ssssss'],
      closed: ['ssssss', 'ssMMss', 'ssssss'],
      open: ['sMMMMs', 'sMuuMs', 'ssMMss'],
      o: ['ssMMss', 'sMuuMs', 'ssMMss'],
      big: ['MuuuuM', 'sMuuMs', 'ssMMss'],
      wavy: ['ssssss', 'sMsMMs', 'ssssss'],
    },
  },
  arms: {
    up: [[16, 40, 'ss'], [17, 39, 'sss'], [18, 39, 'sss'], [19, 38, 'sss'], [20, 37, 'sss'], [21, 36, 'ccc'],
      [22, 35, 'bbb'], [23, 34, 'bbb'], [24, 33, 'bbb'], [25, 32, 'bbbb'], [26, 31, 'bbb'], [27, 31, 'bb']],
    ear: [[15, 38, 'ss'], [16, 37, 'ssss'], [17, 37, 'ssss'], [18, 38, 'sss'], [19, 39, 'ss'], [20, 39, 'sss'],
      [21, 39, 'sss'], [22, 39, 'sss'], [23, 38, 'cccc'], [24, 37, 'bbbb'], [25, 35, 'bbbbb'], [26, 33, 'bbbbb'], [27, 31, 'bbbb']],
    chin: [[22, 25, 'sss'], [23, 25, 'ssss'], [24, 25, 'ssss'], [25, 26, 'sss'], [26, 26, 'sss'], [27, 27, 'sss'],
      [28, 27, 'sss'], [28, 31, 'bbb'], [29, 27, 'sss'], [29, 31, 'bbb'], [30, 28, 'ss'], [30, 31, 'bbb'],
      [31, 28, 'ss'], [31, 31, 'ccc'], [32, 28, 'ssssss'], [33, 29, 'ssss']],
    shrug: [[28, 31, 'bbb'], [29, 31, 'bbb'], [30, 31, 'bbb'], [31, 31, 'ccc'], [31, 38, 'sss'], [32, 31, 'ssssssssss'], [33, 32, 'sssss']],
  },
  glyphs: GLYPHS_BIG,
  paint: {
    arms: { paintLow: 'shrug', paintMid: 'ear', paintHigh: 'up' },
    roller: { w: 6, h: 3 },
    low: { x: 41, y: 24, grip: [[41, 28], [41, 29], [41, 30], [41, 31]] },
    mid: { x: 42, y: 12, grip: [[41, 16], [42, 16]] },
    high: { x: 39, y: 7, grip: [[41, 11], [41, 12], [41, 13], [42, 14]] },
    flicks: {
      fl1: { x: 45, y: 13, big: true }, fl2: { x: 46, y: 20 }, fl3: { x: 45, y: 2, big: true },
      fl4: { x: 45, y: 30, big: true }, fl5: { x: 46, y: 35 }, fl6: { x: 44, y: 40 },
    },
    shine: { x: 43, y: 2 },
  },
  cloud: { glyphs: CLOUD_BIG, x: 36, y: 0, t1: [38, 11], t2: { glyph: 'dot1', x: 40, y: 8 } },
  fx: {
    z1: { glyph: 'z', x: 38, y: 9 }, z2: { glyph: 'Z', x: 41, y: 3 },
    d1: { glyph: 'dot1', x: 40, y: 12 }, d2: { glyph: 'dot2', x: 41, y: 7 }, d3: { glyph: 'dot3', x: 42, y: 1 },
    q: { glyph: 'q', x: 39, y: 1 },
    s1: { glyph: 'star', x: 2, y: 3 }, s2: { glyph: 'star3', x: 42, y: 6 }, s3: { glyph: 'spark', x: 38, y: 1 },
    s4: { glyph: 'star', x: 40, y: 2 }, s5: { glyph: 'star3', x: 3, y: 9 }, s6: { glyph: 'spark', x: 8, y: 1 },
  },
};

// ---------- A — Detailed (48) — coordinates are AFTER shifting the idle art down 1 px
// (the idle art floated one row above the canvas floor) ----------
const A = {
  shiftDown: 1,
  chinRow: 18, legTop: 34, bobRow: 37, hip: 33, handBottom: 35, sitD: 6,
  armR: { x0: 31, x1: 33, y0: 22, y1: 35 }, swingRow: 30, swingN: 2,
  sitLegs: [[40, 24, 'pppppp'], [41, 25, 'ppppppp'], [42, 26, 'pppppp'], [43, 27, 'ffff'], [44, 26, 'ffffff'], [45, 26, 'fwwwwf'], [46, 27, 'wwww']],
  eyes: {
    y: 10, lx: 19, rx: 26, rotate: true, // 3-wide box: lid row + 2 eye rows; col 0 = outer side
    variants: {
      open: ['ooo', 'sLe', 'sEE'],
      closed: ['sss', 'ooo', 'sss'],
      happy: { L: ['sss', 'sos', 'oso'], R: ['sss', 'sos', 'oso'] },
      left: { L: ['ooo', 'LeW', 'EEW'], R: ['ooo', 'LeW', 'EEW'] },
      right: { L: ['ooo', 'WLe', 'WEE'], R: ['ooo', 'WLe', 'WEE'] },
      upright: { L: ['ooo', 'WLe', 'sWW'], R: ['ooo', 'WLe', 'sWW'] },
    },
  },
  mouth: {
    x: 21, y: 15,
    variants: {
      base: ['stMMts', 'ssssst'],
      closed: ['ssMMss', 'ssssst'],
      open: ['sMuuMs', 'ssMMst'],
      o: ['ssMMss', 'ssMMst'],
      big: ['MuuuuM', 'sMMMMt'],
      wavy: ['sMsMss', 'ssssst'],
    },
  },
  arms: {
    up: [[10, 37, 'ss'], [11, 36, 'sss'], [12, 36, 'ss'], [13, 35, 'ss'], [14, 35, 'ss'], [15, 34, 'ss'], [16, 34, 'ss'],
      [17, 33, 'cc'], [18, 33, 'bb'], [19, 32, 'bb'], [20, 32, 'bb'], [21, 31, 'bb'], [22, 31, 'bb']],
    ear: [[10, 32, 'ss'], [11, 32, 'sss'], [12, 32, 'sss'], [13, 33, 'ss'], [14, 33, 'ss'], [15, 33, 'ss'], [16, 33, 'ss'],
      [17, 33, 'ss'], [18, 33, 'ss'], [19, 33, 'cc'], [20, 33, 'bb'], [21, 32, 'bbb'], [22, 31, 'bbb'], [23, 31, 'bb']],
    chin: [[17, 24, 'sss'], [18, 24, 'ssss'], [19, 25, 'sss'], [20, 26, 'ss'], [21, 26, 'ss'], [22, 27, 'ss'], [23, 27, 'ss'],
      [24, 28, 'ss'], [25, 28, 'ss'], [26, 28, 'ss'], [22, 31, 'bb'], [23, 31, 'bb'], [24, 31, 'bb'], [25, 31, 'bb'],
      [26, 31, 'cc'], [27, 28, 'sssss'], [28, 30, 'sss']],
    shrug: [[22, 31, 'bb'], [23, 31, 'bb'], [24, 31, 'bb'], [25, 31, 'bb'], [26, 31, 'cc'], [27, 31, 'ss'], [27, 36, 'sss'],
      [28, 31, 'ssssssss'], [29, 32, 'ssss']],
  },
  glyphs: GLYPHS_BIG,
  paint: {
    arms: { paintLow: 'shrug', paintMid: 'shrug', paintHigh: 'up' },
    roller: { w: 6, h: 3 },
    low: { x: 39, y: 22, grip: [[39, 25], [39, 26]] },
    mid: { x: 39, y: 14, grip: [[39, 17], [39, 18], [39, 19], [39, 20], [39, 21], [39, 22], [39, 23], [39, 24], [39, 25], [39, 26]] },
    high: { x: 35, y: 5, grip: [[37, 8], [37, 9]] },
    flicks: {
      fl1: { x: 43, y: 9, big: true }, fl2: { x: 45, y: 16 }, fl3: { x: 42, y: 1, big: true },
      fl4: { x: 44, y: 27, big: true }, fl5: { x: 45, y: 32 }, fl6: { x: 43, y: 38 },
    },
    shine: { x: 41, y: 0 },
  },
  cloud: { glyphs: CLOUD_BIG, x: 35, y: 0, t1: [34, 11], t2: { glyph: 'dot1', x: 35, y: 8 } },
  fx: {
    z1: { glyph: 'z', x: 34, y: 8 }, z2: { glyph: 'Z', x: 37, y: 2 },
    d1: { glyph: 'dot1', x: 34, y: 9 }, d2: { glyph: 'dot2', x: 36, y: 5 }, d3: { glyph: 'dot3', x: 38, y: 0 },
    q: { glyph: 'q', x: 35, y: 0 },
    s1: { glyph: 'star', x: 9, y: 1 }, s2: { glyph: 'star3', x: 37, y: 5 }, s3: { glyph: 'spark', x: 34, y: 1 },
    s4: { glyph: 'star', x: 34, y: 1 }, s5: { glyph: 'star3', x: 8, y: 7 }, s6: { glyph: 'spark', x: 13, y: 2 },
  },
};

// ---------- B — Chibi small (32) ----------
const B = {
  chinRow: 16, legTop: 26, bobRow: 26, hip: 25, handBottom: 24, sitD: 3,
  armR: { x0: 21, x1: 23, y0: 19, y1: 24 }, swingRow: 22, swingN: 1,
  sitLegs: [[29, 17, 'ffff'], [30, 18, 'www']],
  eyes: {
    y: 9, lx: 11, rx: 18, rotate: false, // 3-wide: lash row + 3 iris rows
    variants: {
      open: ['ooo', 'LeE', 'eeE', 'EIE'],
      closed: ['sss', 'sss', 'ooo', 'sss'],
      happy: ['sss', 'sos', 'oso', 'sss'],
      left: ['ooo', 'LeW', 'eEW', 'EIW'],
      right: ['ooo', 'WLe', 'WeE', 'WEI'],
      upright: ['ooo', 'WLe', 'WeE', 'sWW'],
    },
  },
  mouth: {
    x: 14, y: 13,
    variants: {
      base: ['ssss', 'sMMs', 'ssss'],
      closed: ['ssss', 'sMMs', 'ssss'],
      open: ['ssss', 'MuuM', 'sMMs'],
      o: ['ssss', 'sMMs', 'sMMs'],
      big: ['MssM', 'MuuM', 'sMMs'],
      wavy: ['ssss', 'sMMs', 'MssM'],
    },
  },
  arms: {
    up: [[10, 27, 'ss'], [11, 26, 'sss'], [12, 26, 'ss'], [13, 25, 'ss'], [14, 25, 'cc'], [15, 24, 'bb'], [16, 23, 'bb'],
      [17, 22, 'bb'], [18, 21, 'bb'], [19, 21, 'bb']],
    ear: [[9, 25, 'ss'], [10, 24, 'sss'], [11, 25, 'ss'], [12, 25, 'ss'], [13, 25, 'ss'], [14, 25, 'ss'], [15, 25, 'cc'],
      [16, 24, 'bb'], [17, 23, 'bb'], [18, 22, 'bb'], [19, 21, 'bb']],
    chin: [[15, 17, 'sss'], [16, 17, 'sss'], [17, 18, 'ss'], [18, 18, 'ss'], [19, 18, 'ss'], [19, 21, 'bb'], [20, 18, 'ss'],
      [20, 21, 'bb'], [21, 19, 's'], [21, 21, 'cc'], [22, 19, 'ssss'], [23, 20, 'sss']],
    shrug: [[19, 21, 'bb'], [20, 21, 'bb'], [21, 21, 'cc'], [21, 25, 'ss'], [22, 21, 'ssssss'], [23, 22, 'sss']],
  },
  glyphs: GLYPHS_SMALL,
  paint: {
    arms: { paintLow: 'shrug', paintMid: 'shrug', paintHigh: 'up' },
    roller: { w: 4, h: 2 }, smallFlicks: true,
    low: { x: 27, y: 17, grip: [[27, 19], [27, 20]] },
    mid: { x: 27, y: 12, grip: [[27, 14], [27, 15], [27, 16], [27, 17], [27, 18], [27, 19], [27, 20]] },
    high: { x: 25, y: 6, grip: [[27, 8], [27, 9]] },
    flicks: {
      fl1: { x: 30, y: 9 }, fl2: { x: 31, y: 15 }, fl3: { x: 29, y: 2 },
      fl4: { x: 30, y: 20 }, fl5: { x: 31, y: 24 }, fl6: { x: 29, y: 27 },
    },
    shine: { x: 28, y: 1 },
  },
  cloud: { glyphs: CLOUD_SMALL, x: 24, y: 0, t1: [24, 9], t2: { glyph: 'dot0', x: 25, y: 7 } },
  fx: {
    z1: { glyph: 'z', x: 25, y: 5 }, z2: { glyph: 'Z', x: 28, y: 1 },
    d1: { glyph: 'dot1', x: 26, y: 8 }, d2: { glyph: 'dot2', x: 27, y: 4 }, d3: { glyph: 'dot3', x: 28, y: 0 },
    q: { glyph: 'q', x: 27, y: 0 },
    s1: { glyph: 'star', x: 2, y: 1 }, s2: { glyph: 'star3', x: 27, y: 4 }, s3: { glyph: 'spark', x: 25, y: 1 },
    s4: { glyph: 'star', x: 27, y: 1 }, s5: { glyph: 'star3', x: 2, y: 6 }, s6: { glyph: 'spark', x: 6, y: 1 },
  },
};

// The thought cloud and paint roller: glyphs, effects and arm aliases per style.
for (const cfg of [A, B, C]) {
  const roller = paintRoller(cfg.paint);
  const c = cfg.cloud;
  cfg.glyphs = { ...cfg.glyphs, ...c.glyphs, ...roller.glyphs };
  cfg.fx = {
    ...cfg.fx,
    ...roller.fx,
    c0: { glyph: 'cloud0', x: c.x, y: c.y }, c1: { glyph: 'cloud1', x: c.x, y: c.y },
    c2: { glyph: 'cloud2', x: c.x, y: c.y }, c3: { glyph: 'cloud3', x: c.x, y: c.y },
    t1: { glyph: 'dot0', x: c.t1[0], y: c.t1[1] }, t2: c.t2,
  };
  for (const [alias, pose] of Object.entries(cfg.paint.arms)) cfg.arms[alias] = cfg.arms[pose];
}

export const CONFIG = { A, B, C };
