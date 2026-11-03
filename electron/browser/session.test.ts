import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FiltersEngine } from "@ghostery/adblocker";
import { setupSession } from "./session.js";

type Listener = (...args: unknown[]) => void;

class FakeSession {
  events = new Map<string, Listener>();
  onRequest: ((wc: unknown, permission: string, callback: (ok: boolean) => void) => void) | null = null;
  onCheck: ((wc: unknown, permission: string) => boolean) | null = null;
  beforeRequest: ((details: object, callback: (response: object) => void) => void) | null = null;
  webRequest = {
    onBeforeRequest: (_filter: object, fn: FakeSession["beforeRequest"]) => { this.beforeRequest = fn; },
  };

  constructor(public userAgent: string) {}

  getUserAgent() { return this.userAgent; }
  setUserAgent(ua: string) { this.userAgent = ua; }
  setPermissionRequestHandler(fn: FakeSession["onRequest"]) { this.onRequest = fn; }
  setPermissionCheckHandler(fn: FakeSession["onCheck"]) { this.onCheck = fn; }
  on(event: string, fn: Listener) { this.events.set(event, fn); }
}

const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) marven/0.1.0 Chrome/146.0.0.0 Electron/41.0.0 Safari/537.36";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "marven-browser-session-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function setup(ses = new FakeSession(UA), options: Partial<Parameters<typeof setupSession>[1]> = {}) {
  const onBlocked = vi.fn();
  const onDownloadsChange = vi.fn();
  const result = setupSession(ses as never, { dir, isDisabledFor: () => false, onBlocked, onDownloadsChange, ...options });
  return { ses, onBlocked, onDownloadsChange, returned: result.ses, downloads: result.downloads, loadBlocker: result.loadBlocker };
}

// A fresh filter cache, so the blocker loads from disk instead of the network.
function writeFilterCache(rules: string) {
  const engine = FiltersEngine.parse(rules, { loadCosmeticFilters: false, loadNetworkFilters: true });
  fs.writeFileSync(path.join(dir, "adblock.bin"), Buffer.from(engine.serialize()));
}

function request(ses: FakeSession, url: string) {
  const callback = vi.fn();
  const pageUrl = "https://news.com/";
  const webContents = { isDestroyed: () => false, getURL: () => pageUrl };
  ses.beforeRequest!({ id: 1, url, resourceType: "script", referrer: pageUrl, webContentsId: 7, webContents }, callback);
  return callback.mock.calls[0][0];
}

describe("setupSession", () => {
  it("drops the app and Electron tokens from the user agent", () => {
    const { ses } = setup();
    expect(ses.userAgent).toBe("Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36");
  });

  it("denies every permission except sanitized clipboard writes", () => {
    const { ses } = setup();
    for (const permission of ["media", "geolocation", "notifications", "clipboard-read"]) {
      const callback = vi.fn();
      ses.onRequest!(null, permission, callback);
      expect(callback).toHaveBeenCalledWith(false);
      expect(ses.onCheck!(null, permission)).toBe(false);
    }
    const callback = vi.fn();
    ses.onRequest!(null, "clipboard-sanitized-write", callback);
    expect(callback).toHaveBeenCalledWith(true);
    expect(ses.onCheck!(null, "clipboard-sanitized-write")).toBe(true);
  });

  it("hands downloads to the download list", () => {
    const { ses, downloads } = setup();
    const handle = vi.spyOn(downloads, "handle").mockImplementation(() => {});
    const event = {};
    const item = {};
    const webContents = { id: 3 };
    ses.events.get("will-download")!(event, item, webContents);
    expect(handle).toHaveBeenCalledWith(event, item, webContents);
  });

  it("returns the session it set up", () => {
    const fake = new FakeSession(UA);
    expect(setup(fake).returned).toBe(fake);
  });

  it("attaches the blocker but loads its lists only when asked", () => {
    writeFilterCache("||ads.example.net^");
    const { ses, onBlocked, loadBlocker } = setup();

    expect(request(ses, "https://ads.example.net/a.js")).toEqual({});
    expect(onBlocked).not.toHaveBeenCalled();

    loadBlocker();
    expect(request(ses, "https://ads.example.net/a.js")).toEqual({ cancel: true });
    expect(onBlocked).toHaveBeenCalledWith(7);
    expect(request(ses, "https://cdn.news.com/app.js")).toEqual({});
  });

  it("loads the lists once", () => {
    writeFilterCache("||ads.example.net^");
    const { ses, loadBlocker } = setup();
    loadBlocker();
    writeFilterCache("||cdn.news.com^");
    loadBlocker();
    expect(request(ses, "https://cdn.news.com/app.js")).toEqual({});
    expect(request(ses, "https://ads.example.net/a.js")).toEqual({ cancel: true });
  });

  it("lets everything through on a site with blocking turned off", () => {
    writeFilterCache("||ads.example.net^");
    const isDisabledFor = vi.fn((host: string) => host === "news.com");
    const { ses, onBlocked, loadBlocker } = setup(undefined, { isDisabledFor });
    loadBlocker();
    expect(request(ses, "https://ads.example.net/a.js")).toEqual({});
    expect(isDisabledFor).toHaveBeenCalledWith("news.com");
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
