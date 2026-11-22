"use client";

import Link from "next/link";
import { PLATFORM_LABEL, type Platform } from "@/lib/platform";
import type { ReleaseInfo } from "@/lib/releases";
import { usePlatform, useRelease } from "@/lib/useRelease";
import { AppleIcon, ArrowRight, DownloadIcon, GitHubIcon, LinuxIcon, WindowsIcon } from "./Icons";

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
 * The main call to action: a direct installer link for the visitor's OS (or
 * a link to /download when we can't tell, or before hydration), a secondary
 * GitHub button beside it, and one centred line of release details below.
 */
export function DownloadCta({
  release: initial,
  secondary,
}: {
  release: ReleaseInfo;
  secondary: { href: string; label: string; className?: string };
}) {
  const release = useRelease(initial);
  const platform = usePlatform();
  const primary =
    "group inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-brand px-5 text-[0.95rem] font-medium text-on-brand shadow-[0_8px_30px_-8px_var(--brand)] transition hover:brightness-110";

  return (
    <div className="flex flex-col items-center gap-3.5">
      <div className="flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
        {platform ? (
          <a href={release.downloads[platform].url} className={primary}>
            {(() => {
              const Icon = PLATFORM_ICON[platform];
              return <Icon size={18} />;
            })()}
            Download for {PLATFORM_LABEL[platform]}
            <DownloadIcon size={17} className="opacity-70 transition group-hover:translate-y-0.5" />
          </a>
        ) : (
          <Link href="/download" className={primary}>
            <DownloadIcon size={18} />
            Download Marven
            <ArrowRight className="transition group-hover:translate-x-0.5" />
          </Link>
        )}
        <a
          href={secondary.href}
          className={`inline-flex h-12 items-center justify-center gap-2.5 rounded-xl border border-line-2 px-5 text-[0.95rem] font-medium text-ink transition hover:bg-panel-2 ${secondary.className ?? "bg-panel/70 backdrop-blur"}`}
        >
          <GitHubIcon />
          {secondary.label}
        </a>
      </div>
      <p className="text-center font-mono text-xs text-dim">
        {release.version ? `v${release.version}` : "Latest release"}
        {platform ? ` · ${NOTE[platform]} · ` : " · macOS, Windows, Linux · "}
        <Link href="/download" className="underline decoration-line-2 underline-offset-2 hover:text-ink-2">
          {platform ? "other platforms" : "all downloads"}
        </Link>
      </p>
    </div>
  );
}
