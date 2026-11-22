// electron/apiToken.js
//
// Per-launch API token for the embedded Next.js server. The server listens on
// 127.0.0.1, which every local program can reach, so the Origin/Host guards
// alone can't stop a non-browser caller (curl, another user's process, a
// container reaching host loopback). The main process generates a random token
// at startup, hands it to the in-process server through
// process.env.MARVEN_API_TOKEN, and stamps it on every request the app's own
// renderer sends to the app origin. middleware.ts rejects /api/* requests that
// don't carry it.
//
// Kept free of Electron imports so the logic can be unit-tested.

const crypto = require('crypto');

const API_TOKEN_HEADER = 'x-marven-token';

function createApiToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** URL patterns (Electron webRequest filter syntax) for the app's own origins. */
function appOriginPatterns(port) {
  return [`http://localhost:${port}/*`, `http://127.0.0.1:${port}/*`];
}

/**
 * Whether `url` is served by the app's own server: plain http on localhost or
 * 127.0.0.1 at exactly `port`. Compared on the parsed URL, not a string prefix,
 * so http://localhost:47891.evil.com/ and http://localhost:478910/ don't match.
 */
function isAppOriginUrl(url, port) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return (
    u.protocol === 'http:' &&
    (u.hostname === 'localhost' || u.hostname === '127.0.0.1') &&
    u.port === String(port) &&
    u.username === '' &&
    u.password === ''
  );
}

/** Copy of `headers` without the token header (any case variant). */
function withoutApiToken(headers) {
  const next = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== API_TOKEN_HEADER) next[key] = value;
  }
  return next;
}

/** Copy of `headers` with the token header set (replacing any case variant). */
function withApiToken(headers, token) {
  return { ...withoutApiToken(headers), [API_TOKEN_HEADER]: token };
}

// Read-only GET routes that legitimately load inside subframes of the app
// window: the editor's sandboxed HTML preview (and the files it references
// relatively) and the PDF preview iframe. Nothing else is needed by a frame
// other than the app's own top-level document.
const SUBFRAME_READ_PATHS = ['/api/workspace/serve', '/api/workspace/files/raw'];
const SUBFRAME_READ_PREFIXES = ['/api/workspace/preview/'];

function isSubframeReadRequest(url, method) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return SUBFRAME_READ_PATHS.includes(pathname) || SUBFRAME_READ_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Who sent an app-origin request, as far as Electron tells us:
 * - 'app'     the app window's top-level frame, showing the app origin
 * - 'other'   a subframe (e.g. the editor's preview iframe), a frame not on
 *             the app origin, or another WebContents
 * - 'unknown' no frame and no WebContents attached (service/shared workers,
 *             or a frame Electron could no longer resolve)
 */
function requestSource(details, { port, isAppWebContents }) {
  const wcId = details.webContentsId;
  if (wcId != null && isAppWebContents && !isAppWebContents(wcId)) return 'other';
  let frame;
  try {
    frame = details.frame;
  } catch {
    frame = null;
  }
  if (!frame) return wcId != null ? 'app' : 'unknown';
  try {
    if (frame.parent) return 'other';
    return isAppOriginUrl(frame.url, port) ? 'app' : 'other';
  } catch {
    // WebFrameMain throws once its frame is disposed: nothing to stamp for.
    return 'other';
  }
}

/** Whether a request to the app origin should carry the API token. */
function shouldAttachToken(details, { port, isAppWebContents }) {
  if (!isAppOriginUrl(details.url, port)) return false;
  const source = requestSource(details, { port, isAppWebContents });
  if (source === 'other') return isSubframeReadRequest(details.url, details.method);
  // 'app', or 'unknown': requests with no frame at all can't be attributed, so
  // they are decided by destination alone (fail open, as before this check).
  return true;
}

/**
 * Builds the single onBeforeSendHeaders listener for the default session.
 * Electron keeps only the last listener registered per session, so the app
 * token and the Web Speech Origin fix share one handler.
 *
 * The token goes only to the app's own origin, and in full only to requests
 * from the app window's top-level frame (fetch, EventSource, img and the like
 * all carry that frame). Subframes such as the editor's sandboxed preview
 * iframe get it only for the read-only preview/file GET routes they load
 * from, so preview HTML can't reach any other API route. A request Electron
 * attaches no frame or WebContents to (service/shared workers) is decided by
 * destination alone.
 *
 * @param {{ port: number, token: string | null, speechOrigin: string, isAppWebContents?: (id: number) => boolean }} options
 *   `token` null (dev: `next dev` runs separately and doesn't know it) skips
 *   the token header. `isAppWebContents` says whether a WebContents id is the
 *   app window's.
 * @returns {{ filter: { urls: string[] }, listener: (details: { url: string, method?: string, webContentsId?: number, frame?: { parent: unknown, url: string } | null, requestHeaders: Record<string, string> }, callback: (r: { requestHeaders: Record<string, string> }) => void) => void }}
 */
function createRequestHeaderHandler({ port, token, speechOrigin, isAppWebContents }) {
  const speechPatterns = ['https://www.google.com/*', 'wss://www.google.com/*'];
  const isSpeechUrl = (url) => url.startsWith('https://www.google.com/') || url.startsWith('wss://www.google.com/');
  return {
    filter: { urls: [...speechPatterns, ...appOriginPatterns(port)] },
    listener(details, callback) {
      let headers = details.requestHeaders;
      if (isAppOriginUrl(details.url, port)) {
        // Always drop a token the page set itself; add ours only when allowed.
        headers = withoutApiToken(headers);
        if (token && shouldAttachToken(details, { port, isAppWebContents })) {
          headers = withApiToken(headers, token);
        }
      } else if (isSpeechUrl(details.url)) {
        // Google's speech service checks the Origin header, which Electron
        // requests may not carry properly.
        headers = { ...headers, Origin: speechOrigin };
      }
      callback({ requestHeaders: headers });
    },
  };
}

module.exports = {
  API_TOKEN_HEADER,
  createApiToken,
  appOriginPatterns,
  isAppOriginUrl,
  withApiToken,
  shouldAttachToken,
  createRequestHeaderHandler,
};
