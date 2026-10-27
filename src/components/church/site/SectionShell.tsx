import type { ReactNode } from "react";
import type { Translations } from "@/lib/i18n/translations";
import { SERIF } from "./churchTheme";
import SeeMore from "./SeeMore";

// The frame of one section of the church site: a labelled region, its heading (the page's single h1 on a landing page, an h2 on the church page), an optional line under it, the content, and the
// optional "See more" link to the section's own page. The church cards of the later phases share it so they look and behave alike.
export default function SectionShell({
  t,
  headingId,
  heading,
  headingLevel = "h2",
  intro,
  seeMoreHref,
  accentText,
  borderTint,
  textColor,
  className = "",
  children,
}: {
  t: Translations;
  headingId: string;
  heading: string;
  headingLevel?: "h1" | "h2";
  intro?: string;
  seeMoreHref?: string;
  accentText: string;
  borderTint: string;
  textColor: string;
  className?: string;
  children: ReactNode;
}) {
  const H = headingLevel;
  return (
    <section aria-labelledby={headingId} className={`relative min-w-0 ${className}`} style={{ color: textColor }}>
      <H id={headingId} className={`${H === "h1" ? "text-[2rem] sm:text-[2.4rem]" : "text-[1.65rem]"} font-semibold leading-tight tracking-[-0.01em] [text-wrap:balance]`} style={{ fontFamily: SERIF }}>
        {heading}
      </H>
      {intro && (
        <p className="mt-2 max-w-[65ch] text-[0.95rem] leading-relaxed" style={{ opacity: 0.8 }}>
          {intro}
        </p>
      )}
      {children}
      {seeMoreHref && <SeeMore t={t} href={seeMoreHref} subject={heading} color={accentText} borderColor={borderTint} className="mt-5" />}
    </section>
  );
}
