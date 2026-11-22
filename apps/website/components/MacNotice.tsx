import { AppleIcon } from "./Icons";

/**
 * Releases aren't signed with an Apple Developer ID or notarized yet (that
 * needs a paid Apple Developer membership), so Gatekeeper blocks the first
 * launch. This explains why and how to open it anyway.
 */
export function MacNotice() {
  return (
    <section
      id="macos"
      aria-labelledby="macos-heading"
      className="mt-8 scroll-mt-24 rounded-2xl border border-amber/35 bg-amber-soft p-6 sm:p-7"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-amber/15 text-amber">
          <AppleIcon size={18} />
        </span>
        <div className="min-w-0">
          <h2 id="macos-heading" className="text-lg font-semibold text-ink">
            On a Mac? The first launch needs one extra step.
          </h2>
          <p className="mt-2 max-w-3xl text-[0.95rem] leading-relaxed text-ink-2">
            Marven isn&apos;t signed or notarized by Apple yet, because that needs a paid Apple Developer membership. So
            the first time you open it, macOS says it can&apos;t check the app for malicious software and won&apos;t open
            it. That warning is about the missing signature, not about anything found in the app, and Marven&apos;s full
            source is public if you&apos;d like to check it or build it yourself.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-amber">Open it anyway</h3>
          <ol className="mt-3 space-y-2.5 text-[0.95rem] leading-relaxed text-ink-2">
            {[
              <>Open the DMG and drag Marven into your Applications folder.</>,
              <>
                Open Marven. When macOS blocks it, click <b>Done</b>.
              </>,
              <>
                Go to <b>System Settings → Privacy &amp; Security</b> and scroll down to the message about Marven.
              </>,
              <>
                Click <b>Open Anyway</b>, then confirm with your password or Touch ID.
              </>,
            ].map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-amber/40 font-mono text-xs text-amber">
                  {i + 1}
                </span>
                <span className="[&_b]:font-medium [&_b]:text-ink">{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-mute">After that first time it opens normally. Until releases are signed, a Mac can&apos;t install updates on its own, so download each new version from this page and repeat these steps once.</p>
        </div>

        <div className="rounded-xl border border-line bg-panel p-4">
          <h3 className="font-mono text-xs uppercase tracking-[0.16em] text-dim">Or, in Terminal</h3>
          <p className="mt-2 text-sm leading-relaxed text-mute">
            After copying Marven to Applications, this removes the download quarantine flag so macOS opens it straight
            away:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-bg-2 px-3 py-2.5 font-mono text-[12px] text-code">
            xattr -dr com.apple.quarantine /Applications/Marven.app
          </pre>
        </div>
      </div>
    </section>
  );
}
