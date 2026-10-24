import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import { resolveWordLanguage, type PublicWord, type WordLang } from "@/lib/church/content/publicWord";
import { SERIF } from "@/components/church/site/churchTheme";

// "Daily Word": the church's published devotional on its public page (and, with a draft, the dashboard preview). Rendered on the church site only for the Churches & Ministries category and only when a word
// is published. Everything is PLAIN TEXT (paragraphs are kept, markup is never interpreted). The visitor's language is used when that word is complete in it; otherwise the other language is shown with a
// short note, so nobody gets an empty card. Set like a page of a devotional: the date, a serif title, the scripture in italic with its reference, then the reflection and prayer at a reading measure.

const formatDate = (iso: string, lang: WordLang): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
};

function WordBody({ w, lang, accentText, borderTint, level }: { w: PublicWord; lang: WordLang; accentText: string; borderTint: string; level: "h3" | "h4" }) {
  const title = w[`title_${lang}`];
  const ref = w[`scripture_ref_${lang}`];
  const scripture = w[`scripture_text_${lang}`];
  const body = w[`body_${lang}`];
  const Heading = level;
  return (
    <div className="flex flex-col gap-4">
      <Heading className={`${level === "h3" ? "text-[1.5rem] sm:text-[1.75rem]" : "text-lg"} font-semibold leading-tight tracking-[-0.01em] [overflow-wrap:anywhere] [text-wrap:balance]`} style={{ fontFamily: SERIF }}>
        {title}
      </Heading>
      {(scripture || ref) && (
        <blockquote className="border-y py-4" style={{ borderColor: borderTint }}>
          {scripture && (
            <p className="text-[1.0625rem] italic leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
              {scripture}
            </p>
          )}
          {ref && (
            <footer className="mt-2 text-sm font-semibold tracking-wide" style={{ color: accentText }}>
              {ref}
            </footer>
          )}
        </blockquote>
      )}
      {body && <p className="max-w-[65ch] text-[0.975rem] leading-[1.7] whitespace-pre-line [overflow-wrap:anywhere]">{body}</p>}
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
      <div className="mt-5 rounded-2xl px-4 py-3.5" style={{ backgroundColor: hexToRgba(accent, 0.09) }}>
        <p className="text-sm font-semibold" style={{ color: accentText }}>
          {c.prayer}
        </p>
        <p className="mt-1 max-w-[65ch] text-[0.975rem] italic leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
          {p}
        </p>
      </div>
    ) : null;
  };
  return (
    <section aria-labelledby={headingId} className={`relative ${radiusClass}`} style={{ color: textColor }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em]" style={{ fontFamily: SERIF }}>
          {c.heading}
        </h2>
        <p className="text-sm capitalize" style={{ color: accentText }}>
          <time dateTime={current.w.publish_on}>{formatDate(current.w.publish_on, current.r.lang)}</time>
        </p>
      </div>
      <div className="mt-5">
        <WordBody w={current.w} lang={current.r.lang} accentText={accentText} borderTint={borderTint} level="h3" />
        {prayerBlock(current.w, current.r.lang)}
        {current.r.fallback && (
          <p className="mt-3 text-xs" style={{ opacity: 0.7 }}>
            {c.shownIn(c.languageName[current.r.lang])}
          </p>
        )}
      </div>

      {earlier.length > 0 && (
        <details className="mt-6 border-t pt-2" style={{ borderColor: borderTint }}>
          <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ color: accentText, outlineColor: accentText }}>
            {c.earlier(earlier.length)}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {earlier.map(({ w, r }) => (
              <li key={w.id}>
                <details className="rounded-2xl border px-4" style={{ borderColor: borderTint }}>
                  <summary className="flex min-h-[52px] cursor-pointer flex-col justify-center py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ outlineColor: accentText }}>
                    <span className="text-[0.975rem] font-semibold [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
                      {w[`title_${r.lang}`]}
                    </span>
                    <time className="text-xs capitalize" dateTime={w.publish_on} style={{ opacity: 0.7 }}>
                      {formatDate(w.publish_on, r.lang)}
                    </time>
                  </summary>
                  <div className="pb-4 pt-2">
                    <WordBody w={w} lang={r.lang} accentText={accentText} borderTint={borderTint} level="h4" />
                    {prayerBlock(w, r.lang)}
                    {r.fallback && (
                      <p className="mt-2 text-xs" style={{ opacity: 0.7 }}>
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
    </section>
  );
}
