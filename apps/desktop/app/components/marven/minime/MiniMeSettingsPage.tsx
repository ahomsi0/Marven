"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import type { Activity } from "@/lib/companion/behaviour";
import type { Personality } from "@/lib/companion/brain";
import { DEFAULT_LOOK, parseLook, type Look } from "@/lib/companion/look";
import { Dropdown } from "../Dropdown";
import { AppearanceEditor } from "./AppearanceEditor";
import { Card, Row, Switch } from "./primitives";

type Speed = "slow" | "normal" | "fast";
const ACTIVITIES: Activity[] = ["lively", "calm", "still"];
const SPEEDS: Speed[] = ["slow", "normal", "fast"];
const PERSONALITIES: Personality[] = ["playful", "neutral", "detailed"];
const SCALES = [2, 3, 4];
const SLEEP_MINUTES = [1, 5, 10, 30];
const LOOK_SAVE_DELAY_MS = 300;

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

/** Settings → Mini Me (desktop app only). */
export function MiniMeSettingsPage({ electron }: { electron: Electron }) {
  const { t } = useT();
  // Keys built from ids can't be checked by the typed `t`.
  const tr = t as unknown as (key: string, opts?: Record<string, unknown>) => string;
  const [state, setState] = useState<MiniMeState>(DEFAULTS);
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [hotkeyDraft, setHotkeyDraft] = useState(DEFAULTS.miniMeHotkey);
  const [hotkeyOk, setHotkeyOk] = useState(true);
  const pendingLook = useRef<Look | null>(null);
  const lookTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void electron.getSettings().then((s: any) => {
      if (cancelled) return;
      const next = { ...DEFAULTS };
      for (const key of Object.keys(DEFAULTS) as (keyof MiniMeState)[]) {
        if (typeof s?.[key] === typeof DEFAULTS[key]) (next as any)[key] = s[key];
      }
      // Only accept values the dropdowns offer; anything else falls back to the default.
      if (!ACTIVITIES.includes(next.miniMeActivity)) next.miniMeActivity = DEFAULTS.miniMeActivity;
      if (!SPEEDS.includes(next.miniMeSpeed)) next.miniMeSpeed = DEFAULTS.miniMeSpeed;
      if (!PERSONALITIES.includes(next.miniMePersonality)) next.miniMePersonality = DEFAULTS.miniMePersonality;
      if (!SCALES.includes(next.miniMeScale)) next.miniMeScale = DEFAULTS.miniMeScale;
      setState(next);
      setHotkeyDraft(next.miniMeHotkey);
      setLook(s?.miniMeLook ? parseLook(s.miniMeLook) : DEFAULT_LOOK);
    });
    void electron.companionStatus?.().then((st) => !cancelled && setHotkeyOk(st.hotkeyOk));
    return () => {
      cancelled = true;
    };
  }, [electron]);

  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      const current = await electron.getSettings();
      await electron.saveSettings({ ...current, ...patch });
    },
    [electron],
  );

  async function save(patch: Partial<MiniMeState>) {
    setState((prev) => ({ ...prev, ...patch }));
    await persist(patch);
    const st = await electron.companionStatus?.();
    if (st) setHotkeyOk(st.hotkeyOk);
  }

  // Colour pickers fire continuously: update the preview now, save once things settle.
  const flushLook = useCallback(() => {
    if (lookTimer.current) clearTimeout(lookTimer.current);
    lookTimer.current = null;
    const next = pendingLook.current;
    pendingLook.current = null;
    if (next) void persist({ miniMeLook: next });
  }, [persist]);

  const changeLook = (next: Look) => {
    setLook(next);
    pendingLook.current = next;
    if (lookTimer.current) clearTimeout(lookTimer.current);
    lookTimer.current = setTimeout(flushLook, LOOK_SAVE_DELAY_MS);
  };

  // Don't lose the last change if the page is closed within the debounce window.
  useEffect(() => flushLook, [flushLook]);

  const dropdownWidth = "w-44";

  return (
    <div className="space-y-5">
      <Card title={tr("settings.miniMe.cardMini")} hint={tr("settings.miniMe.cardMiniHint")}>
        <Row id="mini-me-enabled" label={tr("settings.miniMe.enabled")} hint={tr("settings.miniMe.enabledHint")}>
          <Switch labelledBy="mini-me-enabled" checked={state.miniMeEnabled} onChange={(v) => void save({ miniMeEnabled: v })} />
        </Row>
        <div>
          <label htmlFor="mini-me-hotkey" className="text-[12px] text-[var(--m-text)]">
            {tr("settings.miniMe.hotkey")}
          </label>
          <input
            id="mini-me-hotkey"
            value={hotkeyDraft}
            spellCheck={false}
            onChange={(e) => setHotkeyDraft(e.target.value)}
            onBlur={() => {
              const next = hotkeyDraft.trim();
              if (next && next !== state.miniMeHotkey) void save({ miniMeHotkey: next });
              else setHotkeyDraft(state.miniMeHotkey);
            }}
            className="mt-1 w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-1.5 font-mono text-[12px] text-[var(--m-text)] outline-none transition-colors hover:border-[var(--m-text-faint)] focus-visible:border-[var(--m-accent)]/60 focus-visible:ring-2 focus-visible:ring-[var(--m-accent-soft)]"
          />
          <p className={`mt-1 text-[11px] ${hotkeyOk ? "text-[var(--m-text-faint)]" : "text-red-400"}`}>
            {hotkeyOk ? tr("settings.miniMe.hotkeyHint") : tr("settings.miniMe.hotkeyUnavailable")}
          </p>
        </div>
        <Row id="mini-me-wake" label={tr("settings.miniMe.wake")} hint={tr("settings.miniMe.wakeHint")}>
          <Switch labelledBy="mini-me-wake" checked={state.miniMeWakeWord} onChange={(v) => void save({ miniMeWakeWord: v })} />
        </Row>
        <Row id="mini-me-speak" label={tr("settings.miniMe.speak")} hint={tr("settings.miniMe.speakHint")}>
          <Switch labelledBy="mini-me-speak" checked={state.miniMeSpeak} onChange={(v) => void save({ miniMeSpeak: v })} />
        </Row>
      </Card>

      <Card title={tr("settings.miniMe.cardBehaviour")} hint={tr("settings.miniMe.cardBehaviourHint")}>
        <Row id="mini-me-activity" label={tr("settings.miniMe.activity")}>
          <Dropdown<Activity>
            aria-labelledby="mini-me-activity"
            value={state.miniMeActivity}
            onChange={(v) => void save({ miniMeActivity: v })}
            options={ACTIVITIES.map((v) => ({
              value: v,
              label: tr(`settings.miniMe.activity${v === "still" ? "Still" : v === "calm" ? "Calm" : "Lively"}`),
            }))}
            className={dropdownWidth}
          />
        </Row>
        <Row id="mini-me-speed" label={tr("settings.miniMe.speed")}>
          <Dropdown<Speed>
            aria-labelledby="mini-me-speed"
            value={state.miniMeSpeed}
            onChange={(v) => void save({ miniMeSpeed: v })}
            options={[
              { value: "slow", label: tr("settings.miniMe.speedSlow") },
              { value: "normal", label: tr("settings.miniMe.speedNormal") },
              { value: "fast", label: tr("settings.miniMe.speedFast") },
            ]}
            className={dropdownWidth}
          />
        </Row>
        <Row id="mini-me-size" label={tr("settings.miniMe.size")}>
          <Dropdown
            aria-labelledby="mini-me-size"
            value={String(state.miniMeScale)}
            onChange={(v) => void save({ miniMeScale: Number(v) })}
            options={SCALES.map((s) => ({ value: String(s), label: `${s}×` }))}
            className={dropdownWidth}
          />
        </Row>
        <Row id="mini-me-sleep" label={tr("settings.miniMe.sleep")}>
          <Dropdown
            aria-labelledby="mini-me-sleep"
            value={String(state.miniMeSleepMinutes)}
            onChange={(v) => void save({ miniMeSleepMinutes: Number(v) })}
            options={SLEEP_MINUTES.map((m) => ({ value: String(m), label: tr(`settings.miniMe.sleepOptions.m${m}`) }))}
            className={dropdownWidth}
          />
        </Row>
      </Card>

      <Card title={tr("settings.miniMe.cardPersonality")} hint={tr("settings.miniMe.cardPersonalityHint")}>
        <div role="radiogroup" aria-label={tr("settings.miniMe.cardPersonality")} className="grid gap-2 sm:grid-cols-3">
          {PERSONALITIES.map((p) => {
            const selected = state.miniMePersonality === p;
            const name = p === "playful" ? "Playful" : p === "neutral" ? "Neutral" : "Detailed";
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void save({ miniMePersonality: p })}
                className={`rounded-lg border px-3 py-2.5 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--m-accent-soft)] ${
                  selected
                    ? "border-[var(--m-accent)]/60 bg-[var(--m-accent)]/10"
                    : "border-[var(--m-border)] hover:border-[var(--m-text-faint)] hover:bg-[var(--m-surface-2)]"
                }`}
              >
                <span className={`block text-[12px] font-medium ${selected ? "text-[var(--m-accent)]" : "text-[var(--m-text)]"}`}>
                  {tr(`settings.miniMe.personality${name}`)}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--m-text-faint)]">
                  {tr(`settings.miniMe.personality${name}Hint`)}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title={tr("settings.miniMe.cardAppearance")} hint={tr("settings.miniMe.cardAppearanceHint")}>
        <AppearanceEditor look={look} onChange={changeLook} />
      </Card>
    </div>
  );
}
