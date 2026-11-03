"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GearIcon,
  GlobeIcon,
  HelpCircleIcon,
  InfoIcon,
} from "./Icons";
import { REPO_URL } from "@/lib/glitchReport";
import { useT } from "@/lib/i18n";
import { LanguageModal } from "./LanguageModal";

interface AccountBarProps {
  userName?: string;
  providerLabel?: string;
  appVersion?: string;
  onOpenSettings: () => void;
}

type Panel = "menu" | null;
type Submenu = "learn" | null;

const LEARN_MORE_LINKS = [
  { key: "releaseNotes", url: `${REPO_URL}/releases` },
  { key: "privacyPolicy", url: `${REPO_URL}/blob/master/PRIVACY.md` },
  { key: "sourceCode", url: REPO_URL },
] as const;

const MENU_ITEM =
  "flex w-full items-center gap-3 rounded-md px-2.5 py-[7px] text-start text-[14px] text-[var(--m-text)] hover:bg-[var(--m-surface-3)]";
const MENU_ICON = "h-[18px] w-[18px] shrink-0 text-[var(--m-text-muted)]";
const FLYOUT =
  "absolute bottom-0 start-full z-50 ms-1.5 min-w-[14rem] rounded-xl border border-[var(--m-border)] bg-[var(--m-surface-2)] p-1.5 shadow-2xl";

function openExternal(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).marvenElectron;
  if (el?.openExternal) void el.openExternal(url, "default").catch(() => {});
  else window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Sidebar footer: who's using Marven and which provider is active, with an
 * account menu (chevron) and a Settings button.
 */
export function AccountBar({ userName, providerLabel, appVersion, onOpenSettings }: AccountBarProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useT();
  useEffect(() => {
    if (panel !== "menu") setSubmenu(null);
  }, [panel]);

  const name = userName?.trim() || t("account.you");
  const initial = name.charAt(0).toUpperCase();

  useEffect(() => {
    if (!panel) return;
    function handleOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPanel(null);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPanel(null);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [panel]);

  function openLink(url: string) {
    openExternal(url);
    setPanel(null);
  }

  return (
    <div ref={rootRef} className="relative border-t border-[var(--m-border-subtle)] px-2 py-2">
      {languageOpen && <LanguageModal onClose={() => setLanguageOpen(false)} />}
      {panel === "menu" && (
        <div
          role="menu"
          className="absolute bottom-full start-2 end-2 z-50 mb-1.5 rounded-xl border border-[var(--m-border)] bg-[var(--m-surface-2)] p-1.5 shadow-2xl"
        >
          {appVersion && (
            <p className="px-2.5 pb-1 pt-1 text-[13px] text-[var(--m-text-muted)]">{t("account.version", { version: appVersion })}</p>
          )}
          <button
            type="button"
            role="menuitem"
            onMouseEnter={() => setSubmenu(null)}
            onClick={() => { setPanel(null); onOpenSettings(); }}
            className={MENU_ITEM}
          >
            <GearIcon className={MENU_ICON} />
            {t("common.settings")}
          </button>

          <button
            type="button"
            role="menuitem"
            aria-haspopup="dialog"
            onMouseEnter={() => setSubmenu(null)}
            onClick={() => { setPanel(null); setLanguageOpen(true); }}
            className={MENU_ITEM}
          >
            <GlobeIcon className={MENU_ICON} />
            {t("account.language")}
          </button>

          <button
            type="button"
            role="menuitem"
            onMouseEnter={() => setSubmenu(null)}
            onClick={() => openLink(`${REPO_URL}#readme`)}
            className={MENU_ITEM}
          >
            <HelpCircleIcon className={MENU_ICON} />
            {t("account.getHelp")}
          </button>

          <div className="mx-2.5 my-1.5 h-px bg-[var(--m-border)]" />

          <div className="relative" onMouseEnter={() => setSubmenu("learn")}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={submenu === "learn"}
              onClick={() => setSubmenu(submenu === "learn" ? null : "learn")}
              className={`${MENU_ITEM} ${submenu === "learn" ? "bg-[var(--m-surface-3)]" : ""}`}
            >
              <InfoIcon className={MENU_ICON} />
              {t("account.learnMore")}
              <ChevronRightIcon className="ms-auto h-3.5 w-3.5 text-[var(--m-text-muted)] rtl:rotate-180" />
            </button>
            {submenu === "learn" && (
              <div role="menu" aria-label={t("account.learnMore")} className={FLYOUT}>
                {LEARN_MORE_LINKS.map((link) => (
                  <button
                    key={link.key}
                    type="button"
                    role="menuitem"
                    onClick={() => openLink(link.url)}
                    className={MENU_ITEM}
                  >
                    {t(`account.${link.key}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setPanel(panel === "menu" ? null : "menu")}
          aria-haspopup="menu"
          aria-expanded={panel === "menu"}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1.5 text-start transition-colors hover:bg-[var(--m-surface-2)]"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--m-border)] bg-[var(--m-surface-2)] text-[10px] font-semibold text-[var(--m-text-muted)]">
            {initial}
          </span>
          {/* "Name · provider" — the name keeps its width; the provider truncates. */}
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="max-w-[10rem] shrink-0 truncate text-[14px] text-[var(--m-text)]">{name}</span>
            {providerLabel && (
              <span className="min-w-0 truncate text-[13px] text-[var(--m-text-muted)]">· {providerLabel}</span>
            )}
          </span>
          <ChevronDownIcon
            className={`h-3.5 w-3.5 text-[var(--m-text-muted)] transition-transform ${panel === "menu" ? "rotate-180" : ""}`}
          />
        </button>
        <button
          type="button"
          onClick={() => { setPanel(null); onOpenSettings(); }}
          title={t("common.settings")}
          aria-label={t("common.settings")}
          className="ms-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--m-text)] transition-colors hover:bg-[var(--m-surface-2)]"
        >
          <GearIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
