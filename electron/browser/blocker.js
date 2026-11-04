// Ad and tracker blocking for the browser session: network requests only,
// matched against EasyList/EasyPrivacy (Ghostery's engine). No cosmetic
// filtering — that needs a script in every page, which we never inject.
//
// Electron allows only one onBeforeRequest listener per session (a second
// call replaces the first), so `attach` owns that slot for the browser
// partition; anything else that needs it must go through here (as the agent
// tabs' refused addresses do, through `refuseRequest`).

const fs = require('node:fs');
const path = require('node:path');
const { FiltersEngine, Request, adsAndTrackingLists } = require('@ghostery/adblocker');
const { hostOf } = require('./validate');

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ENGINE_CONFIG = { loadCosmeticFilters: false, loadNetworkFilters: true };
const FETCH_TIMEOUT_MS = 30_000;

// So a stalled list download can't leave load() pending forever.
const fetchWithTimeout = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

function isCacheFresh(mtimeMs, now) {
  return now - mtimeMs < CACHE_MAX_AGE_MS;
}

/** Electron webRequest response for one request, or null to let it through. */
function decide(engine, details, pageUrl, disabledHere) {
  if (!engine || disabledHere || details.resourceType === 'mainFrame') return null;
  const request = Request.fromRawDetails({
    requestId: String(details.id),
    url: details.url,
    sourceUrl: pageUrl || details.referrer || '',
    type: details.resourceType || 'other',
    tabId: details.webContentsId,
  });
  const { match, redirect } = engine.match(request);
  if (redirect) return { redirectURL: redirect.dataUrl };
  if (match) return { cancel: true };
  return null;
}

/**
 * @param {{ dir: string, isDisabledFor: (host: string) => boolean, onBlocked: (webContentsId: number) => void,
 *   refuseRequest?: (details: Electron.OnBeforeRequestListenerDetails) => boolean }} options
 *   `refuseRequest` cancels a request whatever the filter lists say (the
 *   agent's tabs may not reach Marven's own origin).
 */
function createBlocker({ dir, isDisabledFor, onBlocked, refuseRequest = () => false }) {
  const cacheFile = path.join(dir, 'adblock.bin');
  let engine = null;

  function readCache() {
    return FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(cacheFile)));
  }

  // Temp file + rename, so a crash mid-write never leaves a truncated cache.
  function writeCache(fresh) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${cacheFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, Buffer.from(fresh.serialize()));
      fs.renameSync(tmp, cacheFile);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw err;
    }
  }

  async function load() {
    try {
      if (isCacheFresh(fs.statSync(cacheFile).mtimeMs, Date.now())) {
        engine = readCache();
        return;
      }
    } catch { /* no cache, or it's from another engine version */ }
    try {
      const fresh = await FiltersEngine.fromLists(fetchWithTimeout, adsAndTrackingLists, ENGINE_CONFIG);
      engine = fresh;
      try {
        writeCache(fresh);
      } catch (err) {
        console.error('[browser] could not cache filter lists:', err.message);
      }
    } catch (err) {
      console.error('[browser] filter lists unavailable, browsing unblocked for now:', err.message);
      try { engine = readCache(); } catch { /* nothing cached */ }
    }
  }

  function attach(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (refuseRequest(details)) {
        callback({ cancel: true });
        return;
      }
      const wc = details.webContents;
      // The top-level page URL, not the frame's: the per-site allowlist is
      // about the site the user is on, so it covers its iframes too.
      const pageUrl = wc && !wc.isDestroyed() ? wc.getURL() : details.referrer;
      const response = decide(engine, details, pageUrl, isDisabledFor(hostOf(pageUrl)));
      if (response) onBlocked(details.webContentsId);
      callback(response ?? {});
    });
  }

  return { load, attach };
}

module.exports = { CACHE_MAX_AGE_MS, isCacheFresh, decide, createBlocker };
