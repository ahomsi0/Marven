"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Activity } from "@/lib/companion/behaviour";
import type { Personality } from "@/lib/companion/brain";
import { DEFAULT_LOOK, parseLook, type Look } from "@/lib/companion/look";
import { Dropdown } from "../Dropdown";
import { AppearanceEditor } from "./AppearanceEditor";
import { Card, Row, Switch, useTr } from "./primitives";

type Speed = "slow" | "normal" | "fast";
type DropMode = "stay" | "dock";
const ACTIVITIES: Activity[] = ["lively", "calm", "still"];
const SPEEDS: Speed[] = ["slow", "normal", "fast"];
const DROP_MODES: DropMode[] = ["stay", "dock"];
const PERSONALITIES: Personality[] = ["playful", "neutral", "detailed"];
const SCALES = [2, 3, 4];
const SLEEP_MINUTES = [1, 5, 10, 30];
const LOOK_SAVE_DELAY_MS = 300;
const ACTIVITY_KEYS: Record<Activity, string> = { lively: "activityLively", calm: "activityCalm", still: "activityStill" };
const PERSONALITY_KEYS: Record<Personality, string> = { playful: "personalityPlayful", neutral: "personalityNeutral", detailed: "personalityDetailed" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type Electron = {
  getSettings: () => Promise<any>;
  saveSettings: (s: any) => Promise<any>;
  companionStatus?: () => Promise<CompanionStatus>;
  onCompanionVisibility?: (cb: () => void) => (() => void) | void;
};

interface MiniMeState {
  miniMeEnabled: boolean;
  miniMeWakeWord: boolean;
  miniMeSpeak: boolean;
  miniMeActivity: Activity;
  miniMeSpeed: Speed;
  miniMeDrop: DropMode;
  miniMePersonality: Personality;
  miniMeScale: number;
  miniMeSleepMinutes: number;
  miniMeHotkey: string;
  miniMeProjectsDir: string;
}

const DEFAULTS: MiniMeState = {
  miniMeEnabled: false,
  miniMeWakeWord: false,
  miniMeSpeak: true,
  miniMeActivity: "lively",
  miniMeSpeed: "normal",
  miniMeDrop: "stay",
  miniMePersonality: "playful",
  miniMeScale: 3,
  miniMeSleepMinutes: 5,
  miniMeHotkey: "CommandOrControl+Shift+Space",
  miniMeProjectsDir: "~/Marven Projects",
};

interface CompanionStatus {
  hotkeyOk: boolean;
  hotkeyReason?: "reserved" | "taken" | null;
  /** Linux: Marven runs natively on Wayland, where Mini Me can't move until a restart (under XWayland). */
  needsRestartForLinux?: boolean;
}

function problemOf(st: CompanionStatus): "reserved" | "taken" | null {
  if (st.hotkeyOk) return null;
  return st.hotkeyReason === "reserved" ? "reserved" : "taken";
}

/** Settings → Mini Me (desktop app only). */
export function MiniMeSettingsPage({ electron }: { electron: Electron }) {
  const { tr } = useTr();
  const [state, setState] = useState<MiniMeState>(DEFAULTS);
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [hotkeyDraft, setHotkeyDraft] = useState(DEFAULTS.miniMeHotkey);
  const [projectsDraft, setProjectsDraft] = useState(DEFAULTS.miniMeProjectsDir);
  const [hotkeyProblem, setHotkeyProblem] = useState<"reserved" | "taken" | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const applyStatus = useCallback((st: CompanionStatus | undefined) => {
    if (!st) return;
    setHotkeyProblem(problemOf(st));
    setNeedsRestart(!!st.needsRestartForLinux);
  }, []);
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
      if (!DROP_MODES.includes(next.miniMeDrop)) next.miniMeDrop = DEFAULTS.miniMeDrop;
      if (!PERSONALITIES.includes(next.miniMePersonality)) next.miniMePersonality = DEFAULTS.miniMePersonality;
      if (!SCALES.includes(next.miniMeScale)) next.miniMeScale = DEFAULTS.miniMeScale;
      if (!SLEEP_MINUTES.includes(next.miniMeSleepMinutes)) next.miniMeSleepMinutes = DEFAULTS.miniMeSleepMinutes;
      setState(next);
      setHotkeyDraft(next.miniMeHotkey);
      if (!next.miniMeProjectsDir.trim()) next.miniMeProjectsDir = DEFAULTS.miniMeProjectsDir;
      setProjectsDraft(next.miniMeProjectsDir);
      setLook(s?.miniMeLook ? parseLook(s.miniMeLook) : DEFAULT_LOOK);
    });
    void electron.companionStatus?.().then((st) => !cancelled && applyStatus(st));
    // The tray's "Show Mini Me" toggle changes the saved setting behind this page's back.
    const off = electron.onCompanionVisibility?.(() => {
      void electron.getSettings().then((s: any) => {
        if (!cancelled && typeof s?.miniMeEnabled === "boolean") setState((prev) => ({ ...prev, miniMeEnabled: s.miniMeEnabled }));
      });
      void electron.companionStatus?.().then((st) => !cancelled && applyStatus(st));
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [electron, applyStatus]);

  // The main process merges a patch into the stored settings, so send only what changed.
  const persist = useCallback(
    async (patch: Record<string, unknown>) => {
      await electron.saveSettings(patch);
    },
    [electron],
  );

  async function save(patch: Partial<MiniMeState>) {
    const previous = state;
    setState((prev) => ({ ...prev, ...patch }));
    try {
      await persist(patch);
      applyStatus(await electron.companionStatus?.());
    } catch (err) {
      console.warn("Mini Me: could not save settings", err);
      setState((prev) => {
        const reverted = { ...prev };
        for (const key of Object.keys(patch) as (keyof MiniMeState)[]) (reverted as any)[key] = previous[key];
        return reverted;
      });
      if ("miniMeHotkey" in patch) setHotkeyDraft(previous.miniMeHotkey);
      if ("miniMeProjectsDir" in patch) setProjectsDraft(previous.miniMeProjectsDir);
    }
  }

  // Colour pickers fire continuously: update the preview now, save once things settle.
  const flushLook = useCallback(() => {
    if (lookTimer.current) clearTimeout(lookTimer.current);
    lookTimer.current = null;
    const next = pendingLook.current;
    pendingLook.current = null;
    if (next) persist({ miniMeLook: next }).catch((err) => console.warn("Mini Me: could not save look", err));
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
        {state.miniMeEnabled && needsRestart && (
          <p role="status" className="text-[11px] leading-snug text-amber-400">
            {tr("settings.miniMe.linuxRestart")}
          </p>
        )}
        <div>
          <label htmlFor="mini-me-hotkey" className="text-[12px] text-[var(--m-text)]">
            {tr("settings.miniMe.hotkey")}
          </label>
          <input
            id="mini-me-hotkey"
            value={hotkeyDraft}
            spellCheck={false}
            onChange={(e) => setHotkeyDraft(e.target.value)}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (e.key === "Enter") el.blur();
              else if (e.key === "Escape") {
                e.stopPropagation();
                setHotkeyDraft(state.miniMeHotkey);
                // Revert first, then blur: the draft now equals the stored value, so blur saves nothing.
                requestAnimationFrame(() => el.blur());
              }
            }}
            onBlur={() => {
              const next = hotkeyDraft.trim();
              if (next && next !== state.miniMeHotkey) void save({ miniMeHotkey: next });
              else setHotkeyDraft(state.miniMeHotkey);
            }}
            className="mt-1 w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-1.5 font-mono text-[12px] text-[var(--m-text)] outline-none transition-colors hover:border-[var(--m-text-faint)] focus-visible:border-[var(--m-accent)]/60 focus-visible:ring-2 focus-visible:ring-[var(--m-accent-soft)]"
          />
          <p className={`mt-1 text-[11px] ${hotkeyProblem ? "text-red-400" : "text-[var(--m-text-faint)]"}`}>
            {hotkeyProblem === "reserved"
              ? tr("settings.miniMe.hotkeyReserved")
              : hotkeyProblem
                ? tr("settings.miniMe.hotkeyUnavailable")
                : tr("settings.miniMe.hotkeyHint")}
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
              label: tr(`settings.miniMe.${ACTIVITY_KEYS[v]}`),
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
        <Row id="mini-me-drop" label={tr("settings.miniMe.drop")} hint={tr("settings.miniMe.dropHint")}>
          <Dropdown<DropMode>
            aria-labelledby="mini-me-drop"
            value={state.miniMeDrop}
            onChange={(v) => void save({ miniMeDrop: v })}
            options={[
              { value: "stay", label: tr("settings.miniMe.dropStay") },
              { value: "dock", label: tr("settings.miniMe.dropDock") },
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
            const key = PERSONALITY_KEYS[p];
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
                  {tr(`settings.miniMe.${key}`)}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--m-text-faint)]">
                  {tr(`settings.miniMe.${key}Hint`)}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card title={tr("settings.miniMe.cardProjects")} hint={tr("settings.miniMe.cardProjectsHint")}>
        <div>
          <label htmlFor="mini-me-projects-dir" className="text-[12px] text-[var(--m-text)]">
            {tr("settings.miniMe.projectsDir")}
          </label>
          <input
            id="mini-me-projects-dir"
            value={projectsDraft}
            spellCheck={false}
            dir="ltr"
            onChange={(e) => setProjectsDraft(e.target.value)}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (e.key === "Enter") el.blur();
              else if (e.key === "Escape") {
                e.stopPropagation();
                setProjectsDraft(state.miniMeProjectsDir);
                requestAnimationFrame(() => el.blur());
              }
            }}
            onBlur={() => {
              const next = projectsDraft.trim();
              if (next && next !== state.miniMeProjectsDir) void save({ miniMeProjectsDir: next });
              else setProjectsDraft(state.miniMeProjectsDir);
            }}
            className="mt-1 w-full rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-1.5 font-mono text-[12px] text-[var(--m-text)] outline-none transition-colors hover:border-[var(--m-text-faint)] focus-visible:border-[var(--m-accent)]/60 focus-visible:ring-2 focus-visible:ring-[var(--m-accent-soft)]"
          />
          <p className="mt-1 text-[11px] text-[var(--m-text-faint)]">{tr("settings.miniMe.projectsDirHint")}</p>
        </div>
      </Card>

      <Card title={tr("settings.miniMe.cardAppearance")} hint={tr("settings.miniMe.cardAppearanceHint")}>
        <AppearanceEditor look={look} onChange={changeLook} />
      </Card>
    </div>
  );
}
