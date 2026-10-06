import type { ReactNode } from "react";

// The landing page's shared section frame and heading, so every section follows one rhythm instead of its own padding and type.
//   paper  the page itself
//   quiet  a slightly raised band with warm hairlines (informational sections)
//   ink    the dark material: the moments the page lights up (the connection story, the Ringo Card, the close)
// Vertical rhythm is the foundation's spacing scale: 72px on phones, 112px from sm. The hero is the strongest moment, so
// nothing here is louder than it: headings are one size, one weight, one voice.
export type SectionTone = "paper" | "quiet" | "ink";

const TONE: Record<SectionTone, string> = {
  paper: "bg-ringo-bg text-ringo-text",
  quiet: "bg-ringo-surface text-ringo-text border-y border-ringo-line-warm",
  ink: "bg-ringo-ink text-ringo-paper overflow-hidden",
};

export function Section({
  id,
  tone = "paper",
  className = "",
  innerClassName = "",
  children,
}: {
  id?: string;
  tone?: SectionTone;
  className?: string;
  innerClassName?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={["relative scroll-mt-16", TONE[tone], className].filter(Boolean).join(" ")}>
      <div className={["relative max-w-6xl mx-auto px-5 py-18 sm:py-28", innerClassName].filter(Boolean).join(" ")}>{children}</div>
    </section>
  );
}

export function SectionHeading({
  title,
  lead,
  tone = "light",
  as: Tag = "h2",
  className = "",
}: {
  title: string;
  lead?: string;
  tone?: "light" | "dark";
  as?: "h2" | "h3";
  className?: string;
}) {
  return (
    <div className={["max-w-xl", className].filter(Boolean).join(" ")}>
      <Tag className="ringo-display text-[2rem] sm:text-4xl lg:text-[2.75rem] font-semibold tracking-[-0.025em] leading-[1.08] text-balance">{title}</Tag>
      {lead && <p className={`mt-4 text-lg leading-relaxed ${tone === "dark" ? "text-ringo-stone-300" : "text-ringo-muted"}`}>{lead}</p>}
    </div>
  );
}

/** The one secondary button style on the landing page (the primary is the indigo fill used by the header, hero and close). */
export const secondaryButton =
  "ringo-press transition-[transform,opacity,border-color] duration-ringo-fast ease-ringo inline-flex items-center justify-center gap-1.5 min-h-[48px] px-7 rounded-full border border-ringo-line-warm text-sm font-semibold text-ringo-text hover:border-ringo-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text";

// Primary (on paper): Ringo indigo with white text, the elevated CTA of the interaction language. On the dark material the same
// button is the lighter indigo of that surface with ink text (it needs to separate from near-black), kept as its own constant.
export const primaryButton =
  "ringo-tactile ringo-cta inline-flex items-center justify-center gap-1.5 min-h-[48px] px-7 rounded-full text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text";
const primaryButtonInkBase =
  "ringo-press transition-[transform,opacity,filter] duration-ringo-fast ease-ringo hover:brightness-105 inline-flex items-center justify-center gap-1.5 min-h-[48px] px-7 rounded-full bg-ringo-gold text-ringo-ink text-sm font-semibold shadow-ringo-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-text";

/** The same two buttons on the dark material: light outline and light focus ring (the page's `text` token is dark in the light theme). */
export const primaryButtonOnInk = primaryButtonInkBase.replace("focus-visible:outline-ringo-text", "focus-visible:outline-ringo-paper");
export const secondaryButtonOnInk =
  "ringo-press transition-[transform,opacity,border-color] duration-ringo-fast ease-ringo inline-flex items-center justify-center gap-1.5 min-h-[48px] px-7 rounded-full border border-ringo-paper/30 text-sm font-semibold text-ringo-paper hover:border-ringo-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-paper";
