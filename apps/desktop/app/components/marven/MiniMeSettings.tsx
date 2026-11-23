"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";
import type { Activity } from "@/lib/companion/behaviour";
import type { Personality } from "@/lib/companion/brain";

type Speed = "slow" | "normal" | "fast";
const ACTIVITIES: Activity[] = ["lively", "calm", "still"];
const SPEEDS: Speed[] = ["slow", "normal", "fast"];
const PERSONALITIES: Personality[] = ["playful", "neutral", "detailed"];

/* eslint-disable @typescript-eslint/no-explicit-any */
type Electron = {
  getSettings: () => Promise<any>;
  saveSettings: (s: any) => Promise<any>;
  companionStatus?: () => Promise<{ hotkeyOk: boolean }>;
};

interface MiniMeState {
  miniMeEnabled: boolean;
  miniMeWakeWord: boolean;
  miniMeSpeak: boolean;
  miniMeActivity: Activity;
  miniMeSpeed: Speed;
  miniMePersonality: Personality;
  miniMeScale: number;
  miniMeSleepMinutes: number;
  miniMeHotkey: string;
}

const DEFAULTS: MiniMeState = {
  miniMeEnabled: false,
  miniMeWakeWord: false,
  miniMeSpeak: true,
  miniMeActivity: "lively",
  miniMeSpeed: "normal",
  miniMePersonality: "playful",
  miniMeScale: 3,
  miniMeSleepMinutes: 5,
  miniMeHotkey: "CommandOrControl+Shift+Space",
};

function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-labelledby={id}
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? "bg-[var(--m-accent)]" : "bg-[var(--m-border)]"
      }`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-5 rtl:-translate-x-5" : "translate-x-1 rtl:-translate-x-1"
        }`}
      />
    </button>
  );
}

