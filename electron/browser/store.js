// A JSON file kept in memory and written back after a short delay. Writes go
// to a temp file that is fsynced and renamed over the real one, so a crash or
// power loss mid-write never leaves a half-written file. A file that can't be
// parsed is moved to a timestamped `.bak`; a file that can't be read for any
// other reason (permissions, a directory in the way…) is left alone and the
// store becomes read-only, so the real file on disk is never replaced.

const fs = require('node:fs');
const path = require('node:path');

function removeLeftoverTemps(file) {
  const dir = path.dirname(file);
  const prefix = `${path.basename(file)}.`;
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (name.startsWith(prefix) && name.endsWith('.tmp')) {
      try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* best effort */ }
    }
  }
}

// Returns { value, readOnly }.
function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { value: fallback, readOnly: false };
    console.error('[browser] could not read file, not saving changes to it:', file, err.message);
    return { value: fallback, readOnly: true };
  }
  try {
    return { value: JSON.parse(text), readOnly: false };
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    console.error('[browser] unreadable file, starting fresh:', file, err.message);
    try { fs.renameSync(file, `${file}.${Date.now()}.bak`); } catch { /* best effort */ }
    return { value: fallback, readOnly: false };
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* best effort */ }
    }
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function createJsonStore(file, fallback, { delayMs = 1000 } = {}) {
  removeLeftoverTemps(file);
  const loaded = readJson(file, fallback);
  const readOnly = loaded.readOnly;
  let value = loaded.value;
  let dirty = false;
  let timer = null;

  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || readOnly) return;
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
