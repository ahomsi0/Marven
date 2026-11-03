"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { useOverlayGuard } from "@/lib/overlays";
import { deleteMemoryEntry } from "@/lib/memoryApi";
import { MEMORY_SAVED_EVENT, type MemorySavedDetail } from "@/lib/memoryEvents";
import { openSettingsPage } from "@/lib/settingsNav";

const VISIBLE_MS = 6000;
const AFTER_UNDO_MS = 1800;

type Toast = MemorySavedDetail & { key: number; status: "saved" | "undoing" | "undone" | "failed" };

/**
 * "Remembered: …" toast with Undo and Manage. Mounted once (via GlobalPanels)
 * and driven by the marven:memory-saved window event (lib/memoryEvents.ts).
 */
export function MemoryToast() {
  const { t } = useT();
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverRef = useRef(false);

  // The toast sits bottom-end, where the in-app browser's native view would
  // draw over it, so the browser hides while it's up (like WhatsNewCard).
  useOverlayGuard(toast !== null);

  function schedule(ms: number) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!hoverRef.current) setToast(null);
      else schedule(1000);
    }, ms);
  }

  useEffect(() => {
    let key = 0;
    const onSaved = (e: Event) => {
      const detail = (e as CustomEvent<MemorySavedDetail>).detail;
      if (!detail?.id || !detail.text) return;
      key += 1;
      setToast({ ...detail, key, status: "saved" });
      schedule(VISIBLE_MS);
    };
    window.addEventListener(MEMORY_SAVED_EVENT, onSaved);
    return () => {
      window.removeEventListener(MEMORY_SAVED_EVENT, onSaved);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!toast) return null;

  async function undo() {
    if (!toast || toast.status !== "saved") return;
    const current = toast;
    setToast({ ...current, status: "undoing" });
    try {
      await deleteMemoryEntry(current.scope, current.id, {
        workspaceRoot: current.workspaceRoot,
        conversationId: current.conversationId,
      });
      setToast((prev) => (prev?.key === current.key ? { ...prev, status: "undone" } : prev));
    } catch {
      setToast((prev) => (prev?.key === current.key ? { ...prev, status: "failed" } : prev));
    }
    schedule(AFTER_UNDO_MS);
  }

  function manage() {
    if (!toast) return;
    openSettingsPage({ page: "memory", workspaceRoot: toast.workspaceRoot ?? null });
    setToast(null);
  }

  const message =
    toast.status === "undone"
      ? t("memoryToast.undone")
      : toast.status === "failed"
        ? t("memoryToast.undoFailed")
        : t("memoryToast.remembered", { text: toast.text });

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => {
        hoverRef.current = true;
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
      }}
      className="fixed bottom-5 end-5 z-50 flex w-80 max-w-[calc(100vw-2.5rem)] items-start gap-3 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] px-3 py-2.5 shadow-2xl"
      style={{ animation: "whatsNewIn 0.2s ease-out" }}
    >
      <p dir="auto" className="line-clamp-3 min-w-0 flex-1 break-words text-start text-[12px] text-[var(--m-text)]">
        {message}
      </p>
      <div className="flex shrink-0 items-center gap-2 pt-px">
        {(toast.status === "saved" || toast.status === "undoing") && (
          <button
            type="button"
            onClick={() => void undo()}
            disabled={toast.status === "undoing"}
            className="text-[11px] font-medium text-[var(--m-accent)] hover:underline disabled:opacity-50"
          >
            {t("memoryToast.undo")}
          </button>
        )}
        <button
          type="button"
          onClick={manage}
          className="text-[11px] text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
        >
          {t("memoryToast.manage")}
        </button>
        <button
          type="button"
          onClick={() => setToast(null)}
          aria-label={t("common.dismiss")}
          className="text-base leading-none text-[var(--m-text-faint)] hover:text-[var(--m-text-muted)]"
        >
          ×
        </button>
      </div>
    </div>
  );
}
