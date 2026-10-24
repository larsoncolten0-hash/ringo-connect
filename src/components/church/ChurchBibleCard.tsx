import { ArrowRight, BookOpen } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import { isProgramReadable, resolveLanguage, type PublicProgram } from "@/lib/church/public/bible";
import type { PublicLang } from "@/lib/church/public/events";
import { SERIF } from "@/components/church/site/churchTheme";

// "Bible programmes" on the public church page (Phase 5), also drawn in the dashboard preview from an unsaved draft. Rendered on the church site only for the Churches & Ministries category and only when a
// programme is published. A programme shows its title, description and how many days it has, and one link: the programme's own page, where a visitor signs in to My Ringo to follow it (their progress is
// private to them). Everything is PLAIN TEXT (paragraphs are kept, markup is never interpreted). The visitor's language is used when the programme is readable in it; otherwise the other language is shown
// with a short note, so nobody gets an empty card. Each programme is a calm reading row: the title in the serif, the length, the description at a reading measure, one clear way in.
export default function ChurchBibleCard({
  t,
  locale,
  programs,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
  preview = false,
}: {
  t: Translations;
  /** The language the visitor reads (in the dashboard preview: the language being previewed). */
  locale: PublicLang;
  programs: PublicProgram[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
  /** In the dashboard preview the link goes nowhere (the programme is not public yet). */
  preview?: boolean;
}) {
  const c = t.churchBible.public;
  const shown = programs
    .map((p) => ({ p, r: resolveLanguage((l) => isProgramReadable(p, l), locale) }))
    .filter((x): x is { p: PublicProgram; r: { lang: PublicLang; fallback: boolean } } => x.r !== null);
  if (shown.length === 0) return null;
  const headingId = "church-bible-heading";
  const action = "mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-sm font-semibold";
  return (
    <section aria-labelledby={headingId} className={`relative ${radiusClass}`} style={{ color: textColor }}>
      <h2 id={headingId} className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em]" style={{ fontFamily: SERIF }}>
        {c.heading}
      </h2>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {shown.map(({ p, r }) => {
          const description = p[`description_${r.lang}`];
          return (
            <li key={p.id} className={`flex min-w-0 flex-col border p-5 ${radiusClass}`} style={{ borderColor: borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6) }}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: hexToRgba(accent, 0.12) }} aria-hidden="true">
                  <BookOpen size={17} style={{ color: accentText }} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[1.15rem] font-semibold leading-snug [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
                    {p[`title_${r.lang}`]}
                  </h3>
                  {p.session_count > 0 && (
                    <p className="mt-0.5 text-sm tabular-nums" style={{ color: accentText }}>
                      {c.sessions(p.session_count)}
                    </p>
                  )}
                </div>
              </div>
              {description && <p className="mt-3 text-[0.95rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{description}</p>}
              <div className="mt-auto">
                {preview ? (
                  <span className={action} style={{ color: accentText, border: `1px solid ${hexToRgba(accent, 0.55)}` }}>
                    {c.start}
                    <ArrowRight size={15} aria-hidden="true" />
                  </span>
                ) : (
                  <a
                    href={`/my-ringo/journey/${p.id}`}
                    className={`${action} transition-colors hover:bg-black/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}
                    style={{ color: accentText, outlineColor: accentText, border: `1px solid ${hexToRgba(accent, 0.55)}` }}
                  >
                    {c.start}
                    <ArrowRight size={15} aria-hidden="true" />
                  </a>
                )}
              </div>
              {r.fallback && (
                <p className="mt-2 text-xs" style={{ opacity: 0.7 }}>
                  {c.shownIn(c.languageName[r.lang])}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm" style={{ opacity: 0.75 }}>
        {c.privacy}
      </p>
    </section>
  );
}
