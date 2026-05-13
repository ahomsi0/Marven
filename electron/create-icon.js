#!/usr/bin/env node
/**
 * Generates:
 *   electron/assets/icon.png       – 512×512 dock / window icon (dark bg + blue logo)
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

function fillRect(cv, x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = Math.round(y0); y <= Math.round(y1); y++)
    for (let x = Math.round(x0); x <= Math.round(x1); x++)
      cv.set(x, y, r, g, b, a);
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

function drawHex(cv, cx, cy, radius, thick, r, g, b, a = 255) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const ang = (Math.PI / 3) * i - Math.PI / 6;
    return [cx + radius * Math.cos(ang), cy + radius * Math.sin(ang)];
  });
  for (let i = 0; i < 6; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i+1)%6];
    drawLine(cv, ax, ay, bx, by, thick, r, g, b, a);
  }
}

// ─── Draw the Marven logo onto a canvas ──────────────────────────────────────
// Matches reference: single hexagon ring + Y-shaped neural mark inside
function drawLogo(cv, cx, cy, hexR, armThick, dotR, hexThick, r, g, b) {
  // Single hexagon ring (pointy-top: vertex at 12 o'clock)
  drawHex(cv, cx, cy, hexR, hexThick, r, g, b, 210);

  // Y-shape nodes — scaled to sit inside the hex
  const inner = hexR * 0.52;
  const nodes = [
    [cx - inner * 0.95, cy - inner * 0.85],
    [cx + inner * 0.95, cy - inner * 0.85],
    [cx,                cy + inner * 1.15],
  ];

  // Arms
  for (const [nx, ny] of nodes)
    drawLine(cv, cx, cy, nx, ny, armThick, r, g, b, 210);

  // Node dots
  for (const [nx, ny] of nodes) {
    fillCircle(cv, nx, ny, dotR * 1.6, r, g, b, 30); // glow
    fillCircle(cv, nx, ny, dotR,       r, g, b, 235);
  }

  // Centre dot
  fillCircle(cv, cx, cy, dotR * 1.5, r, g, b, 35);
  fillCircle(cv, cx, cy, dotR,       r, g, b, 245);
}

// ─── 1. Dock icon (512×512, dark background) ─────────────────────────────────
{
  const W = 512, H = 512;
  const cv = makeCanvas(W, H);
  const cx = W/2, cy = H/2;

  fillRect(cv, 0, 0, W-1, H-1, 10, 10, 11);

  // Subtle inner glow
  fillCircle(cv, cx, cy, 170, 91, 156, 246, 12);

  drawLogo(cv, cx, cy,
    /* hexR */     220,   // fills canvas like other dock icons
    /* armThick */  18,
    /* dotR */      20,
    /* hexThick */  14,
    91, 156, 246
  );

  const outPath = path.join(__dirname, "assets", "icon.png");
  writePNG(cv.buf, W, H, outPath);
  console.log("✓  icon.png  →", outPath);
}

// ─── 2. Tray icon (44×44, transparent bg, white logo for template) ────────────
{
  const W = 44, H = 44;
  const cv = makeCanvas(W, H);
  const cx = W/2, cy = H/2;

  const ratio = W / 512;
  drawLogo(cv, cx, cy,
    220 * ratio,   // hexR
    18  * ratio,   // armThick
    20  * ratio,   // dotR
    14  * ratio,   // hexThick
    255, 255, 255
  );

  const outPath = path.join(__dirname, "assets", "tray.png");
  writePNG(cv.buf, W, H, outPath);
  console.log("✓  tray.png  →", outPath);
}
