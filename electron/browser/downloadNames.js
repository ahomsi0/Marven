// File names for downloads: whatever the site suggests is reduced to a bare,
// safe name, and numbered if the Downloads folder already has one.

const path = require('node:path');

// In UTF-8 bytes; leaves room for " (999)" under the usual 255-byte limit.
const NAME_LIMIT = 200;
const EXT_LIMIT = 20;
// Control characters, DEL, characters Windows/macOS treat specially, and the
// bidi / format controls that can make "fdp.exe" display as "exe.pdf".
const UNSAFE = /[\x00-\x1f\x7f<>:"|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function byteLength(s) {
  return Buffer.byteLength(s, 'utf8');
}

// Longest prefix of `s` that fits in `limit` bytes, cut between code points.
function truncateBytes(s, limit) {
  let out = '';
  let used = 0;
  for (const ch of s) {
    const size = byteLength(ch);
    if (used + size > limit) break;
    out += ch;
    used += size;
  }
  return out;
}

function sanitizeFilename(name) {
  let base = String(name ?? '').split(/[\\/]/).pop();
  base = base.replace(UNSAFE, '_').trim().replace(/^[.\s]+/, '');
  if (!base) base = 'download';
  if (byteLength(base) <= NAME_LIMIT) return base;
  const ext = [...path.extname(base)].slice(0, EXT_LIMIT).join('');
  const stem = base.slice(0, base.length - path.extname(base).length);
  return truncateBytes(stem, NAME_LIMIT - byteLength(ext)) + ext;
}

function uniqueName(name, exists) {
  if (!exists(name)) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  for (let n = Date.now(); ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

module.exports = { sanitizeFilename, uniqueName };
