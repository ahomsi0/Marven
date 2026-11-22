"use client";

import { useEffect, useState } from "react";
import { lspClient } from "@/lib/editor/lspClient";
import type { LanguageId } from "@/lib/editor/lspServers";

type LspBadgeState = "idle" | "installing" | "ready" | "failed" | "restarting";

export function useLspStatus(languageId: LanguageId | null): LspBadgeState {
  const [state, setState] = useState<LspBadgeState>("idle");
  useEffect(() => {
    if (!languageId) { setState("idle"); return; }
    let cancelled = false;
    lspClient.ensure(languageId).then((r) => {
      if (cancelled) return;
      setState(r.status === "ready" ? "ready" : r.status === "installing" ? "installing" : "failed");
    });
    const off = lspClient.onStatus((s) => {
      if (s.languageId !== languageId) return;
      if (s.kind === "install" && s.state === "installing") setState("installing");
      if (s.kind === "install" && s.state === "installed") setState("ready");
      if (s.kind === "install" && s.state === "install-failed") setState("failed");
      if (s.kind === "server-exit") setState("failed");
    });
    return () => { cancelled = true; off(); };
  }, [languageId]);
  return state;
}

interface StatusBarProps {
  weather: { city: string; temp: number; description: string } | null;
  battery: number | null;
  /** Active file's LSP language ID (e.g. "typescript"). Pass null when none. */
  lspLanguageId?: LanguageId | null;
}

function formatClock(date: Date): string {
  return date.toLocaleDateString([], { weekday: "long" }) +
    ", " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function StatusBar({ weather, battery, lspLanguageId = null }: StatusBarProps) {
  const [time, setTime] = useState(() => formatClock(new Date()));
  const lspState = useLspStatus(lspLanguageId);

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(formatClock(new Date()));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  function batteryColor(pct: number): string {
    if (pct > 50) return "text-emerald-400";
    if (pct >= 20) return "text-yellow-400";
    return "text-red-400";
  }

  return (
    <div className="flex items-center justify-between text-[11px] text-zinc-500">
      <span className="text-[#d19a66]/60">{time}</span>
      {weather && (
        <span>
          {weather.temp}°C &middot; {weather.description}
        </span>
      )}
      {battery !== null && (
        <span className={batteryColor(battery)}>Battery {battery}%</span>
      )}
      {lspLanguageId && lspState !== "idle" && (
        <span
          className={
            lspState === "ready"
              ? "text-emerald-400"
              : lspState === "installing"
                ? "text-yellow-400"
                : "text-red-400"
          }
          title={`LSP (${lspLanguageId}): ${lspState}`}
        >
          LSP {lspState}
        </span>
      )}
    </div>
  );
}
