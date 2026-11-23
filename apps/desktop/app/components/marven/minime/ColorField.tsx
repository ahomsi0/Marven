"use client";

import { useId } from "react";
import { useTr } from "./primitives";

interface Props {
  label: string;
  value: string;
  presets: readonly string[];
  onChange: (color: string) => void;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** A row of preset swatches plus a custom colour picker. */
export function ColorField({ label, value, presets, onChange }: Props) {
  const { tr } = useTr();
  const labelId = useId();
  const custom = !presets.some((p) => same(p, value));

  return (
    <div className="flex items-center gap-3">
      <span id={labelId} className="w-20 shrink-0 text-[12px] text-[var(--m-text-muted)]">
        {label}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {presets.map((color) => {
          const selected = same(color, value);
          return (
            <button
              key={color}
              type="button"
              title={color}
              aria-label={tr("settings.miniMe.useColor", { color })}
              aria-pressed={selected}
              onClick={() => onChange(color)}
              style={{ backgroundColor: color }}
              className={`h-5 w-5 rounded-full border border-black/15 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-[var(--m-accent)] dark:border-white/20 ${
                selected ? "ring-2 ring-[var(--m-accent)] ring-offset-2 ring-offset-[var(--m-surface)]" : ""
              }`}
            />
          );
        })}
        <label
          title={tr("settings.miniMe.customColor")}
          className={`relative block h-5 w-5 cursor-pointer overflow-hidden rounded-full border border-black/15 transition-transform focus-within:ring-2 focus-within:ring-[var(--m-accent)] hover:scale-110 dark:border-white/20 ${
            custom ? "ring-2 ring-[var(--m-accent)] ring-offset-2 ring-offset-[var(--m-surface)]" : ""
          }`}
          style={{
            background: custom
              ? value
              : "conic-gradient(#ef4444, #f59e0b, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)",
          }}
        >
          <input
            type="color"
            value={value}
            aria-label={`${label}: ${tr("settings.miniMe.customColor")}`}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
}
