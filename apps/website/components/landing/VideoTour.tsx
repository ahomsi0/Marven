"use client";

import { useRef, useState } from "react";
import { PlayIcon } from "../Icons";

/** The explainer video. Nothing downloads until the visitor presses play. */
export function VideoTour() {
  const [playing, setPlaying] = useState(false);
  const video = useRef<HTMLVideoElement>(null);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-line-2 bg-[#090b10] shadow-[var(--shadow)]">
      <video
        ref={video}
        className="aspect-video w-full"
        src="/media/marven-explainer.mp4"
        poster="/media/explainer-poster.jpg"
        preload="none"
        playsInline
        controls={playing}
        onEnded={() => setPlaying(false)}
      >
        <track kind="captions" src="/media/marven-explainer.vtt" srcLang="en" label="English" />
      </video>
      {!playing && (
        <button
          type="button"
          onClick={() => {
            setPlaying(true);
            void video.current?.play();
          }}
          className="group absolute inset-0 grid place-items-center bg-gradient-to-t from-black/50 via-black/10 to-transparent"
          aria-label="Play the Marven tour video (1 minute 44 seconds, narrated, with captions)"
        >
          <span className="flex items-center gap-3 rounded-full border border-white/15 bg-black/55 py-2 pl-2 pr-5 text-sm font-medium text-white backdrop-blur-md transition group-hover:scale-[1.03] group-hover:bg-black/70">
            <span className="grid size-10 place-items-center rounded-full bg-white text-[#090b10]">
              <PlayIcon size={18} className="translate-x-px" />
            </span>
            Watch the tour
            <span className="font-mono text-xs text-white/60">1:44</span>
          </span>
        </button>
      )}
    </div>
  );
}
