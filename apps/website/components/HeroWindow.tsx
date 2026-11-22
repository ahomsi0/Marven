"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "./Logo";
import { CheckIcon } from "./Icons";

/*
 * A scripted re-enactment of one agent run inside a Marven window: the user
 * asks for a change, the agent reads and searches, proposes a patch (the diff
 * appears in the editor), runs the tests in the terminal and reports back.
 * Purely decorative — screen readers get a one-line summary instead.
 */

const STEPS = [
  { at: 400 }, //  1 user message
  { at: 1500 }, // 2 read_file
  { at: 2500 }, // 3 search_files
  { at: 3600 }, // 4 apply_patch proposed (diff shows in editor)
  { at: 5200 }, // 5 approved
  { at: 6000 }, // 6 run_command starts
  { at: 7600 }, // 7 tests pass
  { at: 8500 }, // 8 assistant reply
];
const LOOP_MS = 15000;

type Tok = [string, string?];
type Line = { toks: Tok[]; kind?: "add" | "del" };

const k = (t: string): Tok => [t, "text-kw"];
const s = (t: string): Tok => [t, "text-str"];
const f = (t: string): Tok => [t, "text-fn"];
const n = (t: string): Tok => [t, "text-num"];
const p = (t: string): Tok => [t];

const BEFORE: Line[] = [
  { toks: [k("import"), p(" { Router } "), k("from"), p(" "), s('"express"'), p(";")] },
  { toks: [k("import"), p(" { rateLimit } "), k("from"), p(" "), s('"../lib/rateLimit"'), p(";")], kind: "add" },
  { toks: [k("import"), p(" { verify } "), k("from"), p(" "), s('"../auth"'), p(";")] },
  { toks: [] },
  { toks: [k("const"), p(" router = "), f("Router"), p("();")] },
  { toks: [k("const"), p(" limiter = "), f("rateLimit"), p("({ window: "), s('"1m"'), p(", max: "), n("5"), p(" });")], kind: "add" },
  { toks: [] },
  { toks: [p("router."), f("post"), p("("), s('"/login"'), p(", "), k("async"), p(" (req, res) => {")], kind: "del" },
  { toks: [p("router."), f("post"), p("("), s('"/login"'), p(", limiter, "), k("async"), p(" (req, res) => {")], kind: "add" },
  { toks: [p("  "), k("const"), p(" user = "), k("await"), p(" "), f("verify"), p("(req.body);")] },
  { toks: [p("  "), k("if"), p(" (!user) "), k("return"), p(" res."), f("status"), p("("), n("401"), p(")."), f("end"), p("();")] },
  { toks: [p("  res."), f("json"), p("({ token: user.token });")] },
  { toks: [p("});")] },
];

const TREE = [
  { name: "src", dir: true, depth: 0 },
  { name: "lib", dir: true, depth: 1 },
  { name: "rateLimit.ts", depth: 2 },
  { name: "routes", dir: true, depth: 1 },
  { name: "login.ts", depth: 2, active: true },
  { name: "users.ts", depth: 2 },
  { name: "auth.ts", depth: 1 },
  { name: "test", dir: true, depth: 0 },
  { name: "login.test.ts", depth: 1 },
  { name: "MARVEN.md", depth: 0 },
  { name: "package.json", depth: 0 },
];

function usePlayhead() {
  const [step, setStep] = useState(0);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(STEPS.length);
      return;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    let loop: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      timers.forEach(clearTimeout);
      setStep(0);
      timers = STEPS.map((st, i) => setTimeout(() => setStep(i + 1), st.at));
    };
    // Only animate while visible, so it starts from the top when scrolled to.
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !loop) {
          run();
          loop = setInterval(run, LOOP_MS);
        } else if (!e.isIntersecting && loop) {
          clearInterval(loop);
          loop = undefined;
          timers.forEach(clearTimeout);
          setStep(STEPS.length);
        }
      },
      { threshold: 0.25 },
    );
    if (root.current) io.observe(root.current);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
      if (loop) clearInterval(loop);
    };
  }, []);

  return { step, ref: root };
}

