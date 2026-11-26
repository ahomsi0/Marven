// Serves a project folder (a site Mini Me or the Agent built) on this machine
// only, so "Open in browser" gets a real http://127.0.0.1:<port>/ address. The
// in-app preview lives under /api/, which needs the per-launch API token, so a
// normal browser can't load it.
//
// Read-only static files: GET/HEAD only, bound to 127.0.0.1, the Host header
// must be this server (no DNS rebinding), nothing outside the folder (symlinks
// are resolved and checked), and no hidden files (.env, .git) at any depth.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

const MAX_PATH_CHARS = 4096;

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The file a request path maps to inside `realRoot` (already a realpath), or
 * null when it's outside, hidden, malformed, or missing. A folder maps to its
 * index.html when it has one, else to `{ dir }` for a listing.
 */
function resolveRequest(realRoot, urlPath, deps = fs) {
  if (typeof urlPath !== 'string' || urlPath.length > MAX_PATH_CHARS) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || s.startsWith('.'))) return null;
  const target = path.join(realRoot, ...segments);
  let real;
  try {
    real = deps.realpathSync.native ? deps.realpathSync.native(target) : deps.realpathSync(target);
  } catch {
    return null;
  }
  if (!isInside(real, realRoot)) return null;
  // A symlink may not land on a hidden name either.
  if (path.relative(realRoot, real).split(path.sep).some((s) => s.startsWith('.'))) return null;
  let stat;
  try {
    stat = deps.statSync(real);
  } catch {
    return null;
  }
  if (stat.isFile()) return { file: real };
  if (!stat.isDirectory()) return null;
  // "/about" (a folder) → "/about/" so its relative links resolve.
  if (!urlPath.split('?')[0].endsWith('/')) return { redirect: `${urlPath.split('?')[0]}/` };
  const index = path.join(real, 'index.html');
  try {
    if (deps.statSync(index).isFile()) return { file: index };
  } catch {
    /* no index.html: list the folder */
  }
  return { dir: real };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function listing(dir, urlPath) {
  let entries = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith('.'))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
  } catch {
    /* unreadable: empty list */
  }
  const items = entries.map((n) => `<li><a href="${encodeURI(n).replace(/#/g, '%23').replace(/\?/g, '%3F')}">${escapeHtml(n)}</a></li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(urlPath)}</title><body style="font-family:system-ui;padding:24px"><h1 style="font-size:18px">${escapeHtml(urlPath)}</h1><ul>${items || '<li>(empty)</li>'}</ul></body>`;
}

function handler(realRoot, getPort) {
  return (req, res) => {
    const port = getPort();
    const host = String(req.headers.host || '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const urlPath = req.url || '/';
    const hit = resolveRequest(realRoot, urlPath);
    const common = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (!hit) {
      res.writeHead(404, { ...common, 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    if (hit.redirect) {
      res.writeHead(301, { ...common, Location: hit.redirect }).end();
      return;
    }
    if (hit.dir) {
      res.writeHead(200, { ...common, 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : listing(hit.dir, decodeURIComponent(urlPath.split('?')[0])));
      return;
    }
    res.writeHead(200, { ...common, 'Content-Type': contentType(hit.file) });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = fs.createReadStream(hit.file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };
}

/** One server per folder, started on first use and kept until the app quits. */
function createProjectServers() {
  const servers = new Map(); // realRoot → Promise<{ server, port }>

  /** http://127.0.0.1:<port>/ serving `root` (an existing folder), or null. */
  async function urlFor(root) {
    if (typeof root !== 'string' || !root || root.length > MAX_PATH_CHARS || root.includes('\0') || !path.isAbsolute(root)) return null;
    let realRoot;
    try {
      realRoot = fs.realpathSync.native(root);
      if (!fs.statSync(realRoot).isDirectory()) return null;
    } catch {
      return null;
    }
    let entry = servers.get(realRoot);
    if (!entry) {
      entry = new Promise((resolve, reject) => {
        let port = 0;
        const server = http.createServer(handler(realRoot, () => port));
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve({ server, port });
        });
      });
      servers.set(realRoot, entry);
      entry.catch(() => servers.delete(realRoot));
    }
    try {
      const { port } = await entry;
      return `http://127.0.0.1:${port}/`;
    } catch {
      return null;
    }
  }

  function closeAll() {
    for (const entry of servers.values()) entry.then(({ server }) => server.close(), () => {});
    servers.clear();
  }

  return { urlFor, closeAll };
}

/**
 * `base` + a relative page path ("index.html", "about/team.html"), or null
 * when the result would leave the server (an absolute URL, "//host", "..").
 */
function pageUrl(base, relPath) {
  if (typeof relPath !== 'string' || relPath.length > MAX_PATH_CHARS) return null;
  const clean = relPath.replace(/^\/+/, '');
  try {
    const out = new URL(clean, base);
    const b = new URL(base);
    if (out.origin !== b.origin) return null;
    return out.href;
  } catch {
    return null;
  }
}

const shared = createProjectServers();

module.exports = { createProjectServers, resolveRequest, pageUrl, urlFor: shared.urlFor, closeAll: shared.closeAll };
