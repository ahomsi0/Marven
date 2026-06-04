"use client";

import { useState, useEffect, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message as ChatMessage } from "@/types";

interface MessageProps {
  message: ChatMessage;
  disabled?: boolean;
  onEdit?: (newContent: string) => void;   // user messages only
  onRetry?: () => void;                     // assistant messages only
  onEditPrompt?: () => void;
}

export function Message({ message, disabled = false, onEdit, onRetry, onEditPrompt }: MessageProps) {
  const isUser = message.role === "user";
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

  // Shared action button style
  function actionBtn(title: string, onClick: () => void, children: ReactNode) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={title}
        title={title}
        className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--m-surface-2)] border border-[var(--m-border)] text-[var(--m-text-muted)] shadow transition-all duration-150 hover:bg-[var(--m-surface-3)] hover:text-[var(--m-text)] disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {children}
      </button>
    );
  }

  return (
    <div className={`message-in group flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      {isUser ? (
        <div className="relative max-w-[86%] sm:max-w-[78%]">
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
                className="w-full resize-none rounded-2xl rounded-br-sm border border-[var(--m-accent)]/40 bg-[var(--m-surface-2)] px-4 py-3 text-[14px] text-[var(--m-text)] leading-7 outline-none focus:border-[var(--m-accent)]/60"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleEditCancel}
                  className="rounded-md border border-[var(--m-border)] px-3 py-1 text-[11px] text-[var(--m-text-muted)] hover:text-[var(--m-text)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleEditSave}
                  className="rounded-md border border-[var(--m-accent)]/30 bg-[var(--m-accent)]/10 px-3 py-1 text-[11px] text-[var(--m-accent)] hover:bg-[var(--m-accent)]/20"
                >
                  Save & Resend
                </button>
              </div>
            </div>
          ) : (
            /* ── Display mode ── */
            <>
              <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] border-l border-l-[var(--m-accent)]/20 rounded-2xl rounded-br-sm px-4 py-3">
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
                      <p className="text-[14px] text-[var(--m-text)] leading-7 whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[14px] text-[var(--m-text)] leading-7 whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                )}
              </div>
              {/* Action bar — left of bubble, visible on hover */}
              <div className="absolute right-full top-1 mr-1.5 z-10 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {actionBtn("Edit message", () => { setEditValue(message.content); setIsEditing(true); }, <PencilIcon />)}
                {actionBtn(copied ? "Copied!" : "Copy", handleCopy, <CopyIcon />)}
              </div>
              {/* Timestamp shown on hover */}
              <span className="mt-1 block text-right text-[10px] text-[var(--m-text-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {timeLabel}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="relative max-w-[88%] sm:max-w-[82%]">
          {/* Action bar — right of bubble, visible on hover */}
          <div className="absolute left-full top-1 ml-1.5 z-10 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {onEditPrompt && actionBtn("Edit prompt", onEditPrompt, <PencilIcon />)}
            {onRetry && actionBtn("Retry", onRetry, <RetryIcon />)}
            {actionBtn(copied ? "Copied!" : "Copy", handleCopy, <CopyIcon />)}
          </div>

          <div className="pl-3 border-l border-[var(--m-border)]">
            <div className="text-[14px] text-[var(--m-text)] leading-7">
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
                            if (!href) return;
                            const electron = (window as any).marvenElectron;
                            if (electron?.openExternal) {
                              electron.openExternal(href, preferredBrowser);
                            } else {
                              window.open(href, "_blank", "noopener,noreferrer");
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

          {/* Timestamp shown on hover */}
          <span className="mt-1 block pl-4 text-left text-[10px] text-[var(--m-text-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            {timeLabel}
          </span>
        </div>
      )}
    </div>
  );
}
