/**
 * URLs for the in-app HTML preview (`/api/workspace/preview/...`).
 *
 * The workspace root travels in the URL *path*, as one base64url segment
 * prefixed with "@", not in a `?root=` query. A browser resolves relative
 * links (`style.css`, `../img/a.png`) against the path and drops the query,
 * so a query-string root reached index.html but never the files it links.
 */

const B64URL = /^[A-Za-z0-9_-]+$/;

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Encode a workspace root as a single URL-safe path segment. */
export function encodePreviewRoot(root: string): string {
  return bytesToBase64Url(new TextEncoder().encode(root));
}

/** Decode a segment made by `encodePreviewRoot`; null when it isn't one. */
export function decodePreviewRoot(segment: string): string | null {
  if (!segment || !B64URL.test(segment)) return null;
  try {
    const b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Preview URL for a file (path relative to `root`, "/"-separated). */
export function workspacePreviewUrl(root: string, relPath: string): string {
  const encodedPath = relPath
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `/api/workspace/preview/@${encodePreviewRoot(root)}/${encodedPath}`;
}
