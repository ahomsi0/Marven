// Site icons are fetched here, through the browser's own session, decoded and
// re-encoded as a small PNG data: URL — so Marven's CSP never has to allow
// remote images and the renderer never sees the site's own bytes. PNG and JPEG
// are decoded and re-encoded as a 32px PNG; the other types nativeImage can't
// decode (ICO, GIF, WebP, SVG) are passed on as-is, which is safe because they
// only ever render inside an <img>. The fetch is bounded in time and size.

const { nativeImage } = require('electron');
const { isWebUrl } = require('./validate');

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 5000;
const ICON_SIZE = 32;
const IMAGE_TYPES = /^image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml)$/;
// Types nativeImage can decode, and so can be shrunk.
const DECODABLE = new Set(['image/png', 'image/jpeg']);
const ICO_MAGIC = [0x00, 0x00, 0x01, 0x00];

/** @returns {string | null} the bare media type when it is an accepted image type */
function imageType(contentType) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  return IMAGE_TYPES.test(type) ? type : null;
}

/** @returns {boolean} whether the URL's path ends in .ico */
function isIcoUrl(url) {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.ico');
  } catch {
    return false;
  }
}

/**
 * The type to treat a downloaded icon as: its declared type when that is an
 * accepted image type, or image/x-icon when a .ico URL was served with some
 * other (or no) type but the body starts with the ICO magic bytes.
 * @param {string | null | undefined} contentType
 * @param {string} url
 * @param {Uint8Array} bytes
 * @returns {string | null}
 */
function resolveType(contentType, url, bytes) {
  const declared = imageType(contentType);
  if (declared) return declared;
  if (isIcoUrl(url) && ICO_MAGIC.every((b, i) => bytes[i] === b)) return 'image/x-icon';
  return null;
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
    const contentType = res.headers.get('content-type');
    // Without an image type the body is only worth reading for a .ico URL.
    if (!res.ok || (!imageType(contentType) && !isIcoUrl(url))) return null;
    const bytes = await readCapped(res, MAX_BYTES);
    if (!bytes) return null;
    const type = resolveType(contentType, url, bytes);
    if (!type) return null;
    const raw = `data:${type};base64,${bytes.toString('base64')}`;
    if (!DECODABLE.has(type)) return raw;
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return raw;
    return image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'good' }).toDataURL();
  } catch {
    return null;
  }
}

module.exports = { fetchFavicon, readCapped, imageType, resolveType };
