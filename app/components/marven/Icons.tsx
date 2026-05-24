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
