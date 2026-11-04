import { describe, expect, it } from "vitest";
import { createAddressPolicy, isLoopbackHost, isPrivateHost, portOf } from "./addresses.js";

describe("isLoopbackHost", () => {
  it("knows every loopback name a URL can carry", () => {
    for (const host of [
      "localhost", "localhost.", "app.localhost", "a.b.localhost", "127.0.0.1", "127.0.0.2", "127.255.255.254", "0.0.0.0",
      "[::1]", "[::]", "[::ffff:7f00:1]", "[::ffff:0:0]",
    ]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("leaves every other host alone", () => {
    for (const host of ["example.com", "localhost.example.com", "notlocalhost", "128.0.0.1", "10.0.0.1", "[::2]", "[fe80::1]", ""]) {
      expect(isLoopbackHost(host), host).toBe(false);
    }
  });
});

describe("isPrivateHost", () => {
  it("blocks private LAN, link-local, cloud metadata and reserved addresses", () => {
    for (const host of [
      "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255",
      "0.0.0.0", "0.1.2.3", "192.0.0.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
      "[fc00::1]", "[fd12:3456::1]", "[fe80::1]", "[febf::1]", "[fec0::1]", "[ff02::1]", "[::]",
      "[::ffff:c0a8:101]", "[::ffff:a9fe:a9fe]", "[::c0a8:101]",
    ]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
  });

  it("blocks names that only make sense on a local network", () => {
    for (const host of ["printer.local", "nas.lan", "router.home.arpa", "metadata.google.internal", "wiki.intranet", "files.corp", "box.home", "router", "router."]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
  });

  it("allows loopback and public addresses", () => {
    for (const host of [
      "localhost", "dev.localhost", "127.0.0.1", "[::1]", "[::ffff:7f00:1]", "example.com", "8.8.8.8", "172.32.0.1", "172.15.255.255",
      "192.169.0.1", "100.63.255.255", "100.128.0.1", "169.255.0.1", "[2001:4860:4860::8888]", "local.example.com", "localhost.example.com",
    ]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });
});

describe("portOf", () => {
  it("fills in the scheme's default port", () => {
    expect(portOf(new URL("http://localhost/"))).toBe(80);
    expect(portOf(new URL("https://localhost/"))).toBe(443);
    expect(portOf(new URL("ws://localhost/"))).toBe(80);
    expect(portOf(new URL("wss://localhost/"))).toBe(443);
    expect(portOf(new URL("http://localhost:3000/"))).toBe(3000);
  });
});

describe("Marven's own origins", () => {
  const policy = createAddressPolicy({ appPorts: [3000], appOrigins: () => ["http://marven.test:8080"] });

  it("refuses the app port under every loopback name, and the window's own origin", () => {
    for (const url of [
      "http://localhost:3000/", "http://localhost:3000/api/agent/stream", "http://127.0.0.1:3000/", "http://[::1]:3000/",
      "http://0.0.0.0:3000/", "http://marven.localhost:3000/", "http://LOCALHOST.:3000/", "http://127.1:3000/",
      "http://0x7f000001:3000/", "http://[::ffff:127.0.0.1]:3000/", "https://localhost:3000/", "ws://localhost:3000/_next/webpack-hmr",
      "http://marven.test:8080/settings",
    ]) {
      expect(policy.isOwnOrigin(url), url).toBe(true);
      expect(policy.refusal(url), url).toBe("That address is Marven itself; the agent can't open it.");
    }
  });

  it("allows other loopback ports and other sites", () => {
    for (const url of ["http://localhost:3001/", "http://127.0.0.1:5173/", "http://localhost/", "https://example.com:3000/", "http://marven.test/"]) {
      expect(policy.isOwnOrigin(url), url).toBe(false);
      expect(policy.refusal(url), url).toBeNull();
    }
  });

  it("ignores what isn't a web address", () => {
    for (const url of ["about:blank", "data:text/html,hi", "not a url", "file:///etc/hosts"]) {
      expect(policy.isOwnOrigin(url), url).toBe(false);
      expect(policy.refusal(url), url).toBeNull();
    }
  });

  it("follows the window when it moves", () => {
    let origins: string[] = [];
    const moving = createAddressPolicy({ appPorts: [47891], appOrigins: () => origins });
    expect(moving.isOwnOrigin("http://127.0.0.1:47891/")).toBe(true);
    expect(moving.isOwnOrigin("http://app.test/")).toBe(false);
    origins = ["http://app.test", ""];
    expect(moving.isOwnOrigin("http://app.test/x")).toBe(true);
  });
});

describe("private networks", () => {
  const policy = createAddressPolicy({ appPorts: [3000], appOrigins: () => [] });

  it("refuses private and reserved addresses, with their own message", () => {
    for (const url of ["http://192.168.1.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5:8080/admin", "https://printer.local/", "http://[fe80::1]/", "http://0xa9fea9fe/", "http://router/"]) {
      expect(policy.refusal(url), url).toBe("That address is on a private network (or is reserved); the agent can't open it.");
    }
    expect(policy.refusal("http://127.0.0.1:5173/")).toBeNull();
    expect(policy.refusal("https://example.com/")).toBeNull();
  });

  it("says Marven's own origin first", () => {
    expect(policy.refusal("http://0.0.0.0:3000/")).toBe("That address is Marven itself; the agent can't open it.");
  });
});

describe("agent requests", () => {
  const policy = createAddressPolicy({ appPorts: [3000], appOrigins: () => [] });

  it("cancels every request to Marven's own origin", () => {
    for (const resourceType of ["mainFrame", "subFrame", "xhr", "script", "webSocket"]) {
      expect(policy.refusesRequest({ url: "http://localhost:3000/api/agent/approve", resourceType }), resourceType).toBe(true);
    }
    expect(policy.refusesRequest({ url: "http://localhost:5173/", resourceType: "mainFrame" })).toBe(false);
    expect(policy.refusesRequest({ url: "https://example.com/", resourceType: "mainFrame" })).toBe(false);
  });

  it("cancels pages and frames on private networks, not a public page's other requests", () => {
    expect(policy.refusesRequest({ url: "http://192.168.1.1/", resourceType: "mainFrame" })).toBe(true);
    expect(policy.refusesRequest({ url: "http://192.168.1.1/", resourceType: "subFrame" })).toBe(true);
    expect(policy.refusesRequest({ url: "http://192.168.1.1/pixel.gif", resourceType: "image" })).toBe(false);
  });
});
