"use client";

import { useEffect, useState } from "react";
import { detectCurrentPlatform, type Platform } from "./platform";
import { getLatestRelease, type ReleaseInfo } from "./releases";

const CACHE_KEY = "marven-release";
const CACHE_MS = 30 * 60 * 1000;

/**
 * The release baked in at build time, refreshed from GitHub in the browser so
 * a new Marven release shows up without redeploying the site. One request per
 * visitor per half hour; any failure keeps the build-time data.
 */
export function useRelease(initial: ReleaseInfo): ReleaseInfo {
  const [release, setRelease] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? "null") as { at: number; info: ReleaseInfo } | null;
      if (cached && Date.now() - cached.at < CACHE_MS) {
        if (cached.info.version) setRelease(cached.info);
        return;
      }
    } catch {
      // Storage blocked or corrupt: just fetch.
    }
    getLatestRelease().then((info) => {
      if (cancelled || !info.version) return;
      setRelease(info);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), info }));
      } catch {}
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return release;
}

/** The visitor's desktop OS; null during SSR and for phones / unknown systems. */
export function usePlatform(): Platform | null {
  const [platform, setPlatform] = useState<Platform | null>(null);
  useEffect(() => setPlatform(detectCurrentPlatform()), []);
  return platform;
}
