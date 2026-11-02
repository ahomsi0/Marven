// Ad and tracker blocking for the browser session: network requests only,
// matched against EasyList/EasyPrivacy (Ghostery's engine). No cosmetic
// filtering — that needs a script in every page, which we never inject.

const fs = require('node:fs');
const path = require('node:path');
const { FiltersEngine, Request, adsAndTrackingLists } = require('@ghostery/adblocker');
const { hostOf } = require('./validate');

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const ENGINE_CONFIG = { loadCosmeticFilters: false, loadNetworkFilters: true };

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

function createBlocker({ dir, isDisabledFor, onBlocked }) {
  const cacheFile = path.join(dir, 'adblock.bin');
  let engine = null;

  function readCache() {
    return FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(cacheFile)));
  }

  async function load() {
    try {
      if (isCacheFresh(fs.statSync(cacheFile).mtimeMs, Date.now())) {
        engine = readCache();
        return;
      }
    } catch { /* no cache, or it's from another engine version */ }
    try {
      const fresh = await FiltersEngine.fromLists(fetch, adsAndTrackingLists, ENGINE_CONFIG);
      engine = fresh;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cacheFile, Buffer.from(fresh.serialize()));
    } catch (err) {
      console.error('[browser] filter lists unavailable, browsing unblocked for now:', err.message);
      try { engine = readCache(); } catch { /* nothing cached */ }
    }
  }

  function attach(ses) {
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      const wc = details.webContents;
      const pageUrl = wc && !wc.isDestroyed() ? wc.getURL() : details.referrer;
      const response = decide(engine, details, pageUrl, isDisabledFor(hostOf(pageUrl)));
      if (response) onBlocked(details.webContentsId);
      callback(response ?? {});
    });
  }

  return { load, attach };
}

module.exports = { CACHE_MAX_AGE_MS, isCacheFresh, decide, createBlocker };
