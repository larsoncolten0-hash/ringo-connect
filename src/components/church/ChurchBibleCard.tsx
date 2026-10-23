import { BookOpenCheck } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import { isProgramReadable, resolveLanguage, type PublicProgram } from "@/lib/church/public/bible";
import type { PublicLang } from "@/lib/church/public/events";

// "Bible programmes" on the public church page (Phase 5), also drawn in the dashboard preview from an unsaved draft. Rendered by ProfileView only for the Churches & Ministries category and only when a
// programme is published. A programme shows its title, description and how many days it has, and one link: the programme's own page, where a visitor signs in to My Ringo to follow it (their progress is
// private to them). Everything is PLAIN TEXT (paragraphs are kept, markup is never interpreted). The visitor's language is used when the programme is readable in it; otherwise the other language is shown
// with a short note, so nobody gets an empty card.
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
  return (
    <section aria-labelledby={headingId} className={`relative overflow-hidden ${radiusClass}`} style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}>
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-2">
          <BookOpenCheck size={15} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          <h2 id={headingId} className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
            {c.heading}
          </h2>
        </div>
        <ul className="mt-3 flex flex-col gap-5">
          {shown.map(({ p, r }) => {
            const description = p[`description_${r.lang}`];
            return (
              <li key={p.id} className="min-w-0">
                <h3 className="text-sm font-semibold leading-snug [overflow-wrap:anywhere]">{p[`title_${r.lang}`]}</h3>
                {p.session_count > 0 && (
                  <p className="mt-0.5 text-xs" style={{ opacity: 0.7 }}>
                    {c.sessions(p.session_count)}
                  </p>
                )}
                {description && <p className="mt-2 text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{description}</p>}
                {preview ? (
                  <span className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold" style={{ color: accentText }}>
                    {c.start}
                  </span>
                ) : (
                  <a
                    href={`/my-ringo/journey/${p.id}`}
                    className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ color: accentText, outlineColor: accentText }}
                  >
                    {c.start}
                  </a>
                )}
                {r.fallback && (
                  <p className="mt-1 text-xs" style={{ opacity: 0.65 }}>
                    {c.shownIn(c.languageName[r.lang])}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs" style={{ opacity: 0.65 }}>
          {c.privacy}
        </p>
      </div>
    </section>
  );
}
