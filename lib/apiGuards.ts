// Shared guards for the in-process Next.js API routes. These routes run on a
// 127.0.0.1-only server inside Electron, but several of them perform
// destructive filesystem operations, so we add defense-in-depth against any
// cross-origin caller (e.g. a page the renderer was tricked into loading).

import { NextRequest } from "next/server";

/** Header the Electron main process stamps on the app renderer's requests. */
export const API_TOKEN_HEADER = "x-marven-token";

/**
 * Compares two strings in time that depends only on their lengths, not on
 * where they first differ. Pure JS so it works in any middleware runtime.
 * (The token's length is fixed and public; only its content is secret.)
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Rejects a request that doesn't carry the per-launch API token.
 *
 * The server listens on 127.0.0.1, which ANY local program can reach, and a
 * non-browser caller can omit Origin and set Host to whatever it likes — so
 * the Origin/Host guards below only stop web pages. In the packaged app the
 * Electron main process generates a random token per launch, passes it to the
 * in-process server as MARVEN_API_TOKEN and adds it to every request the app
 * renderer makes to its own origin (electron/apiToken.js).
 *
 * When `expected` is unset (dev: `next dev` runs as a separate process and
 * never sees the token; plain browser preview) there is nothing to check and
 * the request is allowed, keeping development working.
 *
 * Returns an error string to respond with, or null when the request is allowed.
 */
export function apiTokenRejection(
  req: NextRequest,
  expected: string | undefined = process.env.MARVEN_API_TOKEN,
): string | null {
  if (!expected) return null;
  const provided = req.headers.get(API_TOKEN_HEADER);
  if (!provided) return "Missing API token";
  return constantTimeEqual(provided, expected) ? null : "Invalid API token";
}

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
  // The header carries the port (`localhost:47891`) and may be a bracketed IPv6
  // literal, so let URL split out the hostname (it also lowercases it).
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname;
  } catch {
    return "Non-loopback Host rejected";
  }
  const isLoopbackHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1";
  // The embedded server binds only to 127.0.0.1; a non-loopback Host means the
  // request was addressed to some other name (e.g. a rebinding domain).
  return isLoopbackHost ? null : "Non-loopback Host rejected";
}
