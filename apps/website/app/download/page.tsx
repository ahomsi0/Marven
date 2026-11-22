import type { Metadata } from "next";
import { DownloadCards } from "@/components/DownloadCards";
import { Eyebrow } from "@/components/landing/Section";
import { MacNotice } from "@/components/MacNotice";
import { getLatestReleaseAtBuild } from "@/lib/releases";
import { REPO_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Download",
  description: "Download Marven for macOS (Apple Silicon), Windows or Linux. Free and open source.",
  alternates: { canonical: "/download" },
};

export default async function DownloadPage() {
  const release = await getLatestReleaseAtBuild();

  return (
    <div className="relative overflow-hidden px-4 pb-24 pt-16 sm:px-6 lg:px-10 sm:pt-24">
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[36rem]" />
      <div className="relative mx-auto max-w-[88rem]">
        <div className="max-w-2xl">
          <Eyebrow>Download</Eyebrow>
          <h1 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.035em] text-ink sm:text-5xl">
            Get Marven for your computer.
          </h1>
          <p className="mt-4 text-pretty text-lg leading-relaxed text-mute">
            Free, with no account. Installers come straight from the project&apos;s GitHub releases. On Windows and Linux,
            Marven installs new versions for you. On a Mac, get new versions from this page until releases are signed by
            Apple.
          </p>
        </div>

        <DownloadCards release={release} />
        <MacNotice />

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl border border-line bg-panel p-6">
            <h2 className="text-lg font-semibold text-ink">Then pick a model</h2>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-mute">
              On first launch, add an API key for Groq, OpenAI, Anthropic, OpenRouter or NVIDIA NIM, or point Marven at
              Ollama, LM Studio or llama-server to keep everything on your machine. OpenRouter has free models if you just
              want to try it.
            </p>
          </section>
          <section className="rounded-2xl border border-line bg-panel p-6">
            <h2 className="text-lg font-semibold text-ink">Build it yourself</h2>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-mute">Needs Node.js 20+ and npm.</p>
            <pre className="mt-4 overflow-x-auto rounded-xl border border-line bg-bg-2 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-code">
              <span className="text-dim">$ </span>git clone {REPO_URL}.git{"\n"}
              <span className="text-dim">$ </span>cd Marven/apps/desktop{"\n"}
              <span className="text-dim">$ </span>npm install{"\n"}
              <span className="text-dim">$ </span>npm run electron:dev
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
