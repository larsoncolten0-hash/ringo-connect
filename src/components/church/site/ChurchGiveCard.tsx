"use client";

import { ArrowRight, HandCoins } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import SectionShell from "./SectionShell";

// "Give" on the church page: a clear button to the giving page, shown only when the church owner switched giving on. The page itself lists the open funds and takes the gift. In the dashboard preview there is no
// page to open, so the link is not drawn.
export default function ChurchGiveCard({ t, href, accent, accentText, textColor, borderTint, radiusClass }: { t: Translations; href?: string; accent: string; accentText: string; textColor: string; borderTint: string; radiusClass: string }) {
  const g = t.churchExpansion.gifts.public;
  return (
    <SectionShell t={t} headingId="church-give-card-heading" heading={g.title} accentText={accentText} borderTint={borderTint} textColor={textColor}>
      <div className={`mt-5 flex flex-col gap-4 border p-5 sm:flex-row sm:items-center ${radiusClass}`} style={{ borderColor: borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6) }}>
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(accent, 0.12), color: accentText }} aria-hidden="true">
          <HandCoins size={22} />
        </span>
        <p className="min-w-0 flex-1 text-[0.975rem] leading-relaxed">{g.intro}</p>
        {href && (
          <a href={href} className="inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold transition hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ backgroundColor: accent, color: "#fff", outlineColor: accentText }}>
            {g.submit}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        )}
      </div>
    </SectionShell>
  );
}
