// Small stroke icons (24px grid, currentColor) so the site needs no icon package.
type P = { className?: string; size?: number };
const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const GitHubIcon = ({ className, size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.41-2.69 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);
export const AppleIcon = ({ className, size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M16.37 12.6c-.02-2.2 1.8-3.26 1.88-3.31-1.03-1.5-2.62-1.7-3.18-1.73-1.35-.14-2.64.8-3.33.8-.69 0-1.74-.78-2.87-.76-1.47.02-2.83.86-3.59 2.18-1.53 2.66-.39 6.6 1.1 8.75.73 1.05 1.6 2.24 2.73 2.2 1.1-.05 1.51-.71 2.84-.71 1.32 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.13.84-1.22 1.18-2.41 1.2-2.47-.03-.01-2.3-.88-2.32-3.5ZM14.2 6.13c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.68-.92 2.67.97.08 1.96-.49 2.56-1.22Z" />
  </svg>
);
export const WindowsIcon = ({ className, size = 18 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M3 5.1 10.4 4v7.2H3V5.1Zm8.4-1.24L21 2.5v8.7h-9.6V3.86ZM3 12.8h7.4V20L3 18.9v-6.1Zm8.4 0H21v8.7l-9.6-1.36V12.8Z" />
  </svg>
);
export const LinuxIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3c-2 0-3 1.7-3 4 0 1.4.4 2.3-.6 3.7C7 12.6 6 14.4 6 16.5c0 1 .3 1.8.8 2.4M12 3c2 0 3 1.7 3 4 0 1.4-.4 2.3.6 3.7 1.4 1.9 2.4 3.7 2.4 5.8 0 1-.3 1.8-.8 2.4" />
    <path d="M7 19.5c1 .8 2.2 1.5 5 1.5s4-.7 5-1.5M10.5 7.5h.01M13.5 7.5h.01M11 10h2" />
  </svg>
);
export const ArrowRight = ({ className, size = 16 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const DownloadIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
export const PlayIcon = ({ className, size = 22 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M8 5.5v13a1 1 0 0 0 1.53.85l10.4-6.5a1 1 0 0 0 0-1.7L9.53 4.65A1 1 0 0 0 8 5.5Z" />
  </svg>
);
export const SunIcon = ({ className, size = 17 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const MoonIcon = ({ className, size = 17 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </svg>
);
export const MenuIcon = ({ className, size = 20 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const CloseIcon = ({ className, size = 20 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const CheckIcon = ({ className, size = 14 }: P) => (
  <svg {...base(size)} strokeWidth={2.2} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const ShieldIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6l-7-3Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
export const SparkIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </svg>
);
export const CodeIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
  </svg>
);
export const TerminalIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="m7 10 3 2.5L7 15M12.5 15H17" />
  </svg>
);
export const GlobeIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3Z" />
  </svg>
);
export const MicIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);
export const PlugIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0V8ZM12 17v4" />
  </svg>
);
export const BranchIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="6" cy="5.5" r="2" />
    <circle cx="6" cy="18.5" r="2" />
    <circle cx="18" cy="8" r="2" />
    <path d="M6 7.5v9M18 10c0 4-5 3.5-10.5 7" />
  </svg>
);
export const LanguagesIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 5h9M8.5 3v2M6 5c.5 3 2.5 5.5 5.5 7M11 5c-.7 3.6-3 6.4-6.5 8" />
    <path d="m13 21 4-9 4 9M14.4 18h5.2" />
  </svg>
);
export const ChatIcon = ({ className, size = 18 }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4A8 8 0 1 1 20 12Z" />
  </svg>
);
