"use client";

import Link from "next/link";
import { PLATFORM_LABEL, type Platform } from "@/lib/platform";
import type { ReleaseInfo } from "@/lib/releases";
import { usePlatform, useRelease } from "@/lib/useRelease";
import { AppleIcon, ArrowRight, DownloadIcon, LinuxIcon, WindowsIcon } from "./Icons";

export const PLATFORM_ICON: Record<Platform, typeof AppleIcon> = {
  mac: AppleIcon,
  windows: WindowsIcon,
  linux: LinuxIcon,
};

const NOTE: Record<Platform, string> = {
  mac: "Apple Silicon",
  windows: "Windows 10 and 11",
  linux: "AppImage",
};

/**
 * The main call to action: a direct installer link for the visitor's OS, or a
 * link to /download when we can't tell (or before hydration).
 */
export function DownloadButton({ release: initial, size = "lg" }: { release: ReleaseInfo; size?: "lg" | "md" }) {
  const release = useRelease(initial);
  const platform = usePlatform();
  const pad = size === "lg" ? "h-12 px-5 text-[0.95rem]" : "h-10 px-4 text-sm";

  return (
    <div className="flex flex-col items-center gap-2.5 sm:items-start">
      {platform ? (
        <a
          href={release.downloads[platform].url}
          className={`group inline-flex items-center gap-2.5 rounded-xl bg-brand font-medium text-on-brand shadow-[0_8px_30px_-8px_var(--brand)] transition hover:brightness-110 ${pad}`}
        >
          {(() => {
            const Icon = PLATFORM_ICON[platform];
            return <Icon size={18} />;
          })()}
          Download for {PLATFORM_LABEL[platform]}
          <DownloadIcon size={17} className="opacity-70 transition group-hover:translate-y-0.5" />
        </a>
      ) : (
        <Link
          href="/download"
          className={`group inline-flex items-center gap-2.5 rounded-xl bg-brand font-medium text-on-brand shadow-[0_8px_30px_-8px_var(--brand)] transition hover:brightness-110 ${pad}`}
        >
          <DownloadIcon size={18} />
          Download Marven
          <ArrowRight className="transition group-hover:translate-x-0.5" />
        </Link>
      )}
      <p className="text-center font-mono text-xs text-dim sm:text-left">
        {release.version ? `v${release.version}` : "Latest release"}
        {platform ? ` · ${NOTE[platform]} · ` : " · macOS, Windows, Linux · "}
        <Link href="/download" className="underline decoration-line-2 underline-offset-2 hover:text-ink-2">
          {platform ? "other platforms" : "all downloads"}
        </Link>
      </p>
    </div>
  );
}
