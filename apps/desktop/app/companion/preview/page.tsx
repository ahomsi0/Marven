"use client";

// Mini Me's preview panel, docked beside his speech bubble: a toolbar and the
// project, served on 127.0.0.1 by Marven (electron/projectServer.js), in a
// sandboxed frame that reloads whenever Mini Me writes a file.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";

interface PreviewBridge {
  onReload(cb: (state: { hasIndex?: unknown } | null) => void): () => void;
  openInBrowser(): void;
  openFolder(): void;
  openInMarven(): void;
  close(): void;
}

const LOOPBACK_ROOT = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}\/$/;
const icon = "h-3.5 w-3.5";

function ToolButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--m-text-muted)] hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text)]"
    >
      {children}
    </button>
  );
}

export default function PreviewPage() {
  const { t } = useT();
  const bridge = useMemo(
    () => (typeof window === "undefined" ? null : ((window as unknown as { marvenPreview?: PreviewBridge }).marvenPreview ?? null)),
    [],
  );
  const [state, setState] = useState<{ url: string; name: string; hasIndex: boolean } | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const url = q.get("u") ?? "";
    if (!LOOPBACK_ROOT.test(url)) return;
    setState({ url, name: (q.get("n") ?? "").slice(0, 80), hasIndex: q.get("ready") === "1" });
  }, []);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onReload((s) => {
      const hasIndex = s && typeof s.hasIndex === "boolean" ? s.hasIndex : undefined;
      setState((prev) => (prev && hasIndex !== undefined ? { ...prev, hasIndex } : prev));
      setNonce((n) => n + 1);
    });
  }, [bridge]);

  const host = state ? state.url.replace(/^http:\/\//, "").replace(/\/$/, "") : "";

  return (
    <main className="h-screen w-screen select-none overflow-hidden">
      <style>{`html,body{background:transparent!important;overflow:hidden}`}</style>
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--m-border)] bg-[var(--m-surface)] text-[var(--m-text)]">
      <div className="flex h-[34px] shrink-0 items-center gap-1.5 border-b border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-2 text-[11.5px]">
        <ToolButton label={t("companion.preview.close")} onClick={() => bridge?.close()}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </ToolButton>
        <ToolButton label={t("companion.preview.reload")} onClick={() => setNonce((n) => n + 1)}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
          </svg>
        </ToolButton>
        <div className="flex h-[22px] min-w-0 flex-1 items-center gap-1.5 rounded-md bg-[var(--m-bg)] px-2 text-[var(--m-text-muted)]">
          <span className="min-w-0 truncate font-medium text-[var(--m-text)]">{state?.name}</span>
          {host && <span className="shrink-0 text-[var(--m-text-faint)]">{host}</span>}
        </div>
        <ToolButton label={t("companion.preview.openInBrowser")} onClick={() => bridge?.openInBrowser()}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
          </svg>
        </ToolButton>
        <ToolButton label={t("companion.preview.openInMarven")} onClick={() => bridge?.openInMarven()}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M9 4v16" />
          </svg>
        </ToolButton>
        <ToolButton label={t("companion.preview.openFolder")} onClick={() => bridge?.openFolder()}>
          <svg className={icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden>
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
          </svg>
        </ToolButton>
      </div>
      {!state ? (
        <p className="m-auto text-[12px] text-[var(--m-text-faint)]">{t("companion.preview.invalid")}</p>
      ) : state.hasIndex ? (
        <iframe
          key={nonce}
          src={state.url}
          title={state.name || "Preview"}
          sandbox="allow-scripts allow-forms"
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <div className="m-auto flex items-center gap-2 text-[12px] text-[var(--m-text-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--m-accent)]" />
          {t("companion.preview.waiting")}
        </div>
      )}
      </div>
    </main>
  );
}
