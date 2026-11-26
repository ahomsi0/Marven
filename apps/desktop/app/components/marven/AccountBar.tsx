"use client";

import { useEffect, useRef, useState } from "react";
import { GearIcon, GlobeIcon, HelpCircleIcon } from "./Icons";
import { REPO_URL } from "@/lib/glitchReport";
import { useT } from "@/lib/i18n";
import { formatBinding, isMacPlatform, loadKeybindings } from "@/lib/keybindings";
import { LanguageModal } from "./LanguageModal";

interface AccountBarProps {
  userName?: string;
  providerLabel?: string;
  /** The active model, short form ("Llama 3.3 70B"). */
  modelLabel?: string;
  /** The provider runs on this machine: the dot is green (cloud: blue). */
  providerLocal?: boolean;
  appVersion?: string;
  onOpenSettings: () => void;
}

const LINKS = [
  { key: "releaseNotes", url: `${REPO_URL}/releases` },
  { key: "privacyPolicy", url: `${REPO_URL}/blob/master/PRIVACY.md` },
  { key: "sourceCode", url: REPO_URL },
] as const;

const MENU_ITEM =
  "flex w-full items-center gap-2.5 rounded-[7px] px-[9px] py-[7px] text-start text-[13px] text-[var(--m-text)] outline-none hover:bg-[var(--m-surface-3)] focus-visible:bg-[var(--m-surface-3)]";
const MENU_ICON = "h-[15px] w-[15px] shrink-0 text-[var(--m-text-muted)]";
const LINK =
  "whitespace-nowrap rounded text-[10.5px] tracking-[-0.01em] text-[var(--m-text-muted)] outline-none hover:text-[var(--m-text)] focus-visible:text-[var(--m-text)] focus-visible:underline";

function openExternal(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).marvenElectron;
  if (el?.openExternal) void el.openExternal(url, "default").catch(() => {});
  else window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Sidebar footer: one card with who's using Marven and the provider and model
 * that are active, with a gear: it opens a short menu (Settings, Language,
 * help) with the release notes, privacy policy and source links underneath.
 */
export function AccountBar({ userName, providerLabel, modelLabel, providerLocal, appVersion, onOpenSettings }: AccountBarProps) {
  const [open, setOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useT();

  const name = userName?.trim() || t("account.you");
  const initial = name.charAt(0).toUpperCase();
  const using = [providerLabel, modelLabel].filter(Boolean).join(" · ");

  useEffect(() => {
    if (!open) return;
    // The user's own shortcut for Settings (Settings → Keyboard can change it).
    setSettingsKey(formatBinding("open-settings", isMacPlatform(), loadKeybindings()));
    function handleOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function openLink(url: string) {
    openExternal(url);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative border-t border-[var(--m-border-subtle)] px-2 py-2">
      {languageOpen && <LanguageModal onClose={() => setLanguageOpen(false)} />}
      {open && (
        <div
          role="menu"
          className="absolute bottom-full start-2 end-2 z-50 mb-1.5 rounded-xl border border-[var(--m-border-subtle)] bg-[var(--m-surface-2)] p-[5px] shadow-2xl"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); onOpenSettings(); }}
            className={MENU_ITEM}
          >
            <GearIcon className={MENU_ICON} />
            {t("common.settings")}
            {settingsKey && <span className="ms-auto text-[11px] text-[var(--m-text-faint)]">{settingsKey}</span>}
          </button>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="dialog"
            onClick={() => { setOpen(false); setLanguageOpen(true); }}
            className={MENU_ITEM}
          >
            <GlobeIcon className={MENU_ICON} />
            {t("account.language")}
          </button>
          <button type="button" role="menuitem" onClick={() => openLink(`${REPO_URL}#readme`)} className={MENU_ITEM}>
            <HelpCircleIcon className={MENU_ICON} />
            {t("account.getHelp")}
            {appVersion && (
              <span className="ms-auto text-[11px] text-[var(--m-text-faint)]" title={t("account.version", { version: appVersion })}>
                v{appVersion}
              </span>
            )}
          </button>

          <div className="mx-1.5 my-1 h-px bg-[var(--m-border-subtle)]" />

          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-[9px] pb-1 pt-1">
            {LINKS.map((link) => (
              <button key={link.key} type="button" role="menuitem" onClick={() => openLink(link.url)} className={LINK}>
                {t(`account.${link.key}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={using ? `${name} · ${using}` : name}
        className={`flex w-full items-center gap-2.5 rounded-[10px] border px-2 py-[7px] text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--m-accent)]/50 ${
          open
            ? "border-[var(--m-border)] bg-[var(--m-surface-3)]"
            : "border-[var(--m-border-subtle)] bg-[var(--m-surface-2)] hover:border-[var(--m-border)] hover:bg-[var(--m-surface-3)]"
        }`}
      >
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-[var(--m-accent-soft)] text-[13px] font-semibold text-[var(--m-accent)]">
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[13.5px] font-medium leading-tight text-[var(--m-text)]">{name}</span>
          {using && (
            <span className="flex min-w-0 items-center gap-[5px] text-[11.5px] leading-tight text-[var(--m-text-muted)]">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${providerLocal ? "bg-[var(--m-local)]" : "bg-[var(--m-cloud)]"}`}
              />
              <span className="truncate">{using}</span>
            </span>
          )}
        </span>
        <GearIcon className={`h-4 w-4 shrink-0 transition-colors ${open ? "text-[var(--m-text)]" : "text-[var(--m-text-muted)]"}`} />
      </button>
    </div>
  );
}
