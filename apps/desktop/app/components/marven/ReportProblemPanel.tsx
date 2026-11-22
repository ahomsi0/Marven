"use client";

import { useEffect, useMemo, useState } from "react";
import packageJson from "@/package.json";
import { useT } from "@/lib/i18n";
import { buildProblemReport, type ReportAppInfo } from "@/lib/problemReport";
import { redactLines } from "@/lib/redact";
import { loadChatModelMap, loadChatProvider } from "@/lib/modelPrefs";

interface ElectronBridge {
  platform?: string;
  openExternal?: (url: string, browser: string) => Promise<unknown>;
  getRecentLogs?: () => Promise<unknown>;
}

function bridge(): ElectronBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { marvenElectron?: ElectronBridge }).marvenElectron ?? null;
}

function currentAppInfo(): ReportAppInfo {
  const el = bridge();
  const platform = el?.platform ?? (typeof navigator !== "undefined" ? navigator.platform : "") ?? "";
  const provider = loadChatProvider();
  const model = provider ? loadChatModelMap()?.[provider] || null : null;
  return {
    version: packageJson.version,
    platform: `${platform || "unknown"}${el ? "" : " (browser)"}`,
    provider,
    model,
  };
}

function openExternal(url: string) {
  const el = bridge();
  if (el?.openExternal) void el.openExternal(url, "default").catch(() => {});
  else window.open(url, "_blank", "noopener,noreferrer");
}

type LogsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; lines: string[] };

/**
 * "Report a problem": a description, optional app info and recent logs, and
 * two ways out — open a prefilled GitHub issue or copy the report. Nothing is
 * sent from the app. Used in Settings → About and as a standalone dialog.
 */
export function ReportProblemPanel({ onClose }: { onClose?: () => void }) {
  const { t: tr } = useT();
  const [description, setDescription] = useState("");
  const [includeAppInfo, setIncludeAppInfo] = useState(true);
  const [includeLogs, setIncludeLogs] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [logs, setLogs] = useState<LogsState>({ status: "idle" });
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [appInfo] = useState<ReportAppInfo>(currentAppInfo);

  // Fetch logs the first time they're asked for.
  useEffect(() => {
    if (!includeLogs || logs.status !== "idle") return;
    const el = bridge();
    if (!el?.getRecentLogs) {
      setLogs({ status: "unavailable" });
      return;
    }
    setLogs({ status: "loading" });
    el.getRecentLogs()
      .then((raw) => {
        const lines = Array.isArray(raw) ? raw.filter((l): l is string => typeof l === "string") : [];
        // The main process already redacts; do it again here so the preview
        // can never show something the report wouldn't.
        setLogs({ status: "ready", lines: redactLines(lines) });
      })
      .catch(() => setLogs({ status: "ready", lines: [] }));
  }, [includeLogs, logs.status]);

  const logLines = includeLogs && logs.status === "ready" ? logs.lines : null;
  const report = useMemo(
    () => buildProblemReport({ description, appInfo: includeAppInfo ? appInfo : null, logs: logLines }),
    [description, includeAppInfo, appInfo, logLines],
  );

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(`# ${report.title}\n\n${report.body}`);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    setTimeout(() => setCopyState("idle"), 1800);
  }

  const checkboxRow = (
    checked: boolean,
    onChange: (v: boolean) => void,
    label: string,
    hint: string,
  ) => (
    <label className="flex cursor-pointer items-start gap-2 text-[12px] text-[var(--m-text)]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[var(--m-accent)]"
      />
      <span>
        {label}
        <span className="block text-[10px] text-[var(--m-text-faint)]">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-3">
      <textarea
        autoFocus
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) openExternal(report.url);
          if (e.key === "Escape" && onClose) {
            e.stopPropagation();
            onClose();
          }
        }}
        placeholder={tr("settings.report.placeholder")}
        aria-label={tr("settings.report.placeholder")}
        rows={5}
        className="w-full resize-y rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] px-3 py-2 text-[12px] text-[var(--m-text)] placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)] focus:outline-none"
      />

      <div className="space-y-2">
        {checkboxRow(includeAppInfo, setIncludeAppInfo, tr("settings.report.includeAppInfo"), tr("settings.report.includeAppInfoHint"))}
        {checkboxRow(includeLogs, setIncludeLogs, tr("settings.report.includeLogs"), tr("settings.report.includeLogsHint"))}
      </div>

      {(includeAppInfo || includeLogs) && (
        <div>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            aria-expanded={showPreview}
            className="text-[11px] text-[var(--m-accent)] hover:underline"
          >
            {showPreview ? tr("settings.report.hidePreview") : tr("settings.report.showPreview")}
          </button>
          {showPreview && (
            <div className="mt-2 space-y-2">
              {includeAppInfo && (
                <pre dir="ltr" className="whitespace-pre-wrap rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2 text-start font-mono text-[10px] text-[var(--m-text-muted)]">
                  {[
                    `Marven: v${appInfo.version}`,
                    `OS: ${appInfo.platform}`,
                    appInfo.provider ? `Provider: ${appInfo.provider}` : null,
                    appInfo.model ? `Model: ${appInfo.model}` : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </pre>
              )}
              {includeLogs && (
                <>
                  {logs.status === "loading" && (
                    <p className="text-[10px] text-[var(--m-text-faint)]">{tr("settings.report.logsLoading")}</p>
                  )}
                  {logs.status === "unavailable" && (
                    <p className="text-[10px] text-[var(--m-text-faint)]">{tr("settings.report.logsUnavailable")}</p>
                  )}
                  {logs.status === "ready" && logs.lines.length === 0 && (
                    <p className="text-[10px] text-[var(--m-text-faint)]">{tr("settings.report.logsEmpty")}</p>
                  )}
                  {logs.status === "ready" && logs.lines.length > 0 && (
                    <textarea
                      readOnly
                      dir="ltr"
                      value={logs.lines.join("\n")}
                      rows={8}
                      aria-label={tr("settings.report.includeLogs")}
                      className="w-full resize-y rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-bg)] px-3 py-2 text-start font-mono text-[10px] leading-relaxed text-[var(--m-text-muted)] focus:outline-none"
                    />
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {report.omittedLogLines > 0 && !report.descriptionTruncated && (
        <p className="text-[10px] text-[var(--m-text-faint)]">
          {tr("settings.report.logsTrimmed", { count: report.omittedLogLines })}
        </p>
      )}
      {report.descriptionTruncated && (
        <p className="text-[10px] text-[var(--m-text-faint)]">{tr("settings.report.descriptionTrimmed")}</p>
      )}

      <p className="text-[10px] leading-snug text-[var(--m-text-faint)]">{tr("settings.report.disclaimer")}</p>

      <div className="flex flex-wrap justify-end gap-2">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[11px] text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
          >
            {tr("settings.cancel")}
          </button>
        )}
        <button
          type="button"
          onClick={() => void copyReport()}
          className="rounded-md border border-[var(--m-border)] px-3 py-1.5 text-[11px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
        >
          {copyState === "copied"
            ? tr("settings.report.copied")
            : copyState === "failed"
              ? tr("settings.report.copyFailed")
              : tr("settings.report.copy")}
        </button>
        <button
          type="button"
          onClick={() => openExternal(report.url)}
          className="rounded-md border border-[var(--m-accent)]/40 bg-[var(--m-accent-soft)] px-3 py-1.5 text-[11px] font-medium text-[var(--m-accent)] hover:border-[var(--m-accent)]"
        >
          {tr("settings.report.openIssue")}
        </button>
      </div>
    </div>
  );
}
