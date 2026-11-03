"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { useOverlayGuard } from "@/lib/overlays";
import {
  OPEN_SETTINGS_EVENT,
  REPORT_PROBLEM_EVENT,
  clearPendingSettingsRequest,
  isSettingsMounted,
  openSettingsPage,
  type SettingsRequest,
} from "@/lib/settingsNav";
import { MemoryToast } from "./MemoryToast";
import { ReportProblemPanel } from "./ReportProblemPanel";
import { MemoryManager } from "./MemoryManager";

// How long to wait for a Settings view to mount and claim a request before
// showing the panel standalone.
const CLAIM_WAIT_MS = 150;

/**
 * App-wide panels driven by window events, mounted once from app/page.tsx:
 *  - the "Remembered" toast (marven:memory-saved)
 *  - marven:report-problem → Settings → About with "Report a problem" open
 *  - marven:open-settings  → a Settings page (e.g. Memory, from the toast)
 * When no Settings view is open to handle a request, the requested panel is
 * shown as a standalone dialog. See lib/settingsNav.ts.
 */
export function GlobalPanels() {
  const [fallback, setFallback] = useState<SettingsRequest | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onReportProblem = () => openSettingsPage({ page: "about", reportProblem: true });
    const onOpenSettings = (e: Event) => {
      const request = (e as CustomEvent<SettingsRequest>).detail;
      if (!request) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (isSettingsMounted()) return;
        clearPendingSettingsRequest();
        if (request.page === "memory" || request.reportProblem) setFallback(request);
      }, CLAIM_WAIT_MS);
    };
    window.addEventListener(REPORT_PROBLEM_EVENT, onReportProblem);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(REPORT_PROBLEM_EVENT, onReportProblem);
      window.removeEventListener(OPEN_SETTINGS_EVENT, onOpenSettings);
    };
  }, []);

  return (
    <>
      <MemoryToast />
      {fallback && <FallbackDialog request={fallback} onClose={() => setFallback(null)} />}
    </>
  );
}

function FallbackDialog({ request, onClose }: { request: SettingsRequest; onClose: () => void }) {
  const { t: tr } = useT();
  useOverlayGuard(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let title: string;
  let body: ReactNode;
  if (request.page === "memory") {
    title = tr("settings.pages.memory.title");
    body = <MemoryManager workspaceRoot={request.workspaceRoot ?? null} />;
  } else {
    title = tr("settings.report.title");
    body = <ReportProblemPanel onClose={onClose} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 m-auto flex max-h-[90vh] w-[min(600px,94vw)] flex-col overflow-hidden rounded-xl border border-[var(--m-border-subtle)] bg-[var(--m-bg)] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--m-border-subtle)] px-5 py-3">
          <h2 className="text-[14px] font-semibold text-[var(--m-text)]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tr("settings.close")}
            className="text-lg leading-none text-[var(--m-text-faint)] hover:text-[var(--m-text)]"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {request.page === "about" && (
            <p className="mb-3 text-[11px] text-[var(--m-text-faint)]">{tr("settings.report.hint")}</p>
          )}
          {body}
        </div>
      </div>
    </div>
  );
}
