"use client";

import { useEffect, useState } from "react";

export function TitleBar() {
  const [isElectron, setIsElectron] = useState(false);
  const [isWindows, setIsWindows] = useState(false);

  useEffect(() => {
    const el = (window as unknown as { marvenElectron?: { platform?: string } }).marvenElectron;
    if (!el) return;
    setIsElectron(true);
    setIsWindows(el.platform === "win32");
  }, []);

  if (!isElectron) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electron = (window as any).marvenElectron;

  return (
    <div
      className="relative flex h-9 w-full shrink-0 items-center"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Windows controls — right side */}
      {isWindows && (
        <div
          className="ml-auto flex h-full"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Minimize */}
          <button
            type="button"
            onClick={() => electron.minimize()}
            className="flex h-full w-11 items-center justify-center text-[var(--m-text-muted)] hover:bg-[var(--m-surface-3)] hover:text-white transition-colors"
            aria-label="Minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
              <rect width="10" height="1" />
            </svg>
          </button>

          {/* Maximize */}
          <button
            type="button"
            onClick={() => electron.maximize()}
            className="flex h-full w-11 items-center justify-center text-[var(--m-text-muted)] hover:bg-[var(--m-surface-3)] hover:text-white transition-colors"
            aria-label="Maximize"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" />
            </svg>
          </button>

          {/* Close */}
          <button
            type="button"
            onClick={() => electron.close()}
            className="flex h-full w-11 items-center justify-center text-[var(--m-text-muted)] hover:bg-red-600 hover:text-white transition-colors"
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
              <line x1="0" y1="0" x2="10" y2="10" />
              <line x1="10" y1="0" x2="0" y2="10" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
