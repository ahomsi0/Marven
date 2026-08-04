// Shared guards for the in-process Next.js API routes. These routes run on a
// 127.0.0.1-only server inside Electron, but several of them perform
// destructive filesystem operations, so we add defense-in-depth against any
// cross-origin caller (e.g. a page the renderer was tricked into loading).

import { NextRequest } from "next/server";

/**
 * Rejects a request whose `Origin` header is present and is NOT a local origin.
 * Same-origin requests from the app renderer send `Origin: http://localhost:<port>`
 * (or omit it entirely); a foreign web page would send its own origin. We
 * fail-open on a missing Origin so non-browser callers and same-origin GETs
 * keep working — browsers cannot suppress the Origin header on cross-origin
 * requests, so this still blocks the cross-site case.
 *
 * Returns an error string to respond with, or null when the request is allowed.
 */
export function crossOriginRejection(req: NextRequest): string | null {
  const origin = req.headers.get("origin");
  if (!origin) return null; // no Origin → same-origin GET or non-browser caller
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return "Invalid Origin";
  }
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  return isLocal ? null : "Cross-origin request rejected";
}
