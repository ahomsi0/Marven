"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  GearIcon,
  GlitchIcon,
  GlobeIcon,
  HelpCircleIcon,
  InfoIcon,
} from "./Icons";
import { REPO_URL, glitchBody, glitchIssueUrl } from "@/lib/glitchReport";
import { useT } from "@/lib/i18n";
import { LanguageModal } from "./LanguageModal";

interface AccountBarProps {
  userName?: string;
  providerLabel?: string;
  appVersion?: string;
  onOpenSettings: () => void;
}

type Panel = "menu" | "report" | null;
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

function platformName(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const el = (window as any).marvenElectron;
  return el?.platform ?? navigator.platform ?? "unknown";
}

/**
 * Sidebar footer: who's using Marven and which provider is active, with an
 * account menu (chevron) and a "Report a glitch" button that drafts a GitHub
 * issue for the user to review — nothing leaves the machine on its own.
 */
export function AccountBar({ userName, providerLabel, appVersion, onOpenSettings }: AccountBarProps) {
  const [panel, setPanel] = useState<Panel>(null);
  const [description, setDescription] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [copied, setCopied] = useState(false);
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

  // Only built while the report panel is open — that's client-only, so
  // platformName() never runs during server rendering.
  const diagnostics = panel === "report" && includeDiagnostics
    ? { version: appVersion ?? "unknown", platform: platformName(), provider: providerLabel ?? "unknown" }
    : null;

  function openLink(url: string) {
    openExternal(url);
    setPanel(null);
  }

  function openReport() {
    setCopied(false);
    setPanel("report");
  }

  function submitReport() {
    openExternal(glitchIssueUrl(description, diagnostics));
    setDescription("");
    setPanel(null);
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(glitchBody(description, diagnostics));
      setCopied(true);
    } catch {
      setCopied(false);
    }
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

      {panel === "report" && (
        <div
          role="dialog"
          aria-label={t("glitch.report")}
          className="absolute bottom-full start-2 z-50 mb-1 w-72 rounded-lg border border-[var(--m-border)] bg-[var(--m-surface)] p-3 shadow-2xl"
        >
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-[var(--m-text)]">
            <GlitchIcon className="h-3.5 w-3.5 text-[var(--m-accent)]" />
            {t("glitch.report")}
          </div>
          <textarea
            autoFocus
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitReport();
            }}
            placeholder={t("glitch.placeholder")}
            rows={4}
            className="w-full resize-none rounded-md border border-[var(--m-border)] bg-[var(--m-bg)] px-2 py-1.5 text-[12px] text-[var(--m-text)] placeholder:text-[var(--m-text-faint)] focus:border-[var(--m-accent)] focus:outline-none"
          />
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] text-[var(--m-text-muted)]">
            <input
              type="checkbox"
              checked={includeDiagnostics}
              onChange={(e) => setIncludeDiagnostics(e.target.checked)}
              className="mt-0.5 accent-[var(--m-accent)]"
            />
            <span>
              {t("glitch.includeDiagnostics")}
              {diagnostics && (
                <span className="block text-[10px] text-[var(--m-text-faint)]">
                  v{diagnostics.version} · {diagnostics.platform} · {diagnostics.provider}
                </span>
              )}
            </span>
          </label>
          <p className="mt-2 text-[10px] leading-snug text-[var(--m-text-faint)]">
            {t("glitch.disclaimer")}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={copyReport}
              className="rounded-md border border-[var(--m-border)] px-2.5 py-1 text-[11px] text-[var(--m-text-muted)] hover:bg-[var(--m-surface-2)] hover:text-[var(--m-text)]"
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
            <button
              type="button"
              onClick={submitReport}
              className="rounded-md border border-[var(--m-accent)]/40 bg-[var(--m-accent-soft)] px-2.5 py-1 text-[11px] font-medium text-[var(--m-accent)] hover:border-[var(--m-accent)]"
            >
              {t("glitch.openDraft")}
            </button>
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
          onClick={() => (panel === "report" ? setPanel(null) : openReport())}
          title={t("glitch.report")}
          aria-label={t("glitch.report")}
          aria-expanded={panel === "report"}
          className={`ms-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--m-surface-2)] hover:text-[var(--m-accent)] ${
            panel === "report" ? "text-[var(--m-accent)]" : "text-[var(--m-text)]"
          }`}
        >
          <GlitchIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
