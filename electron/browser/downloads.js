// Downloads go straight to the Downloads folder under a cleaned, unique name,
// and are never opened automatically. The list lasts for the session.
// A page may start at most PER_TAB_MAX downloads every PER_TAB_WINDOW_MS, and
// at most MAX_IN_PROGRESS run at once; anything over is cancelled unsaved.
// MARVEN_DOWNLOADS_DIR overrides the folder in unpackaged builds — used only by
// the test run.

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { app, shell } = require('electron');
const { sanitizeFilename, uniqueName } = require('./downloadNames');
const { createRateLimiter } = require('./rateLimit');

const PER_TAB_MAX = 3;
const PER_TAB_WINDOW_MS = 10_000;
const MAX_IN_PROGRESS = 10;

// The value macOS expects in the com.apple.quarantine attribute: flags, the
// time in hex seconds since the epoch, and the name of the app that saved it.
function quarantineValue(nowMs) {
  return `0081;${Math.floor(nowMs / 1000).toString(16)};Marven;`;
}

// Marks a saved file as downloaded from the internet so Gatekeeper checks it
// on first open. Never rejects: a failure is logged and the file is kept.
function quarantine(filePath) {
  if (process.platform !== 'darwin') return Promise.resolve();
  return new Promise((resolve) => {
    execFile('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantineValue(Date.now()), filePath], (err) => {
      if (err) console.error('[browser] could not set the quarantine flag on a download:', err.message);
      resolve();
    });
  });
}

function createDownloads({ onChange }) {
  const entries = new Map();
  // Names of downloads still in progress, lower-cased (APFS is case-insensitive
  // by default), so two downloads started together never pick the same file.
  const reserved = new Set();
  let seq = 0;
  let inProgress = 0;
  let capWarned = false;
  const perTab = createRateLimiter({ max: PER_TAB_MAX, windowMs: PER_TAB_WINDOW_MS });

  function folder() {
    const override = app.isPackaged ? '' : process.env.MARVEN_DOWNLOADS_DIR;
    return path.resolve(override || app.getPath('downloads'));
  }

  // True when this download may go ahead; otherwise cancels it.
  function admit(item, webContents) {
    if (inProgress >= MAX_IN_PROGRESS) {
      if (!capWarned) console.warn(`[browser] too many downloads in progress, cancelling new ones (limit ${MAX_IN_PROGRESS})`);
      capWarned = true;
      item.cancel();
      return false;
    }
    const { ok, warn } = perTab.take(webContents?.id ?? 'unknown');
    if (!ok) {
      if (warn) console.warn(`[browser] a page started too many downloads, cancelling new ones (limit ${PER_TAB_MAX} per ${PER_TAB_WINDOW_MS / 1000}s)`);
      item.cancel();
      return false;
    }
    capWarned = false;
    return true;
  }

  function handle(_event, item, webContents) {
    if (!admit(item, webContents)) return;
    const dir = folder();
    const exists = (n) => reserved.has(n.toLowerCase()) || fs.existsSync(path.join(dir, n));
    const name = uniqueName(sanitizeFilename(item.getFilename()), exists);
    const target = path.join(dir, name);
    if (path.dirname(target) !== dir) {
      item.cancel();
      return;
    }
    item.setSavePath(target);
    const key = name.toLowerCase();
    reserved.add(key);
    inProgress += 1;

    const entry = { id: `d${++seq}`, filename: name, path: target, state: 'progressing', receivedBytes: 0, totalBytes: item.getTotalBytes(), item };
    entries.set(entry.id, entry);
    onChange();

    item.on('updated', (_e, state) => {
      entry.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      entry.receivedBytes = item.getReceivedBytes();
      entry.totalBytes = item.getTotalBytes();
      onChange();
    });
    item.once('done', (_e, state) => {
      reserved.delete(key);
      inProgress -= 1;
      entry.receivedBytes = item.getReceivedBytes();
      entry.item = null;
      if (state === 'completed' && process.platform === 'darwin') {
        // Flag the file before it shows as completed, so it can't be opened first.
        quarantine(target).then(() => {
          entry.state = state;
          onChange();
        });
        return;
      }
      entry.state = state;
      onChange();
    });
  }

  function list() {
    return [...entries.values()].map(({ id, filename, state, receivedBytes, totalBytes }) => ({ id, filename, state, receivedBytes, totalBytes }));
  }

  function cancel(id) {
    entries.get(id)?.item?.cancel();
  }

  function show(id) {
    const entry = entries.get(id);
    if (entry?.state === 'completed') shell.showItemInFolder(entry.path);
  }

  return { handle, list, cancel, show };
}

module.exports = { createDownloads, quarantineValue };
