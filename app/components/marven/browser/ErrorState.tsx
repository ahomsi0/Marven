"use client";

import { GlobeIcon } from "../Icons";
import { useT } from "@/lib/i18n";
import type { BrowserError } from "@/lib/inAppBrowser";

/** Shown in place of the page when the active tab failed to load or crashed. */
export function ErrorState({ error, onRetry }: { error: BrowserError; onRetry: () => void }) {
  const { t } = useT();
  const title =
    error.kind === "certificate"
      ? t("browser.errorCertificate")
      : error.kind === "crashed"
        ? t("browser.errorCrashed")
        : t("browser.errorUnreachable");

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <GlobeIcon className="h-8 w-8 text-[var(--m-text-faint)]" />
      <p className="text-[14px] font-medium text-[var(--m-text)]">{title}</p>
      <p dir="ltr" className="max-w-[320px] break-words font-mono text-[11px] text-[var(--m-text-faint)]">
        {error.description}
      </p>
      {error.kind !== "certificate" && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-[var(--m-border)] px-3 py-1 text-[12px] text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-2)]"
        >
          {error.kind === "crashed" ? t("browser.reload") : t("browser.retry")}
        </button>
      )}
    </div>
  );
}
