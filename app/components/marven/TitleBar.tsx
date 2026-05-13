"use client";

import { useEffect, useState } from "react";
import { MarvenLogo } from "./MarvenLogo";

export function TitleBar() {
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!(window as any).marvenElectron);
  }, []);

  if (!isElectron) return null;

  // Drag region with centred logo — traffic lights sit on the left via Electron
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
      </div>
    </div>
  );
}
