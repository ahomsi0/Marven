import { describe, expect, it, vi } from "vitest";
import { FALLBACK_RELEASE, formatDate, formatSize, getLatestRelease, toReleaseInfo, type GitHubRelease } from "./releases";

const asset = (name: string, size = 100) => ({ name, size, browser_download_url: `https://dl/${name}` });

const release: GitHubRelease = {
  tag_name: "v2.15.0",
  html_url: "https://github.com/ahomsi0/Marven/releases/tag/v2.15.0",
  published_at: "2026-11-06T08:17:08Z",
  assets: [
    asset("latest-mac.yml"),
    asset("Marven-2.15.0-arm64-mac.zip"),
    asset("Marven-2.15.0-arm64.dmg", 150_000_000),
    asset("Marven-2.15.0-arm64.dmg.blockmap"),
    asset("Marven-2.15.0.AppImage"),
    asset("Marven-Setup-2.15.0.exe"),
    asset("Marven-Setup-2.15.0.exe.blockmap"),
  ],
};

describe("toReleaseInfo", () => {
  it("picks the installer for each platform, not blockmaps, zips or update manifests", () => {
    const info = toReleaseInfo(release);
    expect(info.version).toBe("2.15.0");
    expect(info.downloads.mac.fileName).toBe("Marven-2.15.0-arm64.dmg");
    expect(info.downloads.mac.size).toBe(150_000_000);
    expect(info.downloads.windows.fileName).toBe("Marven-Setup-2.15.0.exe");
    expect(info.downloads.linux.fileName).toBe("Marven-2.15.0.AppImage");
  });

  it("prefers the arm64 DMG when an Intel one is also published", () => {
    const info = toReleaseInfo({ ...release, assets: [asset("Marven-2.16.0.dmg"), asset("Marven-2.16.0-arm64.dmg")] });
    expect(info.downloads.mac.fileName).toBe("Marven-2.16.0-arm64.dmg");
  });

  it("falls back to the releases page for a platform with no installer", () => {
    const info = toReleaseInfo({ ...release, assets: [asset("Marven-2.15.0.AppImage")] });
    expect(info.downloads.mac).toEqual(FALLBACK_RELEASE.downloads.mac);
    expect(info.downloads.linux.fileName).toBe("Marven-2.15.0.AppImage");
  });
});

describe("getLatestRelease", () => {
  it("returns the parsed release", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(release), { status: 200 }));
    const info = await getLatestRelease(fetchImpl as unknown as typeof fetch, "tok");
    expect(info.version).toBe("2.15.0");
    const init = (fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("falls back on HTTP errors, bad JSON shapes and network failures", async () => {
    const notOk = vi.fn(async () => new Response("rate limited", { status: 403 }));
    const badShape = vi.fn(async () => new Response(JSON.stringify({ message: "Not Found" }), { status: 200 }));
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    for (const f of [notOk, badShape, offline]) {
      expect(await getLatestRelease(f as unknown as typeof fetch)).toEqual(FALLBACK_RELEASE);
    }
  });
});

describe("formatting", () => {
  it("formats sizes and dates", () => {
    expect(formatSize(null)).toBeNull();
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatSize(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatDate("2026-11-06T08:17:08Z")).toBe("November 6, 2026");
    expect(formatDate("nope")).toBeNull();
  });
});
