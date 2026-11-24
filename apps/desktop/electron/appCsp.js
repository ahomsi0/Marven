// electron/appCsp.js
//
// Response headers for the app's own origin. Every page and API response
// gets the app's Content-Security-Policy, which includes
// `frame-ancestors 'none'`. Workspace previews are the exception: the editor
// shows them in an iframe, so stamping that policy on them made Chromium
// refuse to render the frame (a blank preview) and also replaced the
// preview route's own sandbox policy. Previews keep their route's policy (a
// sandbox is always enforced) and may only be framed by the app itself.
//
// Kept free of Electron imports so it can be unit-tested.

const PREVIEW_PREFIX = '/api/workspace/preview/';
const FALLBACK_PREVIEW_CSP = "sandbox allow-scripts; default-src 'self' data: blob:";

function isPreviewUrl(url, appOrigin) {
  if (!url.startsWith(appOrigin)) return false;
  try {
    return new URL(url).pathname.startsWith(PREVIEW_PREFIX);
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @param {Record<string, string[]>} headers
 * @param {{ appOrigin: string, csp: string }} opts
 */
function withAppCsp(url, headers, { appOrigin, csp }) {
  if (!url.startsWith(appOrigin)) return headers;
  if (!isPreviewUrl(url, appOrigin)) {
    return { ...headers, 'Content-Security-Policy': [csp] };
  }
  const rest = {};
  let own = '';
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === 'content-security-policy') own = (value || []).join('; ');
    else rest[key] = value;
  }
  let policy = own.trim() || FALLBACK_PREVIEW_CSP;
  if (!/(^|;)\s*sandbox\b/.test(policy)) policy = `sandbox allow-scripts; ${policy}`;
  policy = policy
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^frame-ancestors\b/i.test(d))
    .concat(`frame-ancestors ${appOrigin}`)
    .join('; ');
  return { ...rest, 'Content-Security-Policy': [policy] };
}

module.exports = { withAppCsp, isPreviewUrl };
