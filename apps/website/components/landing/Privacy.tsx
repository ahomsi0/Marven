import Link from "next/link";
import { ArrowRight, CheckIcon, ShieldIcon } from "../Icons";
import { Em, SectionHeading } from "./Section";

const LOCAL_ITEMS = [
  ["Your files", "Read only for an action you start"],
  ["Conversations", "SQLite, in your app data folder"],
  ["Memory", "Facts it keeps between sessions"],
  ["Settings & workspaces", "A JSON file on disk"],
  ["API keys", "Encrypted by your OS keychain"],
];

export function Privacy() {
  return (
    <section id="privacy" className="relative scroll-mt-20 overflow-hidden px-4 py-24 sm:px-6 lg:px-10 sm:py-32">
      <div className="mx-auto grid max-w-[88rem] items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <SectionHeading
            eyebrow="Local-first"
            tone="local"
            title={
              <>
                Your code stays <Em>on your machine.</Em>
              </>
            }
            lede="Marven has no telemetry: no analytics, no crash reporter, no usage tracking. Your prompts and code go only to the AI provider you pick, and with a local model they go nowhere. The few other connections it makes, like the weather lookup at launch or a web search you ask for, are each listed in the privacy policy."
          />
          <Link
            href="/privacy"
            className="group mt-8 inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-brand-2"
          >
            Read the full privacy policy
            <ArrowRight className="transition group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="rounded-2xl border border-line-2 bg-panel p-2 shadow-[var(--shadow)]">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <ShieldIcon size={17} className="text-local" />
              On this machine
            </span>
            <span className="rounded-md bg-local-soft px-2 py-0.5 font-mono text-[10.5px] text-local">Always local</span>
          </div>
          <ul className="rounded-xl border border-line bg-bg-2">
            {LOCAL_ITEMS.map(([title, note]) => (
              <li key={title} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-local-soft text-local">
                  <CheckIcon size={11} />
                </span>
                <span className="text-sm text-ink-2">{title}</span>
                <span className="ml-auto text-right text-xs text-dim">{note}</span>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 p-3 font-mono text-[11.5px] sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-bg-2 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-cloud">
                <span className="size-1.5 rounded-full bg-cloud" /> Cloud model
              </div>
              <p className="mt-1 font-sans text-xs text-mute">Prompts and code go to that provider only.</p>
            </div>
            <div className="rounded-lg border border-local/30 bg-local-soft px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-local">
                <span className="size-1.5 rounded-full bg-local" /> Local model
              </div>
              <p className="mt-1 font-sans text-xs text-mute">Prompts and code never leave this machine.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
