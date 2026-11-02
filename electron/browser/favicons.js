// Site icons are fetched here, through the browser's own session, and handed
// to the UI as small data: URLs — so Marven's CSP never has to allow remote
// images.

const { isWebUrl } = require('./validate');

const MAX_BYTES = 64 * 1024;
const IMAGE_TYPES = /^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|gif|jpeg|webp)$/;

async function fetchFavicon(ses, url) {
  if (!isWebUrl(url)) return null;
  try {
    const res = await ses.fetch(url);
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMAGE_TYPES.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

module.exports = { fetchFavicon };
