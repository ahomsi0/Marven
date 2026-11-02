// A JSON file kept in memory and written back after a short delay. Writes go
// to a temp file that is renamed over the real one, so a crash mid-write
// never leaves a half-written file. An unreadable file is moved to `.bak`.

const fs = require('node:fs');
const path = require('node:path');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    console.error('[browser] unreadable file, starting fresh:', file, err.message);
    try { fs.renameSync(file, `${file}.bak`); } catch { /* best effort */ }
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function createJsonStore(file, fallback, { delayMs = 1000 } = {}) {
  let value = readJson(file, fallback);
  let dirty = false;
  let timer = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    try {
      writeJsonAtomic(file, value);
    } catch (err) {
      console.error('[browser] could not save', file, err.message);
    }
  }

  return {
    get: () => value,
    set(next) {
      value = next;
      dirty = true;
      if (!timer) timer = setTimeout(flush, delayMs);
    },
    flush,
  };
}

module.exports = { createJsonStore };
