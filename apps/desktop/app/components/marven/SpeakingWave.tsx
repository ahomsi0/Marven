"use client";

interface SpeakingWaveProps {
  active: boolean;
}

export function SpeakingWave({ active }: SpeakingWaveProps) {
  if (!active) return null;

  return (
    <div className="flex items-center gap-[3px]" aria-hidden="true">
      <span className="wave-bar h-3 w-0.5 rounded-full bg-[#5b9cf6]" />
      <span className="wave-bar h-3 w-0.5 rounded-full bg-[#5b9cf6]" />
      <span className="wave-bar h-3 w-0.5 rounded-full bg-[#5b9cf6]" />
      <span className="wave-bar h-3 w-0.5 rounded-full bg-[#5b9cf6]" />
      <span className="wave-bar h-3 w-0.5 rounded-full bg-[#5b9cf6]" />
    </div>
  );
}
