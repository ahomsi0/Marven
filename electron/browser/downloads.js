// Downloads go straight to the Downloads folder under a cleaned, unique name,
// and are never opened automatically. The list lasts for the session.
// MARVEN_DOWNLOADS_DIR overrides the folder — used only by the test run.

const fs = require('node:fs');
const path = require('node:path');
const { app, shell } = require('electron');
const { sanitizeFilename, uniqueName } = require('./downloadNames');

function createDownloads({ onChange }) {
  const entries = new Map();
  // Names of downloads still in progress, lower-cased (APFS is case-insensitive
  // by default), so two downloads started together never pick the same file.
  const reserved = new Set();
  let seq = 0;

  function folder() {
    return path.resolve(process.env.MARVEN_DOWNLOADS_DIR || app.getPath('downloads'));
  }

  function handle(_event, item) {
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
      entry.state = state;
      entry.receivedBytes = item.getReceivedBytes();
      entry.item = null;
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

module.exports = { createDownloads };
