"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MiniMeSprite } from "../MiniMeSprite";
import { Logo } from "../Logo";
import {
  ClockIcon,
  FolderIcon,
  GlobeIcon,
  LockIcon,
  MicIcon,
  MoonIcon,
  MusicIcon,
  ShieldIcon,
  SparkIcon,
  TerminalIcon,
} from "../Icons";
import { MINI_ME_LOOKS, MINI_ME_STYLES, type MiniMeLook, type MiniMeState, type MiniMeStyle } from "@/lib/miniMeArt";
import { Em, SectionHeading } from "./Section";

/* ------------------------------------------------------------------ */
/* The desktop vignette: Mini Me walks in above the Dock, opens an     */
/* app, sets a timer, builds a website (painting while the preview     */
/* beside his bubble fills in), changes it, then sits, naps and        */
/* strolls back. Purely decorative; screen readers get a summary.      */
/* ------------------------------------------------------------------ */

const START_X = 18;
const MID_X = 38;
const SITE = "portfolio website";

type Scene = {
  pose: MiniMeState;
  /** Centre of Mini Me, as a percentage of the desktop's width. */
  x: number;
  walkMs: number;
  bubble: boolean;
  reply: string | null;
  draft: string;
  /** How long the draft takes to type; 0 shows it at once. */
  typeMs: number;
  bounce: "music" | null;
  musicOpen: boolean;
  timer: boolean;
  /** Building or changing the site: what the bubble's progress line says. */
  building: string | null;
  step: number;
  /** The live preview beside the bubble: 0 hidden, 1 waiting, then 2-4 as sections appear. */
  preview: number;
  /** The change asked for: a red background. */
  red: boolean;
  /** A finished build: "Show preview" in the bubble. */
  done: boolean;
};

const BASE: Scene = {
  pose: "idle",
  x: START_X,
  walkMs: 0,
  bubble: false,
  reply: null,
  draft: "",
  typeMs: 0,
  bounce: null,
  musicOpen: false,
  timer: false,
  building: null,
  step: 0,
  preview: 0,
  red: false,
  done: false,
};

/** What a visitor with reduced motion sees: one finished build, standing still. */
const STILL: Scene = { ...BASE, x: MID_X, bubble: true, reply: "Your portfolio website is ready.", done: true, preview: 4, musicOpen: true, timer: true };

const STEPS: [number, Partial<Scene>][] = [
  [0, { pose: "walk", x: MID_X, walkMs: 3000 }],
  [3000, { pose: "look" }],
  [5000, { pose: "listen", bubble: true, draft: "open Spotify", typeMs: 800 }],
  [6300, { pose: "think", draft: "", reply: "…" }],
  [7100, { pose: "talk", reply: "Opening Spotify.", bounce: "music", musicOpen: true }],
  [8300, { pose: "happy", bounce: null }],
  [9200, { pose: "idle" }],
  [9800, { pose: "listen", draft: "set a timer for 10 minutes", typeMs: 1400 }],
  [11700, { pose: "think", draft: "", reply: "…" }],
  [12400, { pose: "talk", reply: "Timer set for 10 minutes.", timer: true }],
  [13600, { pose: "idle" }],
  [14300, { pose: "listen", reply: null, draft: `make me a ${SITE}`, typeMs: 1500 }],
  [16200, { pose: "paint", draft: "", building: `Building ${SITE}`, step: 1, preview: 1 }],
  [17200, { step: 2, preview: 2 }],
  [18200, { step: 3, preview: 3 }],
  [19200, { step: 4, preview: 4 }],
  [20200, { pose: "happy", building: null, reply: `Your ${SITE} is ready.`, done: true }],
  [21300, { pose: "idle" }],
  [21800, { pose: "listen", reply: null, done: false, draft: "make the background red", typeMs: 1200 }],
  [23400, { pose: "paint", draft: "", building: `Changing ${SITE}`, step: 1 }],
  [24600, { step: 2, red: true }],
  [25400, { pose: "happy", building: null, reply: "Done. The background is red now.", done: true }],
  [26800, { pose: "idle", bubble: false, preview: 0, done: false, reply: null }],
  [27800, { pose: "sit" }],
  [29600, { pose: "sleep" }],
  [32600, { pose: "stretch", timer: false, red: false, musicOpen: false }],
  [33700, { pose: "walk", x: START_X, walkMs: 3000 }],
];
const LOOP_MS = 37000;