export function HeroWindow() {
  const { step, ref } = usePlayhead();
  const showDiff = step >= 4;
  const approved = step >= 5;

  return (
    <div ref={ref} className="relative">
      <p className="sr-only">
        Animated example: in the Marven window, the agent is asked to rate-limit a login route. It reads the file, proposes
        a four-line patch shown as a diff, the change is approved, and it runs the tests, which pass.
      </p>
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-2xl border border-line-2 bg-panel text-left shadow-[var(--shadow)]"
      >
        {/* Title bar */}
        <div className="flex h-10 items-center gap-3 border-b border-line bg-panel-2 px-3.5">
          <div className="flex gap-1.5">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2 font-mono text-[11px] text-dim">
            <Logo size={13} className="text-brand" />
            <span className="truncate">payments-api — Marven</span>
          </div>
          <span className="hidden items-center gap-1.5 rounded-md bg-local-soft px-2 py-0.5 font-mono text-[10px] font-medium text-local sm:inline-flex">
            <span className="size-1.5 rounded-full bg-local" />
            LOCAL · qwen2.5-coder
          </span>
        </div>

        <div className="grid h-[440px] grid-cols-1 md:grid-cols-[1fr_330px] lg:grid-cols-[176px_1fr_340px]">
          {/* File tree */}
          <div className="hidden border-r border-line bg-bg-2 py-3 font-mono text-[11.5px] lg:block">
            <div className="px-3.5 pb-2 text-[10px] uppercase tracking-[0.14em] text-dim">Explorer</div>
            {TREE.map((t) => (
              <div
                key={t.name + t.depth}
                className={`flex items-center gap-1.5 py-[3px] pr-2 ${t.active ? "bg-brand-soft text-ink" : "text-mute"}`}
                style={{ paddingLeft: 14 + t.depth * 12 }}
              >
                <span className={t.dir ? "text-dim" : t.active ? "text-brand" : "text-dim"}>{t.dir ? "▾" : "·"}</span>
                {t.name}
                {t.active && showDiff && <span className="ml-auto text-[10px] text-amber">M</span>}
              </div>
            ))}
          </div>

          {/* Editor + terminal */}
          <div className="hidden min-w-0 grid-rows-[auto_1fr_132px] md:grid">
            <div className="flex h-9 items-end gap-px border-b border-line bg-bg-2 px-2 font-mono text-[11px]">
              <span className="flex items-center gap-2 rounded-t-md border-x border-t border-line bg-panel px-3 py-1.5 text-ink-2">
                login.ts
                {showDiff && <span className="size-1.5 rounded-full bg-amber" />}
              </span>
              <span className="px-3 py-1.5 text-dim">rateLimit.ts</span>
            </div>
            <div className="overflow-hidden py-2.5 font-mono text-[12px] leading-[1.6]">
              {BEFORE.filter(
                (line) => !((line.kind === "add" && !showDiff) || (line.kind === "del" && approved)),
              ).map((line, i) => {
                const tone =
                  line.kind === "add"
                    ? "bg-[var(--add-bg)] shadow-[inset_2px_0_0_var(--str)]"
                    : line.kind === "del"
                      ? "bg-[var(--del-bg)] shadow-[inset_2px_0_0_var(--red)] line-through decoration-red/50"
                      : "";
                const settled = approved && line.kind === "add" ? "bg-transparent shadow-none" : "";
                return (
                  <div
                    key={BEFORE.indexOf(line)}
                    className={`flex whitespace-pre transition-colors duration-700 ${tone} ${settled}`}
                    style={line.kind ? { animation: "float-in .4s ease both" } : undefined}
                  >
                    <span className="w-10 shrink-0 select-none pr-3 text-right text-dim/70">{i + 1}</span>
                    <span className="w-3 shrink-0 text-dim">
                      {!approved && line.kind === "add" ? "+" : !approved && line.kind === "del" ? "−" : ""}
                    </span>
                    <span className="text-code">
                      {line.toks.map(([t, c], j) => (
                        <span key={j} className={c}>
                          {t}
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
            <Terminal step={step} />
          </div>

          {/* Agent panel */}
          <div className="flex min-h-0 flex-col border-line bg-bg-2 md:border-l">
            <div className="flex h-9 items-center justify-between border-b border-line px-3.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-dim">
              Agent
              <span className="normal-case tracking-normal">{step >= 1 && step < 8 ? "working…" : "idle"}</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden p-3.5 text-[12.5px]">
              {step >= 1 && (
                <Appear>
                  <div className="ml-auto max-w-[88%] rounded-xl rounded-br-sm bg-brand-soft px-3 py-2 text-ink">
                    Rate-limit <code className="font-mono text-[11.5px]">/login</code> to 5 attempts a minute, then run the
                    tests.
                  </div>
                </Appear>
              )}
              {step >= 2 && <Tool name="read_file" arg="src/routes/login.ts" done />}
              {step >= 3 && <Tool name="search_files" arg='"rateLimit"' done meta="1 match" />}
              {step >= 4 && (
                <Appear>
                  <div className="rounded-lg border border-line-2 bg-panel">
                    <div className="flex items-center gap-2 px-3 py-2 font-mono text-[11px]">
                      <span className="text-amber">apply_patch</span>
                      <span className="truncate text-mute">login.ts</span>
                      <span className="ml-auto text-str">+3</span>
                      <span className="text-red">−1</span>
                    </div>
                    <div className="flex gap-1.5 border-t border-line px-3 py-2 font-mono text-[11px]">
                      {approved ? (
                        <span className="inline-flex items-center gap-1 text-local">
                          <CheckIcon size={12} /> Approved · checkpoint saved
                        </span>
                      ) : (
                        <>
                          <span className="rounded-md bg-brand px-2 py-0.5 text-on-brand">Approve</span>
                          <span className="rounded-md border border-line-2 px-2 py-0.5 text-mute">Reject</span>
                        </>
                      )}
                    </div>
                  </div>
                </Appear>
              )}
              {step >= 6 && <Tool name="run_command" arg="npm test" done={step >= 7} meta={step >= 7 ? "24 passed" : undefined} />}
              {step >= 8 && (
                <Appear>
                  <p className="leading-relaxed text-ink-2">
                    Done. <code className="font-mono text-[11.5px] text-ink">/login</code> now allows 5 attempts per minute
                    per IP and answers <code className="font-mono text-[11.5px] text-ink">429</code> after that. All 24
                    tests pass.
                  </p>
                </Appear>
              )}
            </div>
            <div className="m-3 mt-0 flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-3 py-2 text-[12px] text-dim">
              <span className="flex-1 truncate">Ask Marven to change something…</span>
              <span className="kbd">⌘↵</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Terminal({ step }: { step: number }) {
  return (
    <div className="border-t border-line bg-bg-2 px-4 py-2.5 font-mono text-[11.5px] leading-[1.65]">
      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-dim">Terminal</div>
      <div className="text-mute">
        <span className="text-str">~/payments-api</span> <span className="text-dim">$</span>{" "}
        {step >= 6 ? <span className="text-ink-2">npm test</span> : <span className="caret" />}
      </div>
      {step >= 6 && step < 7 && <div className="text-dim">running 24 tests…</div>}
      {step >= 7 && (
        <>
          <div className="text-ink-2">
            <span className="text-str">✓</span> test/login.test.ts <span className="text-dim">(9)</span>
          </div>
          <div className="text-ink-2">
            <span className="text-str">Tests</span> 24 passed <span className="text-dim">(24) · 1.2s</span>
          </div>
        </>
      )}
    </div>
  );
}

function Tool({ name, arg, done, meta }: { name: string; arg: string; done?: boolean; meta?: string }) {
  return (
    <Appear>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 font-mono text-[11px]">
        <span className={done ? "text-local" : "text-amber"}>
          {done ? <CheckIcon size={12} /> : <span className="inline-block size-2 animate-pulse rounded-full bg-amber" />}
        </span>
        <span className="text-fn">{name}</span>
        <span className="truncate text-mute">{arg}</span>
        {meta && <span className="ml-auto shrink-0 text-dim">{meta}</span>}
      </div>
    </Appear>
  );
}

function Appear({ children }: { children: ReactNode }) {
  return <div style={{ animation: "float-in .45s cubic-bezier(.2,.7,.2,1) both" }}>{children}</div>;
}
