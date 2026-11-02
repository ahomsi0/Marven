// Site icons are fetched here, through the browser's own session, decoded and
// re-encoded as a small PNG data: URL — so Marven's CSP never has to allow
// remote images and the renderer never sees the site's own bytes. The fetch
// is bounded in time and size.

const { nativeImage } = require('electron');
const { isWebUrl } = require('./validate');

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;
const ICON_SIZE = 32;
// No SVG: nativeImage can't decode it, and the renderer never needs remote SVG.
const IMAGE_TYPES = /^image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp)$/;

/** @returns {string | null} the bare media type when it is an accepted image type */
function imageType(contentType) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  return IMAGE_TYPES.test(type) ? type : null;
}

/**
 * Reads a fetch Response body, giving up (and cancelling the stream) as soon
 * as it is larger than `max` bytes.
 * @param {{ headers: Headers, body: ReadableStream<Uint8Array> | null }} res
 * @returns {Promise<Buffer | null>}
 */
async function readCapped(res, max) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return total === 0 ? null : Buffer.concat(chunks);
}

async function fetchFavicon(ses, url) {
  if (!isWebUrl(url)) return null;
  try {
    const res = await ses.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok || !imageType(res.headers.get('content-type'))) return null;
    const bytes = await readCapped(res, MAX_BYTES);
    if (!bytes) return null;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    return image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'good' }).toDataURL();
  } catch {
    return null;
  }
}

module.exports = { fetchFavicon, readCapped, imageType };
