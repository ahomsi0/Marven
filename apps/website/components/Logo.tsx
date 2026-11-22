/**
 * The Marven mark: an open hexagon ring with a solid dot at its centre.
 * Same geometry as apps/desktop/app/components/marven/MarvenLogo.tsx.
 */
export function Logo({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
      <path
        d="M24.5 8.9 16 4 5.6 10v12L16 28l10.4-6v-6.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="3.4" fill="currentColor" />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo size={22} className="text-brand" />
      <span className="text-[1.05rem] font-semibold tracking-tight text-ink">Marven</span>
    </span>
  );
}
