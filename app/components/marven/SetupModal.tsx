"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CloseIcon, CubeIcon, CloudIcon } from "./Icons";
import { Trans } from "react-i18next";
import { useT } from "@/lib/i18n";

interface SetupModalProps {
  onSave: (name: string) => void;
}

type Step = "welcome" | "backend" | "model" | "done";

interface BackendProbe {
  /** "live" once we've heard back from a local backend */
  ollama: "checking" | "live" | "down";
  lmstudio: "checking" | "live" | "down";
  llamaserver: "checking" | "live" | "down";
}

const PROBE_TIMEOUT_MS = 1500;

/**
 * First-run onboarding. Three steps so a brand-new user lands in a usable
 * state without poking around in Settings:
 *
 *   1. Name (kept short — sets userProfile so the rest of the app boots).
 *   2. Backend detection (probes Ollama / LM Studio / llama-server in
 *      parallel; tells the user what's running on their machine + offers
 *      a cloud fallback link if nothing is).
 *   3. Model recommendation (suggests a known-good local 7B-coder model
 *      if Ollama is up; otherwise explains how to add an API key for cloud).
 *
 * "Skip & explore" is always available — onboarding shouldn't gate use.
 */
export function SetupModal({ onSave }: SetupModalProps) {
  const { t } = useT();
  const [step, setStep] = useState<Step>("welcome");
  const [name, setName] = useState("");
  const [probes, setProbes] = useState<BackendProbe>({
    ollama: "checking",
    lmstudio: "checking",
    llamaserver: "checking",
  });

  // Kick off backend probes when we enter the backend step.
  useEffect(() => {
    if (step !== "backend") return;
    let cancelled = false;

    function probe(url: string, key: keyof BackendProbe) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
      fetch(url, { signal: ctl.signal })
        .then((r) => {
          if (cancelled) return;
          setProbes((p) => ({ ...p, [key]: r.ok ? "live" : "down" }));
        })
        .catch(() => {
          if (cancelled) return;
          setProbes((p) => ({ ...p, [key]: "down" }));
        })
        .finally(() => clearTimeout(t));
    }

    probe("http://localhost:11434/api/tags", "ollama");
    probe("http://localhost:1234/v1/models", "lmstudio");
    probe("http://localhost:8080/v1/models", "llamaserver");

    return () => {
      cancelled = true;
    };
  }, [step]);

  function handleNameSubmit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Don't call onSave here — it triggers the parent to set userProfile
    // non-null, which unmounts this modal immediately. We only commit the
    // profile at the *end* of the wizard (handleFinish / handleSkip).
    setStep("backend");
  }

  function handleFinish() {
    onSave(name.trim() || "friend");
    setStep("done");
  }

  function handleSkip() {
    onSave(name.trim() || "friend");
    setStep("done");
  }

  // Once we hand control back to the app, unmount this modal.
  if (step === "done") return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1a1a1a]">
      <div className="relative flex w-full max-w-[460px] flex-col gap-6 rounded-2xl border border-[var(--m-border)] bg-[#1e1e1e] px-8 py-9 text-[#d4d4d4] mx-4">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-1.5">
          {(["welcome", "backend", "model"] as Step[]).map((s) => (
            <span
              key={s}
              className={`h-[3px] w-6 rounded-full transition-colors ${
                step === s
                  ? "bg-[#d19a66]"
                  : "bg-[#333]"
              }`}
            />
          ))}
        </div>

        {step === "welcome" && (
          <>
            <div className="text-center">
              <h1 className="text-[20px] font-semibold">{t("setup.welcomeTitle")}</h1>
              <p className="mt-2 text-[13px] text-[#888]">
                {t("setup.welcomeBody")}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3">
              <input
                autoFocus
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
                placeholder={t("setup.namePlaceholder")}
                className="border-b border-[var(--m-border)] bg-transparent pb-2 text-[15px] outline-none placeholder:text-[#555] focus:border-[#d19a66] transition-colors"
              />
              <button
                type="button"
                onClick={handleNameSubmit}
                disabled={!name.trim()}
                className="w-full rounded-xl border border-[#d19a66]/30 bg-[#d19a66]/10 px-6 py-2.5 text-[14px] text-[#d19a66] transition-all hover:bg-[#d19a66]/20 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {t("setup.continue")}
              </button>
            </div>
          </>
        )}

        {step === "backend" && (
          <>
            <div className="text-center">
              <h1 className="text-[18px] font-semibold">{t("setup.backendTitle")}</h1>
              <p className="mt-2 text-[13px] text-[#888]">
                {t("setup.backendBody")}
              </p>
            </div>

            <div className="flex flex-col gap-2 text-[13px]">
              <BackendRow name="Ollama" hint="localhost:11434" status={probes.ollama} />
              <BackendRow name="LM Studio" hint="localhost:1234" status={probes.lmstudio} />
              <BackendRow name="llama-server" hint="localhost:8080" status={probes.llamaserver} />
            </div>

            {Object.values(probes).every((s) => s === "down") && (
              <div className="rounded-lg border border-[var(--m-border)] bg-[#262626] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#aaa]">
                <Trans
                  i18nKey="setup.noBackend"
                  components={{
                    link: <a className="text-[#d19a66] hover:underline" href="https://ollama.com" target="_blank" rel="noreferrer" />,
                    code: <code className="text-[#d19a66]" dir="ltr" />,
                  }}
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSkip}
                className="flex-1 rounded-xl border border-[var(--m-border)] bg-transparent px-4 py-2 text-[13px] text-[#888] hover:bg-[#262626]"
              >
                {t("setup.skip")}
              </button>
              <button
                type="button"
                onClick={() => setStep("model")}
                className="flex-1 rounded-xl border border-[#d19a66]/30 bg-[#d19a66]/10 px-4 py-2 text-[13px] text-[#d19a66] hover:bg-[#d19a66]/20"
              >
                {t("setup.next")}
              </button>
            </div>
          </>
        )}

        {step === "model" && (
          <>
            <div className="text-center">
              <h1 className="text-[18px] font-semibold">{t("setup.recommendedTitle")}</h1>
              <p className="mt-2 text-[13px] text-[#888]">
                {t("setup.recommendedBody")}
              </p>
            </div>

            <div className="flex flex-col gap-3 text-[12.5px] leading-relaxed text-[#bbb]">
              {probes.ollama === "live" ? (
                <Recommendation
                  Icon={CubeIcon}
                  title={t("setup.ollamaTitle")}
                  body={
                    <>
                      {t("setup.ollamaTry")}
                      <ul className="mt-1.5 list-disc ps-5 text-[#999]">
                        <li>
                          <code className="text-[#d19a66]" dir="ltr">qwen2.5-coder:7b</code> — {t("setup.modelFastest")}
                        </li>
                        <li>
                          <code className="text-[#d19a66]" dir="ltr">deepseek-coder-v2:16b</code> — {t("setup.modelReasoning")}
                        </li>
                        <li>
                          <code className="text-[#d19a66]" dir="ltr">nomic-embed-text</code> — {t("setup.modelEmbeddings")}
                        </li>
                      </ul>
                    </>
                  }
                />
              ) : (
                <Recommendation
                  Icon={CloudIcon}
                  title={t("setup.cloudTitle")}
                  body={
                    <>
                      <Trans i18nKey="setup.cloudAddKey" components={{ strong: <strong /> }} />
                      <ul className="mt-1.5 list-disc ps-5 text-[#999]">
                        <li>
                          <Trans i18nKey="setup.cloudGroq" components={{ strong: <strong />, em: <em /> }} />
                        </li>
                        <li>
                          <Trans i18nKey="setup.cloudClaude" components={{ strong: <strong /> }} />
                        </li>
                      </ul>
                    </>
                  }
                />
              )}

              <div className="rounded-lg border border-[var(--m-border)] bg-[#262626] px-3 py-2.5">
                <Trans
                  i18nKey="setup.tip"
                  components={{ strong: <strong className="text-[#d4d4d4]" />, em: <strong /> }}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleFinish}
              className="w-full rounded-xl border border-[#d19a66]/30 bg-[#d19a66]/10 px-6 py-2.5 text-[14px] text-[#d19a66] hover:bg-[#d19a66]/20"
            >
              {t("setup.gotIt")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function BackendRow({
  name,
  hint,
  status,
}: {
  name: string;
  hint: string;
  status: BackendProbe[keyof BackendProbe];
}) {
  const { t } = useT();
  return (
    <div className="flex items-center justify-between rounded-lg border border-[var(--m-border-subtle)] bg-[#242424] px-3 py-2">
      <div>
        <div className="font-medium text-[#d4d4d4]">{name}</div>
        <div className="text-[11px] text-[#666]">{hint}</div>
      </div>
      {status === "checking" && <span className="text-[11px] text-[#777]">{t("setup.checking")}</span>}
      {status === "live" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-[#98c379]">
          <CheckIcon className="h-3 w-3" /> {t("setup.running")}
        </span>
      )}
      {status === "down" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-[#666]">
          <CloseIcon className="h-3 w-3" /> {t("setup.notRunning")}
        </span>
      )}
    </div>
  );
}

function Recommendation({
  Icon,
  title,
  body,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--m-border)] bg-[#222] px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-[#d4d4d4]">
        <Icon className="h-3.5 w-3.5 text-[#d19a66]" />
        {title}
      </div>
      <div>{body}</div>
    </div>
  );
}
