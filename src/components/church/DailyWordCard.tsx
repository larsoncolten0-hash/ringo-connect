import { BookOpen } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import { resolveWordLanguage, type PublicWord, type WordLang } from "@/lib/church/content/publicWord";

// "Daily Word": the church's published devotional on its public page (and, with a draft, the dashboard preview). Rendered by ProfileView only for the Churches & Ministries category and only when a word
// is published. Everything is PLAIN TEXT (paragraphs are kept, markup is never interpreted). The visitor's language is used when that word is complete in it; otherwise the other language is shown with a
// short note, so nobody gets an empty card. Colors come from the page's own theme and panel, like the Visit card.

const formatDate = (iso: string, lang: WordLang): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

function WordBody({ w, lang, accent, accentText, level }: { w: PublicWord; lang: WordLang; accent: string; accentText: string; level: "h3" | "h4" }) {
  const title = w[`title_${lang}`];
  const ref = w[`scripture_ref_${lang}`];
  const scripture = w[`scripture_text_${lang}`];
  const body = w[`body_${lang}`];
  const Heading = level;
  return (
    <div className="flex flex-col gap-3">
      <Heading className="font-display text-lg font-semibold leading-snug [overflow-wrap:anywhere]">{title}</Heading>
      {(scripture || ref) && (
        <blockquote className="border-l-2 pl-3" style={{ borderColor: accent }}>
          {scripture && <p className="text-sm italic leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{scripture}</p>}
          {ref && (
            <footer className="mt-1 text-xs font-semibold" style={{ color: accentText }}>
              {ref}
            </footer>
          )}
        </blockquote>
      )}
      {body && <p className="text-sm leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{body}</p>}
    </div>
  );
}

export default function DailyWordCard({
  t,
  locale,
  words,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
}: {
  t: Translations;
  /** The language the visitor reads (in the dashboard preview: the language being previewed). */
  locale: WordLang;
  /** Newest first; the first is the current word, the rest are shown as earlier words. */
  words: PublicWord[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
}) {
  const c = t.churchContent.public;
  const shown = words.map((w) => ({ w, r: resolveWordLanguage(w, locale) })).filter((x): x is { w: PublicWord; r: { lang: WordLang; fallback: boolean } } => x.r !== null);
  if (shown.length === 0) return null;
  const [current, ...earlier] = shown;
  const headingId = "church-daily-word-heading";
  const prayerBlock = (w: PublicWord, lang: WordLang) => {
    const p = w[`prayer_${lang}`];
    return p ? (
      <div className="mt-1">
        <p className="text-xs uppercase tracking-wider" style={{ opacity: 0.7 }}>
          {c.prayer}
        </p>
        <p className="mt-0.5 text-sm italic leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{p}</p>
      </div>
    ) : null;
  };
  return (
    <section aria-labelledby={headingId} className={`relative overflow-hidden ${radiusClass}`} style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}>
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-2">
          <BookOpen size={15} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          <h2 id={headingId} className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
            {c.heading}
          </h2>
        </div>
        <p className="mt-2 text-xs capitalize" style={{ opacity: 0.7 }}>
          <time dateTime={current.w.publish_on}>{formatDate(current.w.publish_on, current.r.lang)}</time>
        </p>
        <div className="mt-3">
          <WordBody w={current.w} lang={current.r.lang} accent={accent} accentText={accentText} level="h3" />
          {prayerBlock(current.w, current.r.lang)}
          {current.r.fallback && (
            <p className="mt-3 text-xs" style={{ opacity: 0.65 }}>
              {c.shownIn(c.languageName[current.r.lang])}
            </p>
          )}
        </div>

        {earlier.length > 0 && (
          <details className="mt-4 border-t pt-3" style={{ borderColor: borderTint }}>
            <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: accentText, outlineColor: accentText }}>
              {c.earlier(earlier.length)}
            </summary>
            <ul className="mt-2 flex flex-col gap-2">
              {earlier.map(({ w, r }) => (
                <li key={w.id}>
                  <details className="rounded-lg border px-3" style={{ borderColor: borderTint }}>
                    <summary className="flex min-h-[44px] cursor-pointer flex-col justify-center py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ outlineColor: accentText }}>
                      <span className="text-sm font-medium [overflow-wrap:anywhere]">{w[`title_${r.lang}`]}</span>
                      <time className="text-xs" dateTime={w.publish_on} style={{ opacity: 0.65 }}>
                        {formatDate(w.publish_on, r.lang)}
                      </time>
                    </summary>
                    <div className="pb-3 pt-1">
                      <WordBody w={w} lang={r.lang} accent={accent} accentText={accentText} level="h4" />
                      {prayerBlock(w, r.lang)}
                      {r.fallback && (
                        <p className="mt-2 text-xs" style={{ opacity: 0.65 }}>
                          {c.shownIn(c.languageName[r.lang])}
                        </p>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
