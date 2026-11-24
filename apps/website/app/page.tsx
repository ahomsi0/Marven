import Link from "next/link";
import { DownloadCta } from "@/components/DownloadButton";
import { HeroWindow } from "@/components/HeroWindow";
import { ArrowRight } from "@/components/Icons";
import { Logo } from "@/components/Logo";
import { MiniMeSprite } from "@/components/MiniMeSprite";
import { Features } from "@/components/landing/Features";
import { MiniMe } from "@/components/landing/MiniMe";
import { Models } from "@/components/landing/Models";
import { Privacy } from "@/components/landing/Privacy";
import { Em, Eyebrow } from "@/components/landing/Section";
import { VideoTour } from "@/components/landing/VideoTour";
import { getLatestReleaseAtBuild } from "@/lib/releases";
import { LICENSE_URL, REPO_URL } from "@/lib/site";

export default async function Home() {
  const release = await getLatestReleaseAtBuild();

  return (
    <>
      {/* Hero */}
      <section className="grain relative -mt-16 overflow-hidden px-4 pb-20 pt-32 sm:px-6 lg:px-10 sm:pt-40">
        <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-[-12rem] h-[42rem] w-[70rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)] [animation:drift_18s_ease-in-out_infinite]"
        />
        <div className="relative mx-auto max-w-[88rem]">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <Link
              href="/download"
              className="reveal inline-flex items-center gap-2 rounded-full border border-line-2 bg-panel/60 py-1 pl-1 pr-3 font-mono text-xs text-mute backdrop-blur transition hover:border-brand/40 hover:text-ink"
            >
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-brand">
                {release.version ? `v${release.version}` : "New"}
              </span>
              Free & open source<span className="hidden sm:inline"> · macOS, Windows, Linux</span>
              <ArrowRight size={13} />
            </Link>

            <h1
              className="reveal mt-7 text-balance text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.045em] text-ink sm:text-6xl md:text-[4.6rem]"
              style={{ animationDelay: "80ms" }}
            >
              Your AI agent, <Em>inside your editor.</Em>
            </h1>
            <p
              className="reveal mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-mute"
              style={{ animationDelay: "160ms" }}
            >
              Marven is a coding agent, a full code editor, a real terminal and a browser in one desktop app. Bring your own
              model or run everything locally. Your files, history and memory stay on your machine.
            </p>
            <div className="reveal mt-9 w-full sm:w-auto" style={{ animationDelay: "240ms" }}>
              <DownloadCta release={release} secondary={{ href: REPO_URL, label: "View source" }} />
            </div>
          </div>

          <div className="reveal relative mt-16 sm:mt-20" style={{ animationDelay: "380ms" }}>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-x-10 -bottom-10 top-10 rounded-[3rem] bg-[radial-gradient(closest-side,var(--glow),transparent)] blur-2xl"
            />
            {/* Mini Me, sitting on the window's edge */}
            <a
              href="#mini-me"
              className="group absolute bottom-full right-3 z-10 flex items-end gap-1.5 sm:right-10"
            >
              <span className="mb-3 whitespace-nowrap rounded-full border border-line-2 bg-panel/80 px-2.5 py-1 font-mono text-[11px] text-mute backdrop-blur transition group-hover:border-amber/50 group-hover:text-ink">
                <span className="text-amber">New in 2.18:</span> meet Mini Me
              </span>
              <MiniMeSprite state="sit" className="[--mm-scale:1] sm:[--mm-scale:2]" />
            </a>
            <HeroWindow />
          </div>
        </div>
      </section>

      {/* Problem → answer strip */}
      <section className="border-y border-line bg-bg-2 px-4 py-6 sm:px-6 lg:px-10">
        <div className="mx-auto flex max-w-[88rem] flex-col items-center justify-between gap-3 font-mono text-[13px] sm:flex-row">
          <p className="text-dim">
            editor · terminal · browser · AI chat: <span className="text-red">four windows that don&apos;t talk</span>
          </p>
          <p className="flex items-center gap-2 text-ink-2">
            <Logo size={16} className="text-brand" /> one workspace, one agent that can use all of it
          </p>
        </div>
      </section>

      <Features />
      <MiniMe />

      {/* Video tour */}
      <section className="px-4 pb-8 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <Eyebrow>Tour</Eyebrow>
            <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
              See it work in under two minutes.
            </h2>
          </div>
          <VideoTour />
        </div>
      </section>

      <Models />
      <Privacy />

      {/* Open source CTA */}
      <section className="px-4 pb-24 sm:px-6 lg:px-10 sm:pb-32">
        <div className="grain relative mx-auto max-w-[88rem] overflow-hidden rounded-3xl border border-line-2 bg-panel px-6 py-16 text-center sm:px-12 sm:py-20">
          <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute left-1/2 top-0 h-72 w-[40rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--glow),transparent)]"
          />
          <div className="relative mx-auto flex max-w-2xl flex-col items-center">
            <Logo size={44} className="text-brand" />
            <h2 className="mt-6 text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-5xl">
              Free. Open source. <Em>Yours.</Em>
            </h2>
            <p className="mt-5 text-pretty text-[1.05rem] leading-relaxed text-mute">
              Marven is licensed under the{" "}
              <a href={LICENSE_URL} className="text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink">
                AGPLv3
              </a>
              . Read every line, build it yourself, or grab an installer. It checks GitHub for new releases every time it starts.
            </p>
            <div className="mt-9 w-full sm:w-auto">
              <DownloadCta
                release={release}
                secondary={{ href: REPO_URL, label: "Star on GitHub", className: "bg-bg-2" }}
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
