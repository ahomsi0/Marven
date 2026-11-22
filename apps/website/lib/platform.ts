export type Platform = "mac" | "windows" | "linux";

export const PLATFORM_LABEL: Record<Platform, string> = {
  mac: "macOS",
  windows: "Windows",
  linux: "Linux",
};

export interface PlatformHints {
  userAgent?: string;
  /** navigator.platform (deprecated but still widely available). */
  platform?: string;
  /** navigator.userAgentData.platform, where supported. */
  uaPlatform?: string;
}

/**
 * The desktop OS the visitor is on, or null for phones, tablets and anything
 * unrecognised (Marven has no mobile build, so those get the generic choice).
 */
export function detectPlatform({ userAgent = "", platform = "", uaPlatform = "" }: PlatformHints): Platform | null {
  const ua = userAgent.toLowerCase();
  // Mobile first: Android UAs contain "Linux", and iPadOS can claim "Macintosh".
  if (/android|iphone|ipad|ipod|mobile/.test(ua)) return null;
  if (platform === "MacIntel" && /macintosh/.test(ua) && hasTouch()) return null;

  const hint = `${uaPlatform} ${platform} ${ua}`.toLowerCase();
  if (/mac|darwin/.test(hint)) return "mac";
  if (/win/.test(hint)) return "windows";
  if (/linux|x11|cros/.test(hint)) return "linux";
  return null;
}

function hasTouch(): boolean {
  return typeof navigator !== "undefined" && navigator.maxTouchPoints > 1;
}

export function detectCurrentPlatform(): Platform | null {
  if (typeof navigator === "undefined") return null;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return detectPlatform({
    userAgent: nav.userAgent,
    platform: nav.platform,
    uaPlatform: nav.userAgentData?.platform,
  });
}
