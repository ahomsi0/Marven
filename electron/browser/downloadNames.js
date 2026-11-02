// File names for downloads: whatever the site suggests is reduced to a bare,
// safe name, and numbered if the Downloads folder already has one.

const path = require('node:path');

const NAME_LIMIT = 200;

function sanitizeFilename(name) {
  let base = String(name ?? '').split(/[\\/]/).pop();
  base = base.replace(/[\x00-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim();
  if (!base) base = 'download';
  if (base.length <= NAME_LIMIT) return base;
  const ext = path.extname(base).slice(0, 20);
  return base.slice(0, NAME_LIMIT - ext.length) + ext;
}

function uniqueName(name, exists) {
  if (!exists(name)) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

module.exports = { sanitizeFilename, uniqueName };
