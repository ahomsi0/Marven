"use client";

import { PLATFORM_LABEL, type Platform } from "@/lib/platform";
import { formatDate, formatSize, type ReleaseInfo } from "@/lib/releases";
import { usePlatform, useRelease } from "@/lib/useRelease";
import { PLATFORM_ICON } from "./DownloadButton";
import { DownloadIcon } from "./Icons";

const ORDER: Platform[] = ["mac", "windows", "linux"];

const DETAILS: Record<Platform, { requirement: string; format: string; steps: React.ReactNode }> = {
  mac: {
    requirement: "Apple Silicon (M1 or later)",
    format: ".dmg",
    steps: (
      <>
        Open the DMG and drag Marven to Applications. Releases aren&apos;t signed with an Apple Developer ID yet, so the
        first launch is blocked: open <b>System Settings → Privacy &amp; Security</b> and click <b>Open Anyway</b>.
      </>
    ),
  },
  windows: {
    requirement: "Windows 10 or 11, 64-bit",
    format: ".exe installer",
    steps: (
      <>
        Run the installer and choose where to install. If SmartScreen warns about an unrecognised app, choose{" "}
        <b>More info → Run anyway</b>.
      </>
    ),
  },
  linux: {
    requirement: "x86-64",
    format: ".AppImage",
    steps: (
      <>
        Make it executable, then run it:
        <code className="mt-2 block rounded-md bg-bg-2 px-2.5 py-1.5 font-mono text-[12px] text-code">
          chmod +x Marven-*.AppImage
        </code>
      </>
    ),
  },
};

export function DownloadCards({ release: initial }: { release: ReleaseInfo }) {
  const release = useRelease(initial);
  const platform = usePlatform();
  const date = formatDate(release.publishedAt);

  return (
    <div className="mt-12">
      <p className="mb-4 font-mono text-xs text-dim">
        {release.version ? (
          <>
            Latest: <span className="text-ink-2">v{release.version}</span>
            {date && <> · released {date}</>} ·{" "}
            <a href={release.pageUrl} className="underline decoration-line-2 underline-offset-2 hover:text-ink-2">
              release notes
            </a>
          </>
        ) : (
          <>
            Couldn&apos;t reach GitHub just now, so these buttons open the{" "}
            <a href={release.pageUrl} className="underline decoration-line-2 underline-offset-2 hover:text-ink-2">
              latest release page
            </a>
            .
          </>
        )}
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {ORDER.map((p) => {
          const d = release.downloads[p];
          const Icon = PLATFORM_ICON[p];
          const mine = p === platform;
          const size = formatSize(d.size);
          return (
            <article
              key={p}
              className={`relative flex flex-col rounded-2xl border bg-panel p-6 transition ${
                mine ? "border-brand/50 shadow-[0_0_0_4px_var(--brand-soft)]" : "border-line hover:border-line-2"
              }`}
            >
              {mine && (
                <span className="absolute right-4 top-4 rounded-full bg-brand-soft px-2 py-0.5 font-mono text-[10.5px] text-brand">
                  Your system
                </span>
              )}
              <Icon size={26} className="text-ink" />
              <h2 className="mt-4 text-xl font-semibold text-ink">{PLATFORM_LABEL[p]}</h2>
              <p className="mt-1 text-sm text-dim">{DETAILS[p].requirement}</p>

              <a
                href={d.url}
                className={`mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-medium transition ${
                  mine ? "bg-brand text-on-brand hover:brightness-110" : "border border-line-2 bg-bg-2 text-ink hover:bg-panel-2"
                }`}
              >
                <DownloadIcon size={17} />
                Download {DETAILS[p].format}
              </a>
              <p className="mt-2 truncate text-center font-mono text-[11px] text-dim" title={d.fileName ?? undefined}>
                {d.fileName ? `${d.fileName}${size ? ` · ${size}` : ""}` : "opens the release page"}
              </p>

              <div className="mt-6 border-t border-line pt-5 text-sm leading-relaxed text-mute [&_b]:font-medium [&_b]:text-ink-2">
                {DETAILS[p].steps}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
