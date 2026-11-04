// Web addresses Marven's agent may not open in its tabs:
// - Marven's own UI and API, at its window's origin or on the app port under
//   any loopback name. A page there passes the API's same-origin checks, so
//   an agent tab on it could make the agent drive Marven itself.
// - Private networks: private LAN, link-local (cloud metadata) and reserved
//   ranges, and names that only make sense on a local network (*.local, a
//   name without a dot). The same policy as fetch_url (lib/ssrfGuard.ts),
//   whose range checks are ported here since main can't import TypeScript,
//   except that nothing is resolved: a public name that resolves to a private
//   address gets through.
// Loopback is otherwise allowed (the user's own dev servers). The user's own
// tabs are unaffected. Nothing here imports Electron.

const OWN_ORIGIN = "That address is Marven itself; the agent can't open it.";
const PRIVATE_NETWORK = "That address is on a private network (or is reserved); the agent can't open it.";
// Names for hosts on a local network, never on the internet.
const LOCAL_SUFFIXES = ['local', 'lan', 'home', 'home.arpa', 'internal', 'intranet', 'corp'];
// Requests that load a page: the agent could read or click what they show.
const PAGE_REQUESTS = new Set(['mainFrame', 'subFrame']);
const WEB_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

function parseUrl(url) {
  try {
    const u = new URL(url);
    return WEB_PROTOCOLS.has(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

/** The port a URL connects to, with the scheme's default filled in. */
function portOf(u) {
  if (u.port) return Number(u.port);
  return u.protocol === 'https:' || u.protocol === 'wss:' ? 443 : 80;
}

// A URL's hostname (already normalised by the URL parser: lower-case, IPv4 in
// dotted quads, IPv6 compressed) without IPv6 brackets or a trailing dot.
const bare = (hostname) => String(hostname || '').replace(/^\[(.*)\]$/, '$1').replace(/\.$/, '');

function ipv4Parts(host) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const parts = host.split('.').map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

// Eight 16-bit groups, or null. The URL parser has already turned any dotted
// IPv4 tail into hex groups.
function ipv6Groups(host) {
  if (!host.includes(':')) return null;
  const halves = host.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if ([...left, ...right].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array(missing).fill('0'), ...right].map((g) => parseInt(g, 16));
}

// The IPv4 address an IPv4-mapped IPv6 address (::ffff:a.b.c.d) stands for.
function mappedIpv4(groups) {
  if (!groups.slice(0, 5).every((n) => n === 0) || groups[5] !== 0xffff) return null;
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff];
}

const loopbackIpv4 = ([a, b, c, d]) => a === 127 || (a === 0 && b === 0 && c === 0 && d === 0);

/** Whether a URL hostname always means this machine: localhost, *.localhost, 127/8, 0.0.0.0, ::1, ::. */
function isLoopbackHost(hostname) {
  const host = bare(hostname);
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  const v4 = ipv4Parts(host);
  if (v4) return loopbackIpv4(v4);
  const v6 = ipv6Groups(host);
  if (!v6) return false;
  if (v6.slice(0, 7).every((n) => n === 0) && v6[7] <= 1) return true; // :: and ::1
  const mapped = mappedIpv4(v6);
  return !!mapped && loopbackIpv4(mapped);
}

// Ranges fetch_url refuses (lib/ssrfGuard.ts), loopback left out.
function privateIpv4([a, b]) {
  if (a === 127) return false; // loopback
  return a === 0 // "this" network
    || a === 10 // private
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // link-local, cloud metadata
    || (a === 172 && b >= 16 && b <= 31) // private
    || (a === 192 && b === 0) // IETF protocol assignments
    || (a === 192 && b === 168) // private
    || (a === 198 && (b === 18 || b === 19)) // benchmarking
    || a >= 224; // multicast, reserved, broadcast
}

function privateIpv6(groups) {
  if (groups.every((n) => n === 0)) return true; // unspecified
  if (groups.slice(0, 7).every((n) => n === 0) && groups[7] === 1) return false; // loopback
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) follow the IPv4 rules.
  const v4 = mappedIpv4(groups) ?? (groups.slice(0, 6).every((n) => n === 0)
    ? [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff]
    : null);
  if (v4 && privateIpv4(v4)) return true;
  const first = groups[0];
  return (first & 0xfe00) === 0xfc00 // unique local
    || (first & 0xffc0) === 0xfe80 // link-local
    || (first & 0xffc0) === 0xfec0 // site-local (deprecated)
    || (first & 0xff00) === 0xff00; // multicast
}

/** Whether a URL hostname is on a private network or reserved (loopback isn't). */
function isPrivateHost(hostname) {
  const host = bare(hostname);
  if (!host) return false;
  const v4 = ipv4Parts(host);
  if (v4) return privateIpv4(v4);
  const v6 = ipv6Groups(host);
  if (v6) return privateIpv6(v6);
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  // A name without a dot is looked up on the local network (search domains).
  if (!host.includes('.')) return true;
  return LOCAL_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`));
}

/**
 * @param {{ appPorts: number[], appOrigins: () => string[] }} options `appPorts`
 *   are the ports Marven's own server listens on; `appOrigins` gives the
 *   window's current origin(s).
 */
function createAddressPolicy({ appPorts, appOrigins }) {
  function isOwnOrigin(url) {
    const u = parseUrl(url);
    if (!u) return false;
    const httpOrigin = `${u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol}//${u.host}`;
    if (appOrigins().some((origin) => origin && origin === httpOrigin)) return true;
    return isLoopbackHost(u.hostname) && appPorts.includes(portOf(u));
  }

  function isPrivate(url) {
    const u = parseUrl(url);
    return !!u && isPrivateHost(u.hostname);
  }

  /** Why the agent may not open `url` (a message for the model), or null if it may. */
  function refusal(url) {
    if (isOwnOrigin(url)) return OWN_ORIGIN;
    if (isPrivate(url)) return PRIVATE_NETWORK;
    return null;
  }

  /**
   * Whether an agent tab's request must be cancelled: anything to Marven's
   * own origin, and pages or frames on a private network.
   */
  function refusesRequest({ url, resourceType }) {
    return isOwnOrigin(url) || (PAGE_REQUESTS.has(resourceType) && isPrivate(url));
  }

  return { isOwnOrigin, refusal, refusesRequest };
}

module.exports = { createAddressPolicy, isLoopbackHost, isPrivateHost, portOf };
