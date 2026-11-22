import { LATEST_RELEASE_URL, REPO } from "./site";
import type { Platform } from "./platform";

export interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  published_at: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: GitHubAsset[];
}

export interface Download {
  url: string;
  /** null when we fell back to the releases page. */
  fileName: string | null;
  size: number | null;
}

export interface ReleaseInfo {
  /** "2.15.0", or null when the release couldn't be fetched. */
  version: string | null;
  publishedAt: string | null;
  pageUrl: string;
  downloads: Record<Platform, Download>;
}

const FALLBACK_DOWNLOAD: Download = { url: LATEST_RELEASE_URL, fileName: null, size: null };

export const FALLBACK_RELEASE: ReleaseInfo = {
  version: null,
  publishedAt: null,
  pageUrl: LATEST_RELEASE_URL,
  downloads: { mac: FALLBACK_DOWNLOAD, windows: FALLBACK_DOWNLOAD, linux: FALLBACK_DOWNLOAD },
};

const isInstaller: Record<Platform, (name: string) => boolean> = {
  // Only Apple Silicon builds are published; prefer arm64 if both ever exist.
  mac: (n) => n.endsWith(".dmg"),
  windows: (n) => n.endsWith(".exe"),
  linux: (n) => n.endsWith(".AppImage"),
};

function pick(assets: GitHubAsset[], platform: Platform): Download {
  const matches = assets.filter((a) => isInstaller[platform](a.name));
  if (platform === "mac") matches.sort((a, b) => Number(b.name.includes("arm64")) - Number(a.name.includes("arm64")));
  const asset = matches[0];
  return asset ? { url: asset.browser_download_url, fileName: asset.name, size: asset.size } : FALLBACK_DOWNLOAD;
}

/** Turns a GitHub release into the installer link for each platform. */
export function toReleaseInfo(release: GitHubRelease): ReleaseInfo {
  return {
    version: release.tag_name.replace(/^v/, ""),
    publishedAt: release.published_at,
    pageUrl: release.html_url,
    downloads: {
      mac: pick(release.assets, "mac"),
      windows: pick(release.assets, "windows"),
      linux: pick(release.assets, "linux"),
    },
  };
}

export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/**
 * The latest published release. Never throws: if GitHub is unreachable or
 * rate-limited, every download points at the releases page instead.
 */
export async function getLatestRelease(fetchImpl: typeof fetch = fetch, token?: string): Promise<ReleaseInfo> {
  try {
    const res = await fetchImpl(LATEST_RELEASE_API, {
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return FALLBACK_RELEASE;
    const release = (await res.json()) as GitHubRelease;
    if (!release?.tag_name || !Array.isArray(release.assets)) return FALLBACK_RELEASE;
    return toReleaseInfo(release);
  } catch {
    return FALLBACK_RELEASE;
  }
}

/** Build-time fetch; uses GITHUB_TOKEN when set to avoid the anonymous rate limit. */
export function getLatestReleaseAtBuild(): Promise<ReleaseInfo> {
  return getLatestRelease(fetch, process.env.GITHUB_TOKEN);
}

export function formatSize(bytes: number | null): string | null {
  if (bytes == null) return null;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}
