import type { ReactNode } from "react";

export function Eyebrow({ children, tone = "brand" }: { children: ReactNode; tone?: "brand" | "amber" | "local" }) {
  const color = { brand: "text-brand", amber: "text-amber", local: "text-local" }[tone];
  return (
    <p className={`font-mono text-xs uppercase tracking-[0.18em] ${color}`}>
      <span className="text-dim">// </span>
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  lede,
  tone,
  center,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  tone?: "brand" | "amber" | "local";
  center?: boolean;
}) {
  return (
    <div className={center ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <Eyebrow tone={tone}>{eyebrow}</Eyebrow>
      <h2 className="mt-4 text-balance text-[2rem] font-semibold leading-[1.1] tracking-[-0.03em] text-ink sm:text-[2.6rem]">
        {title}
      </h2>
      {lede && <p className="mt-4 text-pretty text-[1.05rem] leading-relaxed text-mute">{lede}</p>}
    </div>
  );
}

/** Serif italic accent used for one or two words in a headline. */
export function Em({ children }: { children: ReactNode }) {
  return <em className="font-serif text-[1.08em] font-normal italic tracking-[-0.01em] text-brand-2">{children}</em>;
}
