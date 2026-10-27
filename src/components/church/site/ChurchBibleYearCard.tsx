"use client";

import { ArrowRight, BookOpen } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import SectionShell from "./SectionShell";

// "The Bible in one year" on the church page: an invitation, shown only when the church owner switched the feature on. The reader's own plan lives on its own page, so this card knows nothing about any
// reader. In the dashboard preview there is no page to open, so the link is not drawn.
export default function ChurchBibleYearCard({ t, href, accent, accentText, textColor, borderTint, radiusClass }: { t: Translations; href?: string; accent: string; accentText: string; textColor: string; borderTint: string; radiusClass: string }) {
  const c = t.churchExpansion.bibleYear;
  return (
    <SectionShell t={t} headingId="church-bible-year-card-heading" heading={c.section} accentText={accentText} borderTint={borderTint} textColor={textColor}>
      <div className={`mt-5 flex flex-col gap-4 border p-5 sm:flex-row sm:items-center ${radiusClass}`} style={{ borderColor: borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6) }}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(accent, 0.12), color: accentText }} aria-hidden="true">
          <BookOpen size={22} />
        </span>
        <p className="min-w-0 flex-1 text-[0.975rem] leading-relaxed">{c.cardIntro}</p>
        {href && (
          <a href={href} className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ backgroundColor: accent, color: "#FFFFFF", outlineColor: accentText }}>
            {c.open}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        )}
      </div>
    </SectionShell>
  );
}
