import { Em, SectionHeading } from "./Section";

const CLOUD = [
  { name: "Groq", mono: "G", note: "Fast open models" },
  { name: "OpenAI", mono: "O", note: "GPT models" },
  { name: "Anthropic", mono: "A", note: "Claude models" },
  { name: "OpenRouter", mono: "OR", note: "Free models included" },
  { name: "NVIDIA NIM", mono: "N", note: "Hosted NIM endpoints" },
];

const LOCAL = [
  { name: "Ollama", mono: "O", note: "One-command local models" },
  { name: "LM Studio", mono: "LM", note: "Desktop model runner" },
  { name: "llama-server", mono: "ll", note: "llama.cpp's server" },
];

function Provider({ name, mono, note, kind }: { name: string; mono: string; note: string; kind: "local" | "cloud" }) {
  const tone = kind === "local" ? "bg-local-soft text-local" : "bg-cloud-soft text-cloud";
  return (
    <li className="flex items-center gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 transition hover:border-line-2">
      <span className={`grid size-9 shrink-0 place-items-center rounded-lg font-mono text-xs font-semibold ${tone}`}>{mono}</span>
      <span className="min-w-0">
        <span className="block text-[0.95rem] font-medium text-ink">{name}</span>
        <span className="block truncate text-xs text-dim">{note}</span>
      </span>
    </li>
  );
}

export function Models() {
  return (
    <section id="models" className="scroll-mt-20 px-4 py-24 sm:px-6 lg:px-10 sm:py-32">
      <div className="mx-auto max-w-[88rem]">
        <SectionHeading
          eyebrow="Any model"
          title={
            <>
              Bring your own model. <Em>Or run it locally.</Em>
            </>
          }
          lede="Pick one model for chat and another for the agent, and set a fallback chain so a rate limit or an outage never stops a run halfway."
        />

        <div className="mt-14 grid gap-5 lg:grid-cols-[1.25fr_1fr]">
          <div className="rounded-2xl border border-line bg-bg-2 p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-cloud">Cloud · your API key</h3>
              <span className="text-xs text-dim">Prompts go to the provider you pick</span>
            </div>
            <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {CLOUD.map((p) => (
                <Provider key={p.name} {...p} kind="cloud" />
              ))}
            </ul>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-local/25 bg-bg-2 p-5 sm:p-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-local/10 blur-3xl"
            />
            <div className="relative flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-local">Local · on your machine</h3>
              <span className="text-xs text-local/80">Nothing leaves your computer</span>
            </div>
            <ul className="relative mt-5 grid gap-2.5">
              {LOCAL.map((p) => (
                <Provider key={p.name} {...p} kind="local" />
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-panel px-4 py-3 font-mono text-xs text-mute">
          <span className="uppercase tracking-[0.14em] text-dim">Fallback</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-cloud" /> Groq
          </span>
          <span className="text-dim">→</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-cloud" /> OpenAI
          </span>
          <span className="text-dim">→</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-local" /> Ollama
          </span>
          <span className="ml-auto hidden text-dim sm:inline">If one fails, the agent carries on with the next.</span>
        </div>
      </div>
    </section>
  );
}
