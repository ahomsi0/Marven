"use client";

import { useEffect, useId, useState } from "react";
import { useT } from "@/lib/i18n";
import { Dropdown } from "../Dropdown";
import { CompanionSprite } from "@/app/companion/CompanionSprite";
import type { AnimState } from "@/lib/companion/behaviour";
import { COLOR_PRESETS, DEFAULT_LOOK, HAIR_STYLES, randomLook, type ColorKey, type Look } from "@/lib/companion/look";
import { ColorField } from "./ColorField";
import { Switch } from "./primitives";

const POSES = ["idle", "walk", "talk", "happy", "sleep", "sit"] as const satisfies readonly AnimState[];
type Pose = (typeof POSES)[number];

/** Checkerboard that follows the theme. */
const CHECKER = {
  backgroundColor: "var(--m-surface-2)",
  backgroundImage:
    "linear-gradient(45deg, var(--m-surface-3) 25%, transparent 25%, transparent 75%, var(--m-surface-3) 75%), linear-gradient(45deg, var(--m-surface-3) 25%, transparent 25%, transparent 75%, var(--m-surface-3) 75%)",
  backgroundSize: "20px 20px",
  backgroundPosition: "0 0, 10px 10px",
} as const;

function Preview({ look }: { look: Look }) {
  const { t } = useT();
  const tr = t as unknown as (key: string) => string;
  const [pose, setPose] = useState<Pose>("idle");
  // One-shot poses (happy) stop on their last frame; restart them after a beat.
  const [run, setRun] = useState(0);
  const [replay, setReplay] = useState(false);
  useEffect(() => {
    if (!replay) return;
    const timer = setTimeout(() => {
      setReplay(false);
      setRun((n) => n + 1);
    }, 900);
    return () => clearTimeout(timer);
  }, [replay]);

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="flex h-[200px] items-center justify-center overflow-hidden rounded-lg border border-[var(--m-border-subtle)]"
        style={CHECKER}
      >
        <CompanionSprite
          key={`${pose}-${run}`}
          look={look}
          anim={pose}
          facing={1}
          scale={4}
          onOneshotDone={() => setReplay(true)}
        />
      </div>
      <Dropdown<Pose>
        size="sm"
        value={pose}
        onChange={setPose}
        aria-label={tr("settings.miniMe.previewPose")}
        options={POSES.map((p) => ({ value: p, label: tr(`settings.miniMe.poses.${p}`) }))}
        className="w-full"
      />
    </div>
  );
}

function GroupTitle({ children }: { children: string }) {
  return (
    <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--m-text-faint)]">{children}</h4>
  );
}

const OUTFIT: ColorKey[] = ["shirt", "pants", "shoes"];

export function AppearanceEditor({ look, onChange }: { look: Look; onChange: (next: Look) => void }) {
  const { t, i18n } = useT();
  // Keys built from ids (hair styles, colour fields) can't be checked by the typed `t`.
  const tr = t as unknown as (key: string, opts?: Record<string, unknown>) => string;
  const glassesId = useId();
  const beardId = useId();
  const set = (patch: Partial<Look>) => onChange({ ...look, ...patch });

  const hairStyleLabel = (id: string) => {
    const key = `settings.miniMe.hairStyles.${id}`;
    return i18n.exists(key) ? tr(key) : id.charAt(0).toUpperCase() + id.slice(1);
  };
  const colorLabel = (key: ColorKey) => tr(`settings.miniMe.${key}`);

  const field = (key: ColorKey, label = colorLabel(key)) => (
    <ColorField label={label} value={look[key]} presets={COLOR_PRESETS[key]} onChange={(c) => set({ [key]: c })} />
  );

  const chip = "rounded-md border px-2.5 py-1 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--m-accent-soft)]";
  const actionBtn =
    "rounded-md border border-[var(--m-border)] bg-[var(--m-surface-2)] px-3 py-1.5 text-[12px] text-[var(--m-text)] outline-none transition-colors hover:border-[var(--m-text-faint)] focus-visible:ring-2 focus-visible:ring-[var(--m-accent-soft)]";

  return (
    <div className="grid gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="md:sticky md:top-0 md:self-start">
        <Preview look={look} />
      </div>

      <div className="min-w-0 space-y-5">
        <div className="space-y-3">
          <GroupTitle>{tr("settings.miniMe.groupHead")}</GroupTitle>
          <div className="flex items-start justify-between gap-3">
            <span id={`${glassesId}-hair`} className="w-20 shrink-0 pt-1 text-[12px] text-[var(--m-text-muted)]">
              {tr("settings.miniMe.hairStyle")}
            </span>
            <div role="group" aria-labelledby={`${glassesId}-hair`} className="flex flex-1 flex-wrap gap-1.5">
              {HAIR_STYLES.map((style) => {
                const selected = look.hairStyle === style;
                return (
                  <button
                    key={style}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => set({ hairStyle: style })}
                    className={`${chip} ${
                      selected
                        ? "border-[var(--m-accent)]/60 bg-[var(--m-accent)]/10 text-[var(--m-accent)]"
                        : "border-[var(--m-border)] text-[var(--m-text-muted)] hover:border-[var(--m-text-faint)] hover:text-[var(--m-text)]"
                    }`}
                  >
                    {hairStyleLabel(style)}
                  </button>
                );
              })}
            </div>
          </div>
          {field("skin")}
          {field("hair")}
          {field("eyes")}
        </div>

        <div className="space-y-3 border-t border-[var(--m-border-subtle)] pt-4">
          <GroupTitle>{tr("settings.miniMe.groupOutfit")}</GroupTitle>
          {OUTFIT.map((key) => (
            <div key={key}>{field(key)}</div>
          ))}
        </div>

        <div className="space-y-3 border-t border-[var(--m-border-subtle)] pt-4">
          <GroupTitle>{tr("settings.miniMe.groupExtras")}</GroupTitle>
          <div className="flex items-center justify-between gap-3">
            <span id={glassesId} className="text-[12px] text-[var(--m-text-muted)]">{tr("settings.miniMe.glasses")}</span>
            <Switch labelledBy={glassesId} checked={look.glasses} onChange={(glasses) => set({ glasses })} />
          </div>
          {look.glasses && field("glassesColor")}
          <div className="flex items-center justify-between gap-3">
            <span id={beardId} className="text-[12px] text-[var(--m-text-muted)]">{tr("settings.miniMe.beard")}</span>
            <Switch labelledBy={beardId} checked={look.beard} onChange={(beard) => set({ beard })} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-[var(--m-border-subtle)] pt-4">
          <button type="button" className={actionBtn} onClick={() => onChange(randomLook())}>
            {tr("settings.miniMe.randomise")}
          </button>
          <button type="button" className={actionBtn} onClick={() => onChange({ ...DEFAULT_LOOK })}>
            {tr("settings.miniMe.reset")}
          </button>
        </div>
      </div>
    </div>
  );
}
