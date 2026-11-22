import Link from "next/link";

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-24">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line-2 bg-panel font-mono text-sm shadow-[var(--shadow)]">
        <div className="border-b border-line bg-panel-2 px-4 py-2.5 text-xs text-dim">Terminal</div>
        <div className="space-y-1 px-4 py-4 text-mute">
          <p>
            <span className="text-str">~</span> <span className="text-dim">$</span> <span className="text-ink-2">open this-page</span>
          </p>
          <p className="text-red">error: 404, no such page</p>
          <p>
            <span className="text-str">~</span> <span className="text-dim">$</span> <span className="caret" />
          </p>
        </div>
        <div className="flex gap-2 border-t border-line px-4 py-3">
          <Link href="/" className="rounded-lg bg-brand px-3 py-1.5 font-sans text-sm font-medium text-on-brand">
            Go home
          </Link>
          <Link href="/download" className="rounded-lg border border-line-2 px-3 py-1.5 font-sans text-sm text-ink">
            Download
          </Link>
        </div>
      </div>
    </div>
  );
}
