interface MarvenLogoProps {
  size?: number;
  className?: string;
}

/**
 * Marven logo — an open hexagon ring with a solid dot at its centre.
 * electron/create-icon.js draws the same shape for the app and tray icons.
 */
export function MarvenLogo({ size = 24, className = "" }: MarvenLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Marven"
    >
      {/* Pointy-top hexagon, open on the upper right */}
      <path
        d="M24.5 8.9 16 4 5.6 10v12L16 28l10.4-6v-6.5"
        stroke="#5b9cf6"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3.4" fill="#5b9cf6" />
    </svg>
  );
}
