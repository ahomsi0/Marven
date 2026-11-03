"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AIProvider, Message as ChatMessage } from "@/types";
import { useT } from "@/lib/i18n";
import { PROVIDER_LABELS, shortModelName } from "./ModelSelector";
import { RetryModelMenu } from "./RetryModelMenu";

/** A ‹ n/m › switcher for an edited / retried message. */
export interface MessageVersionSwitch {
  index: number; // 0-based
  total: number;
  onSelect: (index: number) => void;
}

interface MessageProps {
  message: ChatMessage;
  disabled?: boolean;
  onEdit?: (newContent: string) => void;   // user messages only
  onRetry?: () => void;                     // assistant messages only
  /** Regenerate this reply with another model (this reply only). */
  onRetryWith?: (provider: AIProvider, model: string) => void;
  /** The selected chat model, listed first in "Retry with…". */
  currentProvider?: AIProvider;
  currentModel?: string;
  /** Start a new conversation from the thread up to this message. */
  onBranch?: () => void;
  version?: MessageVersionSwitch;
}

function VersionSwitcher({ version, disabled }: { version: MessageVersionSwitch; disabled: boolean }) {
  const { t } = useT();
  const { index, total, onSelect } = version;
  const arrow =
    "flex h-5 w-5 items-center justify-center rounded text-[var(--m-text-muted)] transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div role="group" aria-label={t("versions.position", { current: index + 1, total })} className="flex items-center gap-0.5 text-[11px] text-[var(--m-text-muted)]">
      <button
        type="button"
        onClick={() => onSelect(index - 1)}
        disabled={disabled || index === 0}
        aria-label={t("versions.previous")}
        title={t("versions.previous")}
        className={arrow}
      >
        <svg className="h-3 w-3 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <span className="min-w-[2.25rem] text-center tabular-nums">
        {index + 1} / {total}
      </span>
      <button
        type="button"
        onClick={() => onSelect(index + 1)}
        disabled={disabled || index >= total - 1}
        aria-label={t("versions.next")}
        title={t("versions.next")}
        className={arrow}
      >
        <svg className="h-3 w-3 rtl:-scale-x-100" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}

