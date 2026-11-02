#!/usr/bin/env node
/**
 * Generates:
 *   electron/assets/icon.png       – 512×512 dock / window icon (navy tile + blue logo)
 *   electron/assets/tray.png       – 44×44 menu-bar tray icon (transparent bg, white logo)
 *
 * Uses only Node.js built-ins (zlib, fs, path, crypto). No npm packages needed.
 */

const zlib   = require("zlib");
const fs     = require("fs");
const path   = require("path");

// ─── CRC32 ───────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─── Minimal PNG writer ───────────────────────────────────────────────────────
function pngChunk(type, data) {
  const t   = Buffer.from(type, "ascii");
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

function writePNG(pixels, w, h, filePath) {
  // pixels = Uint8ClampedArray or Buffer, RGBA, row-major
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8]  = 8; // bit depth
  ihdr[9]  = 6; // colour type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Prepend filter byte 0 (None) to every scanline
  const stride = w * 4;
  const raw    = Buffer.allocUnsafe(h * (1 + stride));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + stride)] = 0;
    Buffer.from(pixels).copy(raw, y * (1 + stride) + 1, y * stride, (y + 1) * stride);
  }

  // zlib.deflateSync produces RFC-1950 format which PNG requires
  const idat = zlib.deflateSync(raw, { level: 9 });

  const out = Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, out);
}

// ─── Pixel canvas helpers ─────────────────────────────────────────────────────
function makeCanvas(w, h) {
  const buf = new Uint8ClampedArray(w * h * 4); // all transparent
  return {
    buf, w, h,
    set(x, y, r, g, b, a) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const i = (y * w + x) * 4;
      // alpha-composite over existing pixel
      const sa = a / 255, da = buf[i+3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa < 1e-6) return;
      buf[i]   = Math.round((r * sa + buf[i]   * da * (1 - sa)) / oa);
      buf[i+1] = Math.round((g * sa + buf[i+1] * da * (1 - sa)) / oa);
      buf[i+2] = Math.round((b * sa + buf[i+2] * da * (1 - sa)) / oa);
      buf[i+3] = Math.round(oa * 255);
    },
  };
}

function fillCircle(cv, cx, cy, rad, r, g, b, a = 255) {
  const x0 = Math.floor(cx - rad), x1 = Math.ceil(cx + rad);
  const y0 = Math.floor(cy - rad), y1 = Math.ceil(cy + rad);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= rad) {
        const aa = Math.min(1, rad - d + 0.5); // anti-alias at edge
        cv.set(x, y, r, g, b, Math.round(a * aa));
      }
    }
  }
}

function drawLine(cv, x0, y0, x1, y1, thick, r, g, b, a = 255) {
  const dx = x1 - x0, dy = y1 - y0, len = Math.sqrt(dx*dx + dy*dy);
  const steps = Math.max(Math.ceil(len * 2), 1);
  const half = thick / 2;
  for (let s = 0; s <= steps; s++) {
    const t  = s / steps;
    fillCircle(cv, x0 + dx * t, y0 + dy * t, half, r, g, b, a);
  }
}

// Rounded-square tile with a soft deep-navy radial gradient, anti-aliased
// edges and a faint inner rim.
function drawTile(cv, x0, y0, size, radius) {
  const stops = [[0, [48, 72, 120]], [0.55, [27, 42, 76]], [1, [16, 26, 48]]];
  const colourAt = (t) => {
    for (let i = 1; i < stops.length; i++) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      if (t <= t1) return c0.map((v, j) => v + (c1[j] - v) * ((t - t0) / (t1 - t0)));
    }
    return stops[stops.length - 1][1];
  };
  const gx = x0 + size * 0.3, gy = y0 + size * 0.15, gr = size * 1.2;
  const half = size / 2, mx = x0 + half, my = y0 + half;
  for (let y = Math.floor(y0); y < y0 + size; y++) {
    for (let x = Math.floor(x0); x < x0 + size; x++) {
      // Signed distance to the rounded square (negative inside)
      const qx = Math.abs(x + 0.5 - mx) - (half - radius);
      const qy = Math.abs(y + 0.5 - my) - (half - radius);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      if (d > 0.5) continue;
      const [r, g, b] = colourAt(Math.min(1, Math.hypot(x - gx, y - gy) / gr));
      cv.set(x, y, r, g, b, Math.round(255 * Math.min(1, 0.5 - d)));
      if (d > -2) cv.set(x, y, 255, 255, 255, 20); // inner rim
    }
  }
}

// ─── Draw the Marven logo onto a canvas ──────────────────────────────────────
// Open hexagon + centre dot, in the 32×32 units of MarvenLogo.tsx.
const LOGO_PATH = [[24.5, 8.9], [16, 4], [5.6, 10], [5.6, 22], [16, 28], [26.4, 22], [26.4, 15.5]];

function drawLogo(cv, cx, cy, size, r, g, b) {
  const s = size / 32;
  const pt = ([x, y]) => [cx + (x - 16) * s, cy + (y - 16) * s];
  for (let i = 1; i < LOGO_PATH.length; i++) {
    const [ax, ay] = pt(LOGO_PATH[i - 1]), [bx, by] = pt(LOGO_PATH[i]);
    drawLine(cv, ax, ay, bx, by, 2.2 * s, r, g, b);
  }
  fillCircle(cv, cx, cy, 3.4 * s, r, g, b);
}

// ─── 1. Dock icon (512×512, navy tile on the macOS icon grid) ────────────────
{
  const W = 512, H = 512;
  const cv = makeCanvas(W, H);
  const cx = W/2, cy = H/2;

  // 412px tile with a 50px margin and ~22% corner radius, like other dock icons
  drawTile(cv, 50, 50, 412, 92);
  drawLogo(cv, cx, cy, 320, 91, 156, 246);

  const outPath = path.join(__dirname, "assets", "icon.png");
  writePNG(cv.buf, W, H, outPath);
  console.log("✓  icon.png  →", outPath);
}

// ─── 2. Tray icon (44×44, transparent bg, white logo for template) ────────────
{
  const W = 44, H = 44;
  const cv = makeCanvas(W, H);
  const cx = W/2, cy = H/2;

  drawLogo(cv, cx, cy, 52, 255, 255, 255);

  const outPath = path.join(__dirname, "assets", "tray.png");
  writePNG(cv.buf, W, H, outPath);
  console.log("✓  tray.png  →", outPath);
}
