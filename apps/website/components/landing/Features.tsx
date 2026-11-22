import type { ReactNode } from "react";
import { BranchIcon, CodeIcon, GlobeIcon, LanguagesIcon, MicIcon, PlugIcon, SparkIcon, TerminalIcon } from "../Icons";
import { Em, SectionHeading } from "./Section";

function Card({
  icon,
  title,
  children,
  visual,
  className = "",
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  visual?: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-panel p-6 transition duration-300 hover:border-line-2 ${className}`}
    >
      <span className="grid size-9 place-items-center rounded-lg border border-line-2 bg-panel-2 text-brand">{icon}</span>
      <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink">{title}</h3>
      <div className="mt-2 text-[0.95rem] leading-relaxed text-mute">{children}</div>
      {visual && <div className="mt-6 flex-1">{visual}</div>}
    </article>
  );
}

const SHORTCUTS = [
  ["⌘K", "Rewrite selection"],
  ["⌘P", "Open file"],
  ["⌘⇧F", "Search everything"],
  ["⌘⇧P", "Command palette"],
];

function DiffVisual() {
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-bg-2 font-mono text-[11.5px] leading-[1.7]">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-dim">
        <span>lib/rateLimit.ts</span>
        <span>
          <span className="text-str">+2</span> <span className="text-red">−1</span>
        </span>
      </div>
      <div className="py-1.5">
        <div className="px-3 text-code">
          <span className="text-kw">export function</span> <span className="text-fn">rateLimit</span>(opts) {"{"}
        </div>
        <div className="bg-[var(--del-bg)] px-3 text-code/70">
          <span className="text-red">−</span> <span className="text-kw">const</span> hits = []
        </div>
        <div className="bg-[var(--add-bg)] px-3 text-code">
          <span className="text-str">+</span> <span className="text-kw">const</span> hits = <span className="text-kw">new</span>{" "}
          <span className="text-fn">Map</span>()
        </div>
        <div className="bg-[var(--add-bg)] px-3 text-code">
          <span className="text-str">+</span> <span className="text-kw">const</span> windowMs = <span className="text-fn">ms</span>(
          <span className="text-str">opts.window</span>)
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <span className="rounded-md bg-brand px-2 py-0.5 text-on-brand">Approve</span>
        <span className="rounded-md border border-line-2 px-2 py-0.5 text-mute">Reject</span>
        <span className="ml-auto text-dim">↺ Revert to checkpoint</span>
      </div>
    </div>
  );
}

function TerminalVisual() {
  return (
    <div className="h-full rounded-xl border border-line bg-bg-2 px-3.5 py-3 font-mono text-[11.5px] leading-[1.75] text-code">
      <div>
        <span className="text-str">~/payments-api</span> <span className="text-dim">$</span> git status -sb
      </div>
      <div className="text-fn">## main...origin/main</div>
      <div>
        <span className="text-red"> M</span> src/routes/login.ts
      </div>
      <div>
        <span className="text-str">??</span> src/lib/rateLimit.ts
      </div>
      <div>
        <span className="text-str">~/payments-api</span> <span className="text-dim">$</span> <span className="caret" />
      </div>
    </div>
  );
}

function BrowserVisual() {
  return (
    <div className="rounded-xl border border-line bg-bg-2 p-3 text-xs">
      <div className="rounded-lg border border-amber/30 bg-amber-soft p-3">
        <p className="font-medium text-ink">Submit this form?</p>
        <p className="mt-1 text-mute">
          On <span className="font-mono text-ink-2">dashboard.example.dev</span> the agent would send:
        </p>
        <pre className="mt-2 overflow-hidden rounded-md bg-panel px-2.5 py-2 font-mono text-[11px] text-code">
          endpoint  https://api.example.dev/hooks{"\n"}events    payment.succeeded
        </pre>
        <div className="mt-2.5 flex justify-end gap-1.5">
          <span className="rounded-md border border-line-2 px-2 py-0.5 text-mute">Deny</span>
          <span className="rounded-md bg-amber px-2 py-0.5 font-medium text-bg">Allow</span>
        </div>
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section id="features" className="relative scroll-mt-20 px-4 py-24 sm:px-6 lg:px-10 sm:py-32">
      <div className="mx-auto max-w-[88rem]">
        <SectionHeading
          eyebrow="What's inside"
          title={
            <>
              One window instead of four. <Em>All of it talks.</Em>
            </>
          }
          lede="The editor, the terminal, the browser and the AI share the same workspace, so the agent can read the code, change it, run it and check its work without you copy-pasting between apps."
        />

        <div className="mt-14 grid gap-4 md:grid-cols-6">
          <Card
            className="md:col-span-4"
            icon={<SparkIcon />}
            title="An agent that shows its work"
            visual={<DiffVisual />}
          >
            Ask for a change and it reads your files, searches the codebase, edits and runs your tests. Every edit appears
            as a diff before it is written, and a checkpoint lets you roll any file back. Drop a{" "}
            <code className="font-mono text-[0.85em] text-ink-2">MARVEN.md</code> in your repo and it follows your project&apos;s
            rules on every run.
          </Card>

          <Card
            className="md:col-span-2"
            icon={<CodeIcon />}
            title="A real code editor"
            visual={
              <ul className="space-y-2">
                {SHORTCUTS.map(([key, label]) => (
                  <li key={key} className="flex items-center justify-between text-sm">
                    <span className="text-mute">{label}</span>
                    <span className="kbd">{key}</span>
                  </li>
                ))}
              </ul>
            }
          >
            CodeMirror 6 with 14 languages, multi-cursor, global search, Markdown preview and Prettier on save.
          </Card>

          <Card className="md:col-span-2" icon={<TerminalIcon />} title="A live terminal" visual={<TerminalVisual />}>
            A real shell with your <code className="font-mono text-[0.85em] text-ink-2">$PATH</code>, colours and REPLs, not a
            fake output box. vim and top work too.
          </Card>

          <Card className="md:col-span-4" icon={<GlobeIcon />} title="A browser it can use, with you in charge" visual={<BrowserVisual />}>
            Browse with tabs, bookmarks and built-in ad blocking, or let the agent open its own tabs to read docs and test
            your app. It asks before each new site and every form it submits, never types passwords or card numbers, and
            you can take over or stop it at any time.
          </Card>

          <Card className="md:col-span-2" icon={<MicIcon />} title="“Hey Marven”">
            Wake word and dictation, transcribed by Whisper on your machine by default. No account, no audio upload.
          </Card>
          <Card className="md:col-span-2" icon={<PlugIcon />} title="MCP servers">
            Connect GitHub, databases or anything that speaks the Model Context Protocol, and the agent can use it.
          </Card>
          <Card className="md:col-span-2" icon={<BranchIcon />} title="Git, built in">
            Status, diff, branch and commit from the agent, each one waiting for your approval first.
          </Card>
        </div>

        <p className="mt-6 flex items-center gap-2 text-sm text-dim">
          <LanguagesIcon size={16} className="text-mute" />
          Also in Arabic, with a full right-to-left interface.
        </p>
      </div>
    </section>
  );
}
