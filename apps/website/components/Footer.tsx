import Link from "next/link";
import { ISSUES_URL, LICENSE_URL, RELEASES_URL, REPO_URL } from "@/lib/site";
import { Wordmark } from "./Logo";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#models", label: "Models" },
      { href: "/download", label: "Download" },
      { href: RELEASES_URL, label: "Release notes" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPO_URL, label: "Source code" },
      { href: ISSUES_URL, label: "Report an issue" },
      { href: LICENSE_URL, label: "License (AGPLv3)" },
      { href: "/privacy", label: "Privacy policy" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-[88rem] gap-10 px-4 py-14 sm:px-6 lg:px-10 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="max-w-xs">
          <Wordmark />
          <p className="mt-4 text-sm leading-relaxed text-mute">
            An AI coding agent and a full code editor, in one desktop app. Free and open source.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-dim">{col.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.label}>
                  {l.href.startsWith("/") ? (
                    <Link href={l.href} className="text-sm text-mute transition hover:text-ink">
                      {l.label}
                    </Link>
                  ) : (
                    <a href={l.href} className="text-sm text-mute transition hover:text-ink">
                      {l.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[88rem] flex-col gap-2 border-t border-line px-4 py-6 font-mono text-xs text-dim sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
        <span>© {new Date().getFullYear()} Marven contributors</span>
        <span>No analytics. No cookies. Not here, not in the app.</span>
      </div>
    </footer>
  );
}
