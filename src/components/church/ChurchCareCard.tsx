import { HeartHandshake } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import { isCareReadable, resolveLanguage, type PublicCareCase } from "@/lib/church/public/care";
import type { PublicLang } from "@/lib/church/public/events";

// "Care and support" on the public church page (Phase 9), also drawn in the dashboard preview. Rendered by ProfileView only for the Churches & Ministries category and only when at least one case is
// published. A published case always has the beneficiary's recorded consent (the database enforces it and takes the case down the moment consent is withdrawn). It shows the church's own title and description
// and a category: no name, no photo, no amount, no button to give. Nothing here collects money. Everything is PLAIN TEXT.
export default function ChurchCareCard({
  t,
  locale,
  cases,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
}: {
  t: Translations;
  locale: PublicLang;
  cases: PublicCareCase[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
}) {
  const c = t.churchCare;
  const shown = cases
    .map((x) => ({ x, r: resolveLanguage((l) => isCareReadable(x, l), locale) }))
    .filter((v): v is { x: PublicCareCase; r: { lang: PublicLang; fallback: boolean } } => v.r !== null);
  if (shown.length === 0) return null;
  const headingId = "church-care-heading";
  return (
    <section aria-labelledby={headingId} className={`relative overflow-hidden ${radiusClass}`} style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}>
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-2">
          <HeartHandshake size={15} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          <h2 id={headingId} className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
            {c.public.heading}
          </h2>
        </div>
        <p className="mt-2 text-xs leading-relaxed" style={{ opacity: 0.7 }}>
          {c.public.intro}
        </p>
        <ul className="mt-3 flex flex-col gap-4">
          {shown.map(({ x, r }) => (
            <li key={x.id} className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: accentText }}>
                {(c.categories as Record<string, string>)[x.category] ?? x.category}
              </p>
              <h3 className="mt-0.5 text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{x[`title_${r.lang}`]}</h3>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{x[`summary_${r.lang}`]}</p>
              {r.fallback && (
                <p className="mt-1 text-xs" style={{ opacity: 0.65 }}>
                  {c.public.shownIn(t.churchEvents.public.languageName[r.lang])}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
