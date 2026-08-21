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
  let originUrl: URL;
  let requestUrl: URL;
  try {
    originUrl = new URL(origin);
    requestUrl = new URL(req.url);
  } catch {
    return "Invalid Origin";
  }

  // Host-only checks are insufficient here: a malicious local web server on a
  // different port can otherwise send simple POST requests with an accepted
  // localhost Origin. Require the request's exact protocol and port. Allow
  // loopback aliases because Electron may load localhost while a dev tool uses
  // 127.0.0.1 for the same bound server.
  const loopback = (host: string) =>
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  const sameHost =
    originUrl.hostname === requestUrl.hostname ||
    (loopback(originUrl.hostname) && loopback(requestUrl.hostname));
  const sameOrigin =
    originUrl.protocol === requestUrl.protocol &&
    originUrl.port === requestUrl.port &&
    sameHost;
  return sameOrigin ? null : "Cross-origin request rejected";
}

/**
 * Rejects requests whose `Host` header isn't loopback.
 *
 * The Origin check above compares against the request's own URL — which is
 * derived from the Host header — so a DNS-rebinding page (attacker domain
 * resolving to 127.0.0.1) produces an Origin and Host that match exactly and
 * slips through. Validating that the Host header itself names this server's
 * loopback interface closes rebinding completely: the attacker's fetches carry
 * their own domain as Host.
 *
 * Returns an error string to respond with, or null when the request is allowed.
 */
export function hostHeaderRejection(req: NextRequest): string | null {
  const host = req.headers.get("host");
  if (!host) return "Missing Host header";
  // Strip an IPv6 zone suffix if present; compare case-insensitively.
  const hostname = host.split("%")[0].toLowerCase();
  const isLoopbackHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1";
  // The embedded server binds only to 127.0.0.1; a non-loopback Host means the
  // request was addressed to some other name (e.g. a rebinding domain).
  return isLoopbackHost ? null : "Non-loopback Host rejected";
}
