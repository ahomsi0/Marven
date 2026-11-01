/**
 * Marven's icon set — small inline SVG components, no third-party icon library.
 *
 * All icons render at the size the parent <span> / className dictates and inherit
 * the current text color (`currentColor`). Pass any class through `className`.
 *
 * Conventions:
 *   - 24×24 viewBox so we can switch sizes without breaking proportions
 *   - default size: h-3 w-3 (12px) — matches the inline-pill aesthetic in
 *     InputBar / status line. Override via className when needed.
 *   - stroke-based outlines (strokeWidth 2) for filesystem/UI glyphs
 *   - fill-based shapes for the few badge-style logos (sparkle, bolt)
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { className?: string };

const BASE = "h-3 w-3 shrink-0";

function svg(children: React.ReactNode, props: IconProps, fillRule: "stroke" | "fill" = "stroke") {
  const { className = "", ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      className={`${BASE} ${className}`}
      {...(fillRule === "stroke"
        ? { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
        : { fill: "currentColor" })}
      {...rest}
    >
      {children}
    </svg>
  );
}

export const FileIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
    </>,
    p,
  );

export const FolderIcon = (p: IconProps) =>
  svg(
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
    p,
  );

export const SearchIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </>,
    p,
  );

export const GlobeIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a13 13 0 0 1 0 18M12 3a13 13 0 0 0 0 18" />
    </>,
    p,
  );

export const CloudIcon = (p: IconProps) =>
  svg(
    <path d="M17 18H8a5 5 0 1 1 1.2-9.86A6 6 0 0 1 21 12.5a5.5 5.5 0 0 1-4 5.5" />,
    p,
  );

export const HexagonIcon = (p: IconProps) =>
  svg(
    <path d="M12 2 21 7v10l-9 5-9-5V7z" />,
    p,
  );

/** Marven's hexagon split by a jagged crack — the "Report a glitch" button. */
export const GlitchIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M11 2.6 3 7v10l8 4.4" />
      <path d="M13.5 2.8 21 7v10l-7.5 4.2" />
      <path d="M12.4 2.2 10 8.5l3.5 2.6-3 4.4 2.2 6.3" />
    </>,
    p,
  );

/** Rounded window frame with a left pane — the show/hide sidebar toggle. */
export const SidebarIcon = (p: IconProps) =>
  svg(
    <>
      <rect x="2.5" y="4" width="19" height="16" rx="4.5" />
      <rect x="6" y="7.5" width="4.5" height="9" rx="2" />
    </>,
    { strokeWidth: 1.6, ...p },
  );

/** Speech bubble — the "Chats" view in the sidebar switcher. */
export const ChatBubbleIcon = (p: IconProps) =>
  svg(
    <path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3 21l1.4-5.2A8.5 8.5 0 1 1 21 12z" />,
    { strokeWidth: 1.8, ...p },
  );

/** </> — agent (coding) sessions. */
export const CodeIcon = (p: IconProps) =>
  svg(
    <>
      <polyline points="8 6 2 12 8 18" />
      <polyline points="16 6 22 12 16 18" />
    </>,
    { strokeWidth: 1.8, ...p },
  );

export const GearIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>,
    { strokeWidth: 1.6, ...p },
  );

export const HelpCircleIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 4.9.7c0 1.7-2.4 2.2-2.4 3.8" />
      <circle cx="12" cy="17" r=".6" fill="currentColor" />
    </>,
    { strokeWidth: 1.6, ...p },
  );

export const InfoIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r=".6" fill="currentColor" />
    </>,
    { strokeWidth: 1.6, ...p },
  );

/** Horizontal ellipsis — "more options" buttons. */
export const DotsIcon = (p: IconProps) =>
  svg(
    <>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </>,
    p,
    "fill",
  );

export const PencilIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </>,
    { strokeWidth: 1.6, ...p },
  );

export const PinIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3Z" />
      <path d="M12 14v7" />
    </>,
    { strokeWidth: 1.6, ...p },
  );

export const TrashIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </>,
    { strokeWidth: 1.6, ...p },
  );

export const ChevronRightIcon = (p: IconProps) =>
  svg(<polyline points="9 6 15 12 9 18" />, p);

export const ChevronDownIcon = (p: IconProps) =>
  svg(<polyline points="6 9 12 15 18 9" />, p);

export const CheckIcon = (p: IconProps) =>
  svg(<polyline points="5 13 10 18 19 7" />, p);

export const CloseIcon = (p: IconProps) =>
  svg(
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>,
    p,
  );

/** A 4-point sparkle/star — used for "What's new" markers and the Anthropic provider badge. */
export const SparkleIcon = (p: IconProps) =>
  svg(
    <path d="M12 3 13.5 9.5 20 11 13.5 12.5 12 19 10.5 12.5 4 11 10.5 9.5 Z" />,
    p,
    "fill",
  );

/** Lightning bolt — used for the Groq provider badge. */
export const BoltIcon = (p: IconProps) =>
  svg(
    <path d="M13 2 4 14h7l-1 8 9-12h-7Z" />,
    p,
    "fill",
  );

/** Small cube — generic local-model marker (e.g. Ollama). */
export const CubeIcon = (p: IconProps) =>
  svg(
    <>
      <path d="M12 3 3 7.5 12 12l9-4.5z" />
      <path d="M3 7.5v9L12 21V12" />
      <path d="M21 7.5v9L12 21" />
    </>,
    p,
  );
