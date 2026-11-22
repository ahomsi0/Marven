import { describe, it, expect, vi, afterEach } from "vitest";
import { isBlockedIp, assertFetchableUrl, safeFetch, RedirectNotFollowedError } from "./ssrfGuard";

describe("isBlockedIp", () => {
  it("allows loopback (local dev servers)", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(false);
    expect(isBlockedIp("127.9.9.9")).toBe(false);
    expect(isBlockedIp("::1")).toBe(false);
  });

  it("blocks cloud-metadata / link-local", () => {
    expect(isBlockedIp("169.254.169.254")).toBe(true);
    expect(isBlockedIp("169.254.0.1")).toBe(true);
  });

  it("blocks private LAN ranges", () => {
    expect(isBlockedIp("10.0.0.5")).toBe(true);
    expect(isBlockedIp("192.168.1.10")).toBe(true);
    expect(isBlockedIp("172.16.0.1")).toBe(true);
    expect(isBlockedIp("172.31.255.255")).toBe(true);
    expect(isBlockedIp("100.64.0.1")).toBe(true);
  });

  it("does not block public-ish 172 addresses outside 172.16/12", () => {
    expect(isBlockedIp("172.15.0.1")).toBe(false);
    expect(isBlockedIp("172.32.0.1")).toBe(false);
  });

  it("blocks reserved / multicast / unspecified", () => {
    expect(isBlockedIp("0.0.0.0")).toBe(true);
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("255.255.255.255")).toBe(true);
    expect(isBlockedIp("::")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("1.1.1.1")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks IPv6 ULA and link-local (incl v4-mapped)", () => {
    expect(isBlockedIp("fd00::1")).toBe(true);
    expect(isBlockedIp("fe80::1")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:10.0.0.1")).toBe(true);
  });

  it("blocks equivalent expanded IPv6 loopback and mapped private forms", () => {
    expect(isBlockedIp("0:0:0:0:0:0:0:1")).toBe(false);
    expect(isBlockedIp("0:0:0:0:0:ffff:7f00:1")).toBe(false);
    expect(isBlockedIp("0:0:0:0:0:ffff:c0a8:0101")).toBe(true);
    expect(isBlockedIp("fe80:0:0:0:0:0:0:1")).toBe(true);
  });
});

describe("assertFetchableUrl", () => {
  it("rejects non-http(s) schemes", async () => {
    await expect(assertFetchableUrl("file:///etc/passwd")).rejects.toThrow();
    await expect(assertFetchableUrl("gopher://x")).rejects.toThrow();
  });

  it("rejects embedded credentials", async () => {
    await expect(assertFetchableUrl("http://user:pass@example.com/")).rejects.toThrow(
      /credentials/i,
    );
  });

  it("rejects IP-literal metadata endpoint", async () => {
    await expect(assertFetchableUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      /private|reserved/i,
    );
  });

  it("rejects private IP literal", async () => {
    await expect(assertFetchableUrl("http://192.168.0.1/")).rejects.toThrow(/private|reserved/i);
  });

  it("allows a loopback IP literal", async () => {
    await expect(assertFetchableUrl("http://127.0.0.1:3000/")).resolves.toBeUndefined();
  });
});

describe("safeFetch redirect policy", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubRedirects(map: Record<string, string>) {
    const fetchMock = vi.fn(async (url: string) => {
      const target = map[url];
      return target
        ? new Response(null, { status: 302, headers: { location: target } })
        : new Response("final", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("stops at a redirect the caller doesn't allow and reports where it pointed", async () => {
    const fetchMock = stubRedirects({ "http://127.0.0.1:3000/login": "http://8.8.8.8/collect?d=data" });
    const err = await safeFetch("http://127.0.0.1:3000/login", {}, {
      allowRedirect: (to, from) => to.hostname === from.hostname,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(RedirectNotFollowedError);
    expect((err as RedirectNotFollowedError).location).toBe("http://8.8.8.8/collect?d=data");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows redirects the caller allows, and all redirects without a policy", async () => {
    const fetchMock = stubRedirects({ "http://127.0.0.1:3000/a": "/b", "http://127.0.0.1:3000/b": "http://8.8.8.8/" });
    const res = await safeFetch("http://127.0.0.1:3000/a", {}, { allowRedirect: () => true });
    expect(await res.text()).toBe("final");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockClear();
    await safeFetch("http://127.0.0.1:3000/a");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
