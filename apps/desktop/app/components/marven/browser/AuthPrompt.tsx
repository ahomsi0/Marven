"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import type { BrowserTab } from "@/lib/inAppBrowser";

const field =
  "h-8 w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface)] px-2.5 text-[12px] text-[var(--m-text)] outline-none focus:border-[var(--m-accent)]/60";

/**
 * Shown in place of the page when a server (or proxy) asks for a username
 * and password. The details go only to that server, through the main process.
 */
export function AuthPrompt({
  auth,
  onSubmit,
  onCancel,
}: {
  auth: NonNullable<BrowserTab["auth"]>;
  onSubmit: (username: string, password: string) => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (username) onSubmit(username, password);
      }}
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto px-6 text-center"
    >
      <svg className="h-8 w-8 text-[var(--m-text-faint)]" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <p className="text-[14px] font-medium text-[var(--m-text)]">{auth.isProxy ? t("browser.authProxyTitle") : t("browser.authTitle")}</p>
      <p dir="ltr" className="max-w-[320px] break-words font-mono text-[11px] text-[var(--m-text-faint)]">
        {auth.host}
      </p>
      {auth.realm && (
        <p dir="auto" className="max-w-[320px] break-words text-[11px] text-[var(--m-text-muted)]">
          {t("browser.authRealm", { realm: auth.realm })}
        </p>
      )}
      <div className="flex w-full max-w-[260px] flex-col gap-2">
        <input
          autoFocus
          dir="ltr"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          placeholder={t("browser.authUsername")}
          aria-label={t("browser.authUsername")}
          className={field}
        />
        <input
          type="password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          placeholder={t("browser.authPassword")}
          aria-label={t("browser.authPassword")}
          className={field}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-[var(--m-border)] px-3 py-1 text-[12px] text-[var(--m-text-muted)] transition-colors hover:text-[var(--m-text)]"
        >
          {t("browser.cancel")}
        </button>
        <button
          type="submit"
          disabled={!username}
          className="rounded-md border border-[var(--m-accent)]/30 bg-[var(--m-accent)]/10 px-3 py-1 text-[12px] text-[var(--m-accent)] transition-colors hover:bg-[var(--m-accent)]/20 disabled:opacity-40"
        >
          {t("browser.authSignIn")}
        </button>
      </div>
    </form>
  );
}
