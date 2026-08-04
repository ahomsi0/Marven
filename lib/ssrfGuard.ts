// SSRF guard for the fetch_url agent tool. Marven is a local-first desktop
// assistant, so fetching the user's OWN local dev server (http://localhost:PORT)
// is a legitimate, common action and is intentionally allowed. What we block is
// the classic SSRF pivot surface an injected prompt could abuse: cloud-metadata
// / link-local (169.254.0.0/16), private LAN ranges, other reserved space,
// URLs carrying embedded credentials, and public→internal redirect bypasses.

import net from "net";
import { lookup } from "dns/promises";

/** True when an IP literal must NOT be fetched. Loopback is intentionally allowed. */
export function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP → block to be safe
}

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 127) return false; // loopback — intentionally allowed (local dev servers)
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local + cloud metadata 169.254/16
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 0) return true; // 192.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 168) return true; // private
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4) + broadcast
  return false;
}

function isBlockedIpv6(raw: string): boolean {
  const ip = raw.toLowerCase().split("%")[0]; // drop zone id
  if (ip === "::1") return false; // loopback — allowed
  if (ip === "::" || ip === "") return true; // unspecified
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local fc00::/7
  if (/^fe[89ab]/.test(ip)) return true; // link-local fe80::/10
  if (ip.startsWith("ff")) return true; // multicast
  return false;
}

/**
 * Validates a URL is safe to fetch. Throws with a descriptive message otherwise.
 * Resolves the hostname and blocks if ANY resolved address is disallowed
 * (defends against a domain that points at an internal address).
 */
export async function assertFetchableUrl(urlStr: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs are supported");
  }
  if (url.username || url.password) {
    throw new Error("URLs with embedded credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new Error("Refusing to fetch a private/reserved address");
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new Error(`Could not resolve host: ${host}`);
  }
  if (addresses.length === 0 || addresses.some((a) => isBlockedIp(a.address))) {
    throw new Error("Host resolves to a private/reserved address");
  }
}

/**
 * fetch() with SSRF validation on every hop. Redirects are followed manually so
 * a public URL cannot 30x-redirect into an internal address.
 */
export async function safeFetch(
  urlStr: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  let current = urlStr;
  let redirectsLeft = opts.maxRedirects ?? 5;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await assertFetchableUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      if (redirectsLeft-- <= 0) throw new Error("Too many redirects");
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
}