export function Message({
  message,
  disabled = false,
  onEdit,
  onRetry,
  onRetryWith,
  currentProvider,
  currentModel,
  onBranch,
  version,
}: MessageProps) {
  const { t } = useT();
  const isUser = message.role === "user";
  // Which dropdown is open from the hover action bar.
  const [menu, setMenu] = useState<"retry" | "more" | null>(null);
  const actionBarRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [preferredBrowser, setPreferredBrowser] = useState<string>("default");

  useEffect(() => {
    const electron = (window as any).marvenElectron;
    if (electron?.getSettings) {
      electron.getSettings().then((s: any) => {
        if (s?.preferredBrowser) setPreferredBrowser(s.preferredBrowser);
      });
    }
  }, []);

  useEffect(() => {
    if (!isEditing) setEditValue(message.content);
  }, [message.content, isEditing]);

  // Close the open dropdown on an outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (actionBarRef.current && !actionBarRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // A reply that starts streaming (e.g. after a retry) closes any open menu.
  useEffect(() => {
    if (disabled) setMenu(null);
  }, [disabled]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for Electron clipboard permission issues
      const ta = document.createElement("textarea");
      ta.value = message.content;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  }

  function handleEditSave() {
    const trimmed = editValue.trim();
    if (!trimmed) { setIsEditing(false); return; }
    setIsEditing(false);
    onEdit?.(trimmed);
  }

  function handleEditCancel() {
    setEditValue(message.content);
    setIsEditing(false);
  }

  const timeLabel = message.timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  // ─── Copy icon SVG ─────────────────────────────────────────────────────────
  const CopyIcon = () => copied ? (
    <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  ) : (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );

  // ─── Pencil icon SVG ───────────────────────────────────────────────────────
  const PencilIcon = () => (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487z" />
    </svg>
  );

  // ─── Retry icon SVG ────────────────────────────────────────────────────────
  const RetryIcon = () => (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );

  // ─── Dots icon SVG ─────────────────────────────────────────────────────────
  const DotsIcon = () => (
    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );

  const actionBarVisibility = menu ? "opacity-100" : "opacity-0 group-hover:opacity-100";

  // "⋯" menu: Branch from here
  function moreMenu() {
    if (!onBranch) return null;
    return (
      <div className="relative">
        {actionBtn(t("versions.moreActions"), () => setMenu((m) => (m === "more" ? null : "more")), <DotsIcon />)}
        {menu === "more" && (
          <div
            role="menu"
            className={`absolute top-full z-50 mt-1 min-w-[10rem] rounded-lg border border-[var(--m-border)] bg-[var(--m-surface-2)] p-1 shadow-2xl ${isUser ? "end-0" : "start-0"}`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null);
                onBranch();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12px] text-[var(--m-text)] hover:bg-[var(--m-surface-3)]"
            >
              <svg className="h-3.5 w-3.5 shrink-0 text-[var(--m-text-muted)]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <circle cx="6" cy="5" r="2" />
                <circle cx="6" cy="19" r="2" />
                <circle cx="18" cy="7" r="2" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 7v10M18 9c0 5-6 4-11.5 8.5" />
              </svg>
              {t("versions.branch")}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Shared action button style
  function actionBtn(title: string, onClick: () => void, children: ReactNode) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        title={title}
        className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-surface)] text-[var(--m-text-muted)] shadow-sm transition-all duration-150 hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {children}
      </button>
    );
  }

  return (
    // Each message is its own stacking context (the entry animation's
    // transform); lift it while a dropdown is open so later messages can't cover it.
    <div className={`message-in group flex w-full ${isUser ? "justify-end" : "justify-start"} ${menu ? "relative z-20" : ""}`}>
      {isUser ? (
        <div className="relative max-w-[88%] sm:max-w-[72%]">
          {isEditing ? (
            /* ── Edit mode ── */
            <div className="flex flex-col gap-2">
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
                  if (e.key === "Escape") handleEditCancel();
                }}
                rows={3}
                className="w-full resize-none rounded-xl border border-[var(--m-accent)]/40 bg-[var(--m-surface)] px-3 py-2 text-[13px] text-[var(--m-text)] leading-6 outline-none focus:border-[var(--m-accent)]/60"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="rounded-md border border-[var(--m-border)] px-3 py-1 text-[11px] text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={handleEditSave}
                  className="rounded-md border border-[var(--m-accent)]/30 bg-[var(--m-accent)]/10 px-3 py-1 text-[11px] text-[var(--m-accent)] hover:bg-[var(--m-accent)]/20"
                >
                  {t("versions.saveResend")}
                </button>
              </div>
            </div>
          ) : (
            /* ── Display mode ── */
            <>
              <div className="rounded-xl border border-[var(--m-border-subtle)] bg-[var(--m-surface)] px-3.5 py-2.5">
                {message.docs && message.docs.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {message.docs.map((doc, i) => (
                      <div key={i} className="flex items-center gap-1.5 rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2 py-1 text-[11px] text-[var(--m-text-muted)]">
                        <svg className="h-3 w-3 shrink-0 text-[#d19a66]/80" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                        </svg>
                        {doc.name}
                      </div>
                    ))}
                  </div>
                )}
                {message.attachments && message.attachments.length > 0 ? (
                  <div className="flex gap-3 items-start">
                    <div className="flex flex-col gap-1 shrink-0 max-h-32 overflow-y-auto">
                      {message.attachments.map((att) => (
                        <img
                          key={`${att.name}-${att.base64.slice(-8)}`}
                          src={att.base64}
                          alt={att.name}
                          title={att.name}
                          className="w-12 h-12 rounded object-cover border border-[#444]"
                        />
                      ))}
                    </div>
                    {message.content && (
                      <p dir="auto" className="text-[13px] text-[var(--m-text)] leading-6 whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    )}
                  </div>
                ) : (
                  <p dir="auto" className="text-[13px] text-[var(--m-text)] leading-6 whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                )}
              </div>
              {/* Action bar — left of bubble, visible on hover */}
              <div ref={actionBarRef} className={`absolute end-full top-1 me-1.5 z-10 flex gap-1 transition-opacity duration-150 ${actionBarVisibility}`}>
                {actionBtn(t("versions.edit"), () => { setEditValue(message.content); setIsEditing(true); }, <PencilIcon />)}
                {actionBtn(copied ? t("common.copied") : t("common.copy"), handleCopy, <CopyIcon />)}
                {moreMenu()}
              </div>
              {version && (
                <div className="mt-1 flex justify-end">
                  <VersionSwitcher version={version} disabled={disabled} />
                </div>
              )}
              {/* Timestamp shown on hover */}
              <span className="pointer-events-none absolute end-1 top-full mt-0.5 whitespace-nowrap text-[10px] text-[var(--m-text-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {timeLabel}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="relative max-w-[100%]">
          {/* Action bar — right of bubble, visible on hover */}
          <div ref={actionBarRef} className={`absolute start-full top-1 ms-1.5 z-10 flex gap-1 transition-opacity duration-150 ${actionBarVisibility}`}>
            {onRetry && (
              <div className="relative flex">
                {actionBtn(t("versions.retry"), onRetry, <RetryIcon />)}
                {onRetryWith && (
                  <button
                    type="button"
                    onClick={() => setMenu((m) => (m === "retry" ? null : "retry"))}
                    disabled={disabled}
                    aria-haspopup="menu"
                    aria-expanded={menu === "retry"}
                    aria-label={t("versions.retryOptions")}
                    title={t("versions.retryWith")}
                    className="-ms-px flex h-6 w-4 items-center justify-center rounded-md border border-[var(--m-border-subtle)] bg-[var(--m-surface)] text-[var(--m-text-muted)] shadow-sm transition-all duration-150 hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)] disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                )}
                {menu === "retry" && onRetryWith && (
                  <div className="absolute start-0 top-full z-50 mt-1">
                    <RetryModelMenu
                      currentProvider={currentProvider}
                      currentModel={currentModel}
                      onPick={(p, m) => {
                        setMenu(null);
                        onRetryWith(p, m);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
            {actionBtn(copied ? t("common.copied") : t("common.copy"), handleCopy, <CopyIcon />)}
            {moreMenu()}
          </div>

          <div className="rounded-xl px-1 py-1">
            <div dir="auto" className="text-[13px] text-[var(--m-text)] leading-6">
              {message.isStreaming && !message.content ? (
                <span className="streaming-cursor" />
              ) : (
                <div className="prose">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          onClick={(e) => {
                            e.preventDefault();
                            if (!href?.trim()) return;
                            let target = href.trim();
                            try {
                              target = new URL(target, typeof window !== "undefined" ? window.location.href : undefined).href;
                            } catch {
                              return;
                            }
                            const electron = (window as any).marvenElectron;
                            if (electron?.openExternal) {
                              void electron.openExternal(target, preferredBrowser).catch(() => {});
                            } else {
                              window.open(target, "_blank", "noopener,noreferrer");
                            }
                          }}
                          className="underline decoration-[#d19a66]/40 underline-offset-2 hover:decoration-[#d19a66] cursor-pointer"
                        >
                          {children}
                        </a>
                      ),
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                  {message.isStreaming && (
                    <span className="streaming-cursor" />
                  )}
                </div>
              )}
            </div>
          </div>

          {(version || (message.model && !message.isStreaming)) && (
            <div className="flex items-center gap-2 px-1">
              {version && <VersionSwitcher version={version} disabled={disabled} />}
              {message.model && !message.isStreaming && (
                <span
                  dir="ltr"
                  title={t("versions.repliedBy", {
                    provider: message.provider ? PROVIDER_LABELS[message.provider] : "",
                    model: message.model,
                  })}
                  className="truncate text-[10px] text-[var(--m-text-faint)]"
                >
                  {shortModelName(message.model)}
                </span>
              )}
            </div>
          )}

          {/* Timestamp shown on hover */}
          <span className="pointer-events-none absolute start-1 top-full mt-0.5 whitespace-nowrap text-[10px] text-[var(--m-text-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {timeLabel}
          </span>
        </div>
      )}
    </div>
  );
}
