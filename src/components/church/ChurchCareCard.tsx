import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import { isCareReadable, resolveLanguage, type PublicCareCase } from "@/lib/church/public/care";
import type { PublicLang } from "@/lib/church/public/events";
import { SERIF } from "@/components/church/site/churchTheme";
import ChurchPicture from "@/components/church/site/ChurchPicture";
import SeeMore from "@/components/church/site/SeeMore";

// "Care and support" on the public church page (Phase 9), also drawn in the dashboard preview. Rendered on the church site only for the Churches & Ministries category and only when at least one case is
// published. A published case always has the beneficiary's recorded consent (the database enforces it and takes the case down the moment consent is withdrawn). It shows the church's own title and description
// and a category: no name, no photo, no amount, no button to give. Nothing here collects money. Everything is PLAIN TEXT. Set quietly, with no urgency cues: a short intro, then each need as a plain note.
export default function ChurchCareCard({
  t,
  locale,
  cases,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
  headingLevel = "h2",
  seeMoreHref,
}: {
  t: Translations;
  locale: PublicLang;
  cases: PublicCareCase[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
  /** "h1" when the card IS the page (the landing page). */
  headingLevel?: "h1" | "h2";
  /** Where "See more" goes; none in the dashboard preview. */
  seeMoreHref?: string;
}) {
  const c = t.churchCare;
  const shown = cases
    .map((x) => ({ x, r: resolveLanguage((l) => isCareReadable(x, l), locale) }))
    .filter((v): v is { x: PublicCareCase; r: { lang: PublicLang; fallback: boolean } } => v.r !== null);
  if (shown.length === 0) return null;
  const headingId = "church-care-heading";
  const H = headingLevel;
  return (
    <section aria-labelledby={headingId} className={`relative ${radiusClass}`} style={{ color: textColor }}>
      <H id={headingId} className={`${H === "h1" ? "text-[2rem] sm:text-[2.4rem]" : "text-[1.65rem]"} font-semibold leading-tight tracking-[-0.01em]`} style={{ fontFamily: SERIF }}>
        {c.public.heading}
      </H>
      <p className="mt-2 max-w-[65ch] text-[0.95rem] leading-relaxed" style={{ opacity: 0.8 }}>
        {c.public.intro}
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {shown.map(({ x, r }) => (
          <li key={x.id} className={`min-w-0 overflow-hidden border ${radiusClass}`} style={{ borderColor: borderTint, backgroundColor: hexToRgba(accent, 0.05) }}>
            <ChurchPicture src={x.image_url} />
            <div className="p-5">
            <p className="text-sm font-semibold" style={{ color: accentText }}>
              {(c.categories as Record<string, string>)[x.category] ?? x.category}
            </p>
            <h3 className="mt-1 text-[1.1rem] font-semibold leading-snug [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
              {x[`title_${r.lang}`]}
            </h3>
            <p className="mt-2 text-[0.95rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{x[`summary_${r.lang}`]}</p>
            {r.fallback && (
              <p className="mt-2 text-xs" style={{ opacity: 0.7 }}>
                {c.public.shownIn(t.churchEvents.public.languageName[r.lang])}
              </p>
            )}
            </div>
          </li>
        ))}
      </ul>
      {seeMoreHref && <SeeMore t={t} href={seeMoreHref} subject={c.public.heading} color={accentText} borderColor={borderTint} className="mt-5" />}
    </section>
  );
}
