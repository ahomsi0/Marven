"use client";

import { useEffect, useState } from "react";

interface StatusBarProps {
  weather: { city: string; temp: number; description: string } | null;
  battery: number | null;
}

function formatClock(date: Date): string {
  return date.toLocaleDateString([], { weekday: "long" }) +
    ", " +
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function StatusBar({ weather, battery }: StatusBarProps) {
  const [time, setTime] = useState(() => formatClock(new Date()));

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
    </div>
  );
}