const sceneAt = (step: number) => STEPS.slice(0, step + 1).reduce<Scene>((s, [, u]) => ({ ...s, ...u }), BASE);

function useScene() {
  const [scene, setScene] = useState<Scene>(BASE);
  const [timerSetAt, setTimerSetAt] = useState<number | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setScene(STILL);
      return;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    let loop: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      timers.forEach(clearTimeout);
      setScene(BASE);
      timers = STEPS.map(([at], i) =>
        setTimeout(() => {
          const next = sceneAt(i);
          setScene(next);
          if (STEPS[i][1].timer) setTimerSetAt(Date.now());
        }, at + 300),
      );
    };
    // Only play while on screen, from the top each time it comes back into view.
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !loop) {
          run();
          loop = setInterval(run, LOOP_MS);
        } else if (!e.isIntersecting && loop) {
          clearInterval(loop);
          loop = undefined;
          timers.forEach(clearTimeout);
        }
      },
      { threshold: 0.3 },
    );
    if (root.current) io.observe(root.current);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
      if (loop) clearInterval(loop);
    };
  }, []);

  return { scene, timerSetAt, ref: root };
}

/** Types `text` out over `ms`, like someone typing into the bubble. */
function Typed({ text, ms }: { text: string; ms: number }) {
  const [n, setN] = useState(ms ? 0 : text.length);
  useEffect(() => {
    if (!ms) return setN(text.length);
    setN(0);
    const each = ms / text.length;
    const id = setInterval(() => setN((v) => (v >= text.length ? v : v + 1)), each);
    return () => clearInterval(id);
  }, [text, ms]);
  return (
    <>
      {text.slice(0, n)}
      <span className="caret" />
    </>
  );
}

