"use client";

import { useEffect, useState } from "react";
import { MarvenLogo } from "./MarvenLogo";

export function TitleBar() {
  const [isElectron, setIsElectron] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const electron = (window as any).marvenElectron;
    if (!electron) return;
    setIsElectron(true);
    electron.getVersion().then(setVersion);
  }, []);

  if (!isElectron) return null;

  return (
    <div
      className="relative flex h-9 w-full shrink-0 items-center justify-center"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div className="flex items-center gap-1.5 select-none">
        <MarvenLogo size={18} />
        <span className="text-[12px] font-semibold tracking-wide text-[rgba(232,232,234,0.55)]">
          Marven
        </span>
        {version && (
          <span className="text-[10px] text-[rgba(232,232,234,0.25)] font-mono">
            v{version}
          </span>
        )}
      </div>
    </div>
  );
}