/** Settings → General → Mini Me (desktop app only). */
export function MiniMeSettings({ electron }: { electron: Electron }) {
  const { t: tr } = useT();
  const [state, setState] = useState<MiniMeState>(DEFAULTS);
  const [hotkeyDraft, setHotkeyDraft] = useState(DEFAULTS.miniMeHotkey);
  const [hotkeyOk, setHotkeyOk] = useState(true);

  useEffect(() => {
    void electron.getSettings().then((s: any) => {
      const next = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS) as (keyof MiniMeState)[]) {
        if (typeof s?.[key] === typeof DEFAULTS[key]) (next as any)[key] = s[key];
      }
      // Only accept values the selects offer; anything else falls back to the default.
      if (!ACTIVITIES.includes(next.miniMeActivity)) next.miniMeActivity = DEFAULTS.miniMeActivity;
      if (!SPEEDS.includes(next.miniMeSpeed)) next.miniMeSpeed = DEFAULTS.miniMeSpeed;
      if (!PERSONALITIES.includes(next.miniMePersonality)) next.miniMePersonality = DEFAULTS.miniMePersonality;
      setState(next);
      setHotkeyDraft(next.miniMeHotkey);
    });
    void electron.companionStatus?.().then((st) => setHotkeyOk(st.hotkeyOk));
  }, [electron]);

  async function save(patch: Partial<MiniMeState>) {
    setState((prev) => ({ ...prev, ...patch }));
    const current = await electron.getSettings();
    await electron.saveSettings({ ...current, ...patch });
    const st = await electron.companionStatus?.();
    if (st) setHotkeyOk(st.hotkeyOk);
  }

  const row = (id: string, label: string, checked: boolean, key: keyof MiniMeState, hint?: string) => (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h4 id={id} className="text-[12px] text-[var(--m-text)]">{label}</h4>
        {hint && <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onChange={(next) => void save({ [key]: next } as Partial<MiniMeState>)} />
    </div>
  );

  const select = (id: string, label: string, key: keyof MiniMeState, options: [string, string][]) => (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="text-[12px] text-[var(--m-text)]">{label}</label>
      <select
        id={id}
        value={state[key] as string}
        onChange={(e) => void save({ [key]: e.target.value } as Partial<MiniMeState>)}
        className="rounded-md border border-[var(--m-border)] bg-transparent px-2 py-1 text-[12px]"
      >
        {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
      </select>
    </div>
  );

  return (
    <div className="rounded-lg border border-[var(--m-border-subtle)] bg-[var(--m-surface)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="mini-me-label" className="text-[13px] font-medium text-[var(--m-text)]">{tr("settings.general.miniMe")}</h3>
          <p className="mt-0.5 text-[11px] text-[var(--m-text-faint)]">{tr("settings.general.miniMeHint")}</p>
        </div>
        <Switch id="mini-me-label" checked={state.miniMeEnabled} onChange={(next) => void save({ miniMeEnabled: next })} />
      </div>

      {state.miniMeEnabled && (
        <div className="mt-4 space-y-3 border-t border-[var(--m-border-subtle)] pt-3">
          {row("mini-me-wake", tr("settings.general.miniMeWake"), state.miniMeWakeWord, "miniMeWakeWord", tr("settings.general.miniMeWakeHint"))}
          {row("mini-me-speak", tr("settings.general.miniMeSpeak"), state.miniMeSpeak, "miniMeSpeak")}
          {select("mini-me-activity", tr("settings.general.miniMeActivity"), "miniMeActivity", [
            ["lively", tr("settings.general.miniMeActivityLively")],
            ["calm", tr("settings.general.miniMeActivityCalm")],
            ["still", tr("settings.general.miniMeActivityStill")],
          ])}
          {select("mini-me-speed", tr("settings.general.miniMeSpeed"), "miniMeSpeed", [
            ["slow", tr("settings.general.miniMeSpeedSlow")],
            ["normal", tr("settings.general.miniMeSpeedNormal")],
            ["fast", tr("settings.general.miniMeSpeedFast")],
          ])}
          {select("mini-me-personality", tr("settings.general.miniMePersonality"), "miniMePersonality", [
            ["playful", tr("settings.general.miniMePersonalityPlayful")],
            ["neutral", tr("settings.general.miniMePersonalityNeutral")],
            ["detailed", tr("settings.general.miniMePersonalityDetailed")],
          ])}

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="mini-me-size" className="text-[12px] text-[var(--m-text)]">{tr("settings.general.miniMeSize")}</label>
            <select
              id="mini-me-size"
              value={state.miniMeScale}
              onChange={(e) => void save({ miniMeScale: Number(e.target.value) })}
              className="rounded-md border border-[var(--m-border)] bg-transparent px-2 py-1 text-[12px]"
            >
              {[2, 3, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
          </div>

          <div className="flex items-center justify-between gap-4">
            <label htmlFor="mini-me-sleep" className="text-[12px] text-[var(--m-text)]">{tr("settings.general.miniMeSleep")}</label>
            <select
              id="mini-me-sleep"
              value={state.miniMeSleepMinutes}
              onChange={(e) => void save({ miniMeSleepMinutes: Number(e.target.value) })}
              className="rounded-md border border-[var(--m-border)] bg-transparent px-2 py-1 text-[12px]"
            >
              {[1, 5, 10, 30].map((m) => (
                <option key={m} value={m}>{m} {tr("settings.general.miniMeMinutes")}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="mini-me-hotkey" className="text-[12px] text-[var(--m-text)]">{tr("settings.general.miniMeHotkey")}</label>
            <input
              id="mini-me-hotkey"
              value={hotkeyDraft}
              onChange={(e) => setHotkeyDraft(e.target.value)}
              onBlur={() => {
                if (hotkeyDraft.trim() !== state.miniMeHotkey) void save({ miniMeHotkey: hotkeyDraft.trim() });
              }}
              className="mt-1 w-full rounded-md border border-[var(--m-border)] bg-transparent px-2 py-1 font-mono text-[12px]"
            />
            <p className={`mt-1 text-[11px] ${hotkeyOk ? "text-[var(--m-text-faint)]" : "text-red-400"}`}>
              {hotkeyOk ? tr("settings.general.miniMeHotkeyHint") : tr("settings.general.miniMeHotkeyUnavailable")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