function Countdown({ since }: { since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = Math.max(0, 600 - Math.floor((now - (since ?? now)) / 1000));
  return (
    <>
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </>
  );
}

function Bubble({ scene }: { scene: Scene }) {
  return (
    <div
      className="absolute bottom-full left-1/2 mb-1 w-[232px] -translate-x-1/2 sm:w-[260px]"
      style={{ animation: "float-in .35s cubic-bezier(.2,.7,.2,1) both" }}
    >
      <div className="relative rounded-xl border border-line-2 bg-panel p-2.5 text-left text-[12.5px] text-ink-2 shadow-[0_18px_40px_-18px_rgba(0,0,0,.55)]">
        {scene.building && (
          <div className="mb-2">
            <p className="flex items-center gap-2 font-medium text-ink">
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber opacity-50" />
                <span className="relative inline-flex size-2 rounded-full bg-amber" />
              </span>
              <span className="min-w-0 flex-1 truncate">{scene.building}</span>
              <span className="shrink-0 font-mono text-[10.5px] text-dim">Step {scene.step}</span>
            </p>
            <p className="mt-0.5 truncate pl-4 text-[11.5px] text-dim">
              {["Planning it out…", "Writing index.html…", "Writing style.css…", "Adding the projects…", "Checking it over…"][scene.step] ?? "Working on it…"}
            </p>
          </div>
        )}
        {scene.reply && <p className="mb-2 leading-snug text-ink">{scene.reply}</p>}
        {scene.done && (
          <div className="mb-2 flex gap-1.5 text-[11.5px]">
            <span className="rounded-md bg-brand px-2 py-1 font-medium text-on-brand">Show preview</span>
            <span className="rounded-md border border-line-2 px-2 py-1 text-mute">Open in Marven</span>
          </div>
        )}
        <div className="truncate rounded-md border border-line px-2 py-1.5 text-[12px]">
          {scene.draft ? (
            <span className="text-ink">
              <Typed key={scene.draft} text={scene.draft} ms={scene.typeMs} />
            </span>
          ) : (
            <span className="text-dim">Tell me what to do…</span>
          )}
        </div>
        <span className="absolute -bottom-[7px] left-1/2 size-3 -translate-x-1/2 rotate-45 border-b border-r border-line-2 bg-panel" />
      </div>
    </div>
  );
}

/** The live preview, docked beside Mini Me's bubble: the site fills in as he builds it. */
function Preview({ scene }: { scene: Scene }) {
  const shown = (n: number) => (scene.preview >= n ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1");
  return (
    <div
      className={`absolute bottom-full left-1/2 mb-1 ml-[142px] hidden w-[236px] transition duration-300 md:block ${
        scene.preview ? "opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
    >
      <div className="overflow-hidden rounded-xl border border-line-2 bg-panel shadow-[0_18px_40px_-18px_rgba(0,0,0,.55)]">
        <div className="flex h-7 items-center gap-1.5 border-b border-line px-2 font-mono text-[9.5px] text-dim">
          <span className="text-mute">✕</span>
          <span className="min-w-0 flex-1 truncate rounded bg-bg-2 px-1.5 py-0.5">
            <span className="text-ink-2">{SITE}</span> · 127.0.0.1:5173
          </span>
          <GlobeIcon size={11} />
          <FolderIcon size={11} />
        </div>
        <div className={`h-[146px] p-2 transition-colors duration-500 ${scene.red ? "bg-[#e24b4a]" : "bg-[#f5f5f0]"}`}>
          {scene.preview === 1 ? (
            <p className="grid h-full place-items-center font-mono text-[10px] text-[#8a8a8a]">Waiting for the first page…</p>
          ) : (
            <div className="space-y-1.5">
              <div className={`rounded bg-[#222] px-2 py-2 text-center transition duration-300 ${shown(2)}`}>
                <p className="text-[11px] font-semibold text-white">Sara Haddad</p>
                <p className="text-[8px] text-white/70">Designer &amp; developer</p>
              </div>
              <div className={`rounded bg-white px-2 py-1.5 transition duration-300 ${shown(3)}`}>
                <p className="text-[8.5px] font-semibold text-[#333]">About me</p>
                <div className="mt-1 h-1 w-11/12 rounded bg-[#ddd]" />
                <div className="mt-0.5 h-1 w-2/3 rounded bg-[#ddd]" />
              </div>
              <div className={`grid grid-cols-3 gap-1 transition duration-300 ${shown(4)}`}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="rounded bg-white p-1">
                    <div className="h-5 rounded-sm bg-[#cfd8e3]" />
                    <div className="mt-1 h-1 w-3/4 rounded bg-[#ddd]" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DockTile({ children, className, bounce, running, label }: { children: ReactNode; className: string; bounce?: boolean; running?: boolean; label: string }) {
  return (
    <span className="relative flex flex-col items-center" title={label}>
      <span
        key={bounce ? "b" : "s"}
        className={`grid size-9 place-items-center rounded-[10px] shadow-[inset_0_1px_0_rgba(255,255,255,.18)] sm:size-11 sm:rounded-xl ${className}`}
        style={bounce ? { animation: "mm-bounce .9s ease-out 2" } : undefined}
      >
        {children}
      </span>
      <span className={`absolute -bottom-[5px] size-1 rounded-full bg-ink-2/70 ${running ? "" : "opacity-0"}`} />
    </span>
  );
}

function Desktop({ artStyle, look }: { artStyle: MiniMeStyle; look: MiniMeLook }) {
  const { scene, timerSetAt, ref } = useScene();

  return (
    <div ref={ref} className="relative">
      <p className="sr-only">
        Animated example: Mini Me walks along the bottom of a desktop, just above the Dock. Asked to open Spotify, it
        replies &ldquo;Opening Spotify.&rdquo; Asked to set a timer for 10 minutes, it replies &ldquo;Timer set for 10
        minutes.&rdquo; Asked to make a portfolio website, it paints with a roller while a live preview beside its bubble
        fills in, then says the site is ready. Asked to make the background red, it changes the same site. Then it sits
        down, naps, stretches and walks off.
      </p>
      <div
        aria-hidden="true"
        className="relative h-[420px] overflow-hidden rounded-2xl border border-line-2 bg-bg-2 shadow-[var(--shadow)] sm:h-[460px]"
      >
        {/* Wallpaper */}
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-70" />
        <div className="pointer-events-none absolute -left-24 -top-32 h-[26rem] w-[40rem] rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]" />
        <div className="pointer-events-none absolute -bottom-40 -right-20 h-[24rem] w-[36rem] rounded-full bg-[radial-gradient(closest-side,var(--amber-soft),transparent)]" />

        {/* Menu bar */}
        <div className="relative flex h-7 items-center gap-4 border-b border-line bg-panel/70 px-3.5 font-mono text-[10.5px] text-mute backdrop-blur">
          <span className="flex items-center gap-1.5 font-semibold text-ink">
            <Logo size={12} className="text-brand" /> Marven
          </span>
          <span className="hidden sm:inline">File</span>
          <span className="hidden sm:inline">Edit</span>
          <span className="hidden sm:inline">View</span>
          <span className="ml-auto flex items-center gap-3">
            {scene.timer && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-soft px-1.5 text-amber" style={{ animation: "float-in .4s ease both" }}>
                <ClockIcon size={11} />
                <Countdown since={timerSetAt} />
              </span>
            )}
            <span>9:41</span>
          </span>
        </div>

        {/* Mini Me, standing just above the Dock */}
        <div
          className="absolute bottom-[68px] -translate-x-1/2 sm:bottom-[78px]"
          style={{ left: `${scene.x}%`, transition: scene.walkMs ? `left ${scene.walkMs}ms linear` : undefined }}
        >
          {scene.bubble && <Bubble scene={scene} />}
          <Preview scene={scene} />
          <MiniMeSprite artStyle={artStyle} look={look} state={scene.pose} className="[--mm-scale:2] md:[--mm-scale:3]" />
        </div>

        {/* Dock */}
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-end gap-1.5 rounded-2xl border border-line-2 bg-panel/70 p-1.5 backdrop-blur-md sm:gap-2 sm:p-2">
          <DockTile label="Marven" className="bg-brand text-on-brand" running>
            <Logo size={20} />
          </DockTile>
          <DockTile label="Files" className="bg-cloud-soft text-cloud">
            <FolderIcon size={19} />
          </DockTile>
          <DockTile label="Browser" className="bg-panel-3 text-ink-2">
            <GlobeIcon size={19} />
          </DockTile>
          <DockTile label="Spotify" className="bg-local text-bg" bounce={scene.bounce === "music"} running={scene.musicOpen}>
            <MusicIcon size={18} />
          </DockTile>
          <DockTile label="Terminal" className="bg-[#11141a] text-[#98c379] ring-1 ring-inset ring-white/10">
            <TerminalIcon size={19} />
          </DockTile>
          <DockTile label="Notes" className="bg-amber-soft text-amber">
            <span className="font-serif text-xl italic leading-none">a</span>
          </DockTile>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* "Make it look like you": art style, look and pose, all live.        */
/* ------------------------------------------------------------------ */

const LOOK_LABEL: Record<MiniMeLook, string> = {
  you: "Short dark hair, blue tee",
  auburn: "Long auburn hair, green tee",
  curly: "Curly hair, beard and gold glasses",
  blonde: "Blonde buzz cut and glasses",
  pink: "Pink hair, purple tee",
  silver: "Bald, grey beard and blue glasses",
  blue: "Blue hair, yellow tee",
};

const POSES: [MiniMeState, string][] = [
  ["idle", "Idle"],
  ["walk", "Walk"],
  ["talk", "Talk"],
  ["happy", "Happy"],
  ["think", "Think"],
  ["paint", "Paint"],
  ["sleep", "Sleep"],
];

const STYLE_IDS = Object.keys(MINI_ME_STYLES) as MiniMeStyle[];

const choice = (on: boolean) =>
  `rounded-xl border transition ${on ? "border-brand/60 bg-brand-soft" : "border-line bg-bg-2 hover:border-line-2"}`;

function Customiser({
  artStyle,
  look,
  setArtStyle,
  setLook,
}: {
  artStyle: MiniMeStyle;
  look: MiniMeLook;
  setArtStyle: (s: MiniMeStyle) => void;
  setLook: (l: MiniMeLook) => void;
}) {
  const [pose, setPose] = useState<MiniMeState>("idle");

  return (
    <div className="grid gap-2 rounded-2xl border border-line-2 bg-panel p-2 shadow-[var(--shadow)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      {/* Live preview */}
      <div className="flex flex-col rounded-xl border border-line bg-bg-2">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-medium text-ink">Preview</span>
          <span className="font-mono text-[10.5px] text-dim">
            {MINI_ME_STYLES[artStyle].size} × {MINI_ME_STYLES[artStyle].size} px
          </span>
        </div>
        <div className="relative grid flex-1 place-items-end justify-center overflow-hidden px-4 pb-10 pt-4 min-h-[260px]">
          <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-80" />
          <span aria-hidden="true" className="absolute bottom-9 left-1/2 h-3 w-32 -translate-x-1/2 rounded-[50%] bg-ink/10 blur-[2px]" />
          <MiniMeSprite
            artStyle={artStyle}
            look={look}
            state={pose}
            loop
            scale={4}
            className="relative"
            label={`Mini Me preview, ${MINI_ME_STYLES[artStyle].label} style: ${LOOK_LABEL[look].toLowerCase()}`}
          />
        </div>
        <div role="group" aria-label="Pose" className="grid grid-cols-4 gap-1 border-t border-line p-3 sm:grid-cols-7">
          {POSES.map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={pose === id}
              onClick={() => setPose(id)}
              className={`rounded-lg px-2 py-1 font-mono text-[11px] transition ${
                pose === id ? "bg-ink text-bg" : "text-mute hover:bg-panel-2 hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-6 p-3 sm:p-4">
        <div>
          <h4 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">Art style</h4>
          <div role="group" aria-label="Art style" className="mt-3 grid grid-cols-3 gap-2">
            {STYLE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={artStyle === id}
                onClick={() => setArtStyle(id)}
                className={`flex flex-col items-center gap-1.5 px-1 pb-2.5 pt-3 ${choice(artStyle === id)}`}
              >
                <MiniMeSprite artStyle={id} look={look} scale={2} />
                <span className="text-[13px] font-medium text-ink">{MINI_ME_STYLES[id].label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h4 className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">Hair, colours, glasses, beard</h4>
          <div role="group" aria-label="Look" className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {MINI_ME_LOOKS.map((id, i) => (
              <button
                key={id}
                type="button"
                aria-pressed={look === id}
                aria-label={LOOK_LABEL[id]}
                title={LOOK_LABEL[id]}
                onClick={() => setLook(id)}
                className={`grid place-items-center py-1.5 ${choice(look === id)}`}
              >
                <MiniMeSprite artStyle={artStyle} look={id} scale={1} delay={i * 370} />
              </button>
            ))}
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-3 border-t border-line pt-5 text-sm sm:grid-cols-2">
          {[
            ["Activity", "Lively, Calm or Stays put"],
            ["Walk speed", "Slow, Normal or Fast"],
            ["Fall asleep after", "1, 5, 10 or 30 minutes"],
            ["Personality", "Playful, Neutral or Detailed"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-ink">{k}</dt>
              <dd className="text-mute">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const POINTS: { icon: ReactNode; title: string; body: ReactNode }[] = [
  {
    icon: <MoonIcon size={17} />,
    title: "Walks, sits, naps",
    body: "It strolls along the bottom of your screen, stops to look around, sits when you leave it alone and naps after a while. Drag it anywhere; double-click sends it home.",
  },
  {
    icon: <MicIcon size={17} />,
    title: "Talk or type",
    body: (
      <>
        Click it or press <span className="kbd">⌘⇧Space</span>. It answers in a bubble, and out loud if you like. While
        it&apos;s on screen, &ldquo;Hey Marven&rdquo; works too.
      </>
    ),
  },
  {
    icon: <ClockIcon size={17} />,
    title: "Handles the small stuff",
    body: "Opens apps and sites, sets timers and reads your clipboard, so you don't have to switch windows.",
  },
  {
    icon: <GlobeIcon size={17} />,
    title: "Builds websites for you",
    body: "Ask for a site and he makes it in its own folder, painting away while a live preview beside his bubble fills in. Ask for changes and he edits the same project; anything you add while he works waits its turn.",
  },
  {
    icon: <SparkIcon size={17} />,
    title: "Hands big jobs to the Agent",
    body: "Anything that needs your files, the terminal or the browser opens a new Agent chat with your request filled in, so the Agent's approvals still apply.",
  },
  {
    icon: <ShieldIcon size={17} />,
    title: "Any model, local too",
    body: "It thinks with the model you choose in Marven, including a local one on your own machine.",
  },
];

export function MiniMe() {
  const [artStyle, setArtStyle] = useState<MiniMeStyle>("chibiLarge");
  const [look, setLook] = useState<MiniMeLook>("you");

  return (
    <section id="mini-me" className="relative scroll-mt-20 px-4 py-24 sm:px-6 lg:px-10 sm:py-32">
      <div className="mx-auto max-w-[88rem]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading
            eyebrow="New in 2.19 · Mini Me builds websites"
            tone="amber"
            title={
              <>
                A tiny you that lives <Em>above your Dock.</Em>
              </>
            }
            lede="Mini Me is a pixel-art version of you that walks along the bottom of your screen. Click it, tell it what to do, and it answers in a speech bubble. Ask for a website and it builds one while you watch the preview; small jobs it does itself, and big ones go to the Agent."
          />
          <p className="flex shrink-0 flex-wrap items-center gap-2 font-mono text-xs text-mute lg:pb-2">
            <span className="kbd">⌘⇧Space</span>
            <span className="text-dim">or</span>
            <span className="rounded-md border border-line-2 bg-panel-2 px-2 py-0.5 text-ink-2">&ldquo;Hey Marven&rdquo;</span>
          </p>
        </div>

        <div className="mt-12">
          <Desktop artStyle={artStyle} look={look} />
        </div>

        <ul className="mt-5 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {POINTS.map((p) => (
            <li key={p.title} className="bg-panel p-5">
              <span className="grid size-8 place-items-center rounded-lg border border-line-2 bg-panel-2 text-amber">{p.icon}</span>
              <h3 className="mt-4 font-semibold tracking-tight text-ink">{p.title}</h3>
              <p className="mt-1.5 text-[0.9rem] leading-relaxed text-mute">{p.body}</p>
            </li>
          ))}
        </ul>

        <div className="mt-20 grid gap-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:items-center">
          <div>
            <h3 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
              Make it look like you.
            </h3>
            <p className="mt-4 text-pretty leading-relaxed text-mute">
              Three hand-drawn art styles, then hair style, colours, glasses and a beard, with a live animated preview in{" "}
              <span className="text-ink-2">Settings → Mini Me</span>. The one walking around above is the one you pick here.
            </p>
            <p className="mt-6 flex items-start gap-2.5 text-sm text-dim">
              <LockIcon size={16} className="mt-0.5 shrink-0 text-local" />
              It runs locked down: its window can only reach Marven&apos;s own Mini Me page.
            </p>
          </div>
          <Customiser artStyle={artStyle} look={look} setArtStyle={setArtStyle} setLook={setLook} />
        </div>
      </div>
    </section>
  );
}
