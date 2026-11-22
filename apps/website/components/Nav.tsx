"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { REPO_URL } from "@/lib/site";
import { CloseIcon, GitHubIcon, MenuIcon } from "./Icons";
import { Wordmark } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/#models", label: "Models" },
  { href: "/#privacy", label: "Privacy" },
  { href: "/download", label: "Download" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={`sticky top-0 z-50 transition-[background,border-color,backdrop-filter] duration-300 ${
        scrolled || open
          ? "border-b border-line bg-bg/80 backdrop-blur-xl"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-[88rem] items-center justify-between px-4 sm:px-6 lg:px-10" aria-label="Main">
        <Link href="/" aria-label="Marven home" className="rounded-md">
          <Wordmark />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`rounded-lg px-3 py-2 text-sm transition hover:text-ink ${
                pathname === l.href ? "text-ink" : "text-mute"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <a
            href={REPO_URL}
            className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm text-mute transition hover:bg-panel-2 hover:text-ink sm:inline-flex"
          >
            <GitHubIcon size={17} />
            GitHub
          </a>
          <ThemeToggle />
          <Link
            href="/download"
            className="ml-1 hidden rounded-lg bg-ink px-3.5 py-2 text-sm font-medium text-bg transition hover:opacity-90 sm:inline-flex"
          >
            Download
          </Link>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-lg text-mute hover:bg-panel-2 hover:text-ink md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-menu"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </nav>

      {open && (
        <div id="mobile-menu" className="border-t border-line px-4 pb-5 pt-2 md:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="block rounded-lg px-2 py-3 text-base text-ink-2 hover:bg-panel-2"
            >
              {l.label}
            </Link>
          ))}
          <a href={REPO_URL} className="flex items-center gap-2 rounded-lg px-2 py-3 text-base text-ink-2 hover:bg-panel-2">
            <GitHubIcon size={17} /> GitHub
          </a>
        </div>
      )}
    </header>
  );
}
