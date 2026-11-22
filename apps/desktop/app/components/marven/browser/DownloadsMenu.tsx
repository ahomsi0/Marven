"use client";

import { useT } from "@/lib/i18n";
import type { BrowserBridge, BrowserDownload } from "@/lib/inAppBrowser";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// "Finder" is macOS wording; other platforms get a generic label.
const isMac =
  typeof window !== "undefined" &&
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).marvenElectron?.platform === "darwin";

export function DownloadsMenu({ bridge, downloads }: { bridge: BrowserBridge; downloads: BrowserDownload[] }) {
  const { t } = useT();

  return (
    <div className="absolute end-0 top-full z-30 mt-1 w-72 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] p-1.5 shadow-lg">
      {downloads.length === 0 ? (
        <p className="px-2 py-3 text-center text-[12px] text-[var(--m-text-faint)]">{t("browser.noDownloads")}</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto">
          {[...downloads].reverse().map((d) => {
            const pct = d.totalBytes > 0 ? Math.round((d.receivedBytes / d.totalBytes) * 100) : null;
            const status =
              d.state === "progressing"
                ? pct !== null ? `${pct}%` : formatBytes(d.receivedBytes)
                : d.state === "blocked"
                  ? t("browser.downloadBlocked", { n: d.count ?? 1 })
                  : d.state === "completed"
                  ? t("browser.downloadDone")
                  : d.state === "cancelled"
                    ? t("browser.downloadCancelled")
                    : t("browser.downloadFailed");
            return (
              <li key={d.id} className="rounded-md px-2 py-1.5">
                <p dir="auto" className="truncate text-[12px] text-[var(--m-text)]">{d.filename}</p>
                {d.state === "progressing" && (
                  <div className="mt-1 h-1 overflow-hidden rounded bg-[var(--m-surface-3)]">
                    <div className="h-full bg-[var(--m-accent)] transition-[width]" style={{ width: `${pct ?? 0}%` }} />
                  </div>
                )}
                <div className="mt-1 flex items-center justify-between text-[11px] text-[var(--m-text-faint)]">
                  <span className="tabular-nums">{status}</span>
                  {d.state === "progressing" ? (
                    <button type="button" onClick={() => bridge.cancelDownload(d.id)} className="hover:text-[var(--m-text)]">
                      {t("browser.cancel")}
                    </button>
                  ) : d.state === "completed" ? (
                    <button type="button" onClick={() => bridge.showDownload(d.id)} className="hover:text-[var(--m-text)]">
                      {t(isMac ? "browser.showInFolder" : "browser.showInFolderOther")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
