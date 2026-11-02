import { describe, it, expect } from "vitest";
import { FiltersEngine } from "@ghostery/adblocker";
import { isCacheFresh, decide, CACHE_MAX_AGE_MS } from "./blocker.js";

describe("blocker", () => {
  it("treats the cache as fresh for a week", () => {
    expect(isCacheFresh(1000, 1000 + CACHE_MAX_AGE_MS - 1)).toBe(true);
    expect(isCacheFresh(1000, 1000 + CACHE_MAX_AGE_MS)).toBe(false);
  });

  const engine = FiltersEngine.parse("||ads.example.net^\n||tracker.example.org^$third-party", {
    loadCosmeticFilters: false,
    loadNetworkFilters: true,
  });
  const details = (url: string, resourceType = "script") => ({ id: 1, url, resourceType, referrer: "", webContentsId: 7 });

  it("blocks matching third-party requests", () => {
    expect(decide(engine, details("https://ads.example.net/a.js"), "https://news.com/", false)).toEqual({ cancel: true });
    expect(decide(engine, details("https://tracker.example.org/p.gif", "image"), "https://news.com/", false)).toEqual({ cancel: true });
  });

  it("lets everything else through", () => {
    expect(decide(engine, details("https://cdn.news.com/app.js"), "https://news.com/", false)).toBeNull();
    expect(decide(engine, details("https://ads.example.net/", "mainFrame"), "https://news.com/", false)).toBeNull();
    expect(decide(null, details("https://ads.example.net/a.js"), "https://news.com/", false)).toBeNull();
  });

  it("never blocks on a site the user turned blocking off for", () => {
    expect(decide(engine, details("https://ads.example.net/a.js"), "https://news.com/", true)).toBeNull();
  });
});
