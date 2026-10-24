import { Clock, ExternalLink, MapPin } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import { isAnnouncementReadable, isEventReadable, resolveLanguage, type PublicAnnouncement, type PublicEvent, type PublicLang } from "@/lib/church/public/events";
import { SERIF } from "@/components/church/site/churchTheme";

// "Upcoming events" and "Announcements" on the public church page (Phase 4), also drawn in the dashboard preview from an unsaved draft. Rendered on the church site only for the Churches & Ministries
// category and only when something is published. Everything is PLAIN TEXT (paragraphs are kept, markup is never interpreted); the one link is an https address that already passed the same check the
// server applies. The visitor's language is used when the item is readable in it; otherwise the other language is shown with a short note, so nobody gets an empty card.
// Events lead with a calendar leaf (the day large, the month in the accent) so the date is the first thing read; announcements are quieter notes separated by hairlines.

interface Theme {
  t: Translations;
  /** The language the visitor reads (in the dashboard preview: the language being previewed). */
  locale: PublicLang;
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
}

const dateParts = (iso: string, lang: PublicLang) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const loc = lang === "fr" ? "fr-FR" : "en-GB";
  return {
    day: new Intl.DateTimeFormat(loc, { day: "numeric", timeZone: "UTC" }).format(dt),
    month: new Intl.DateTimeFormat(loc, { month: "short", timeZone: "UTC" }).format(dt),
    long: new Intl.DateTimeFormat(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(dt),
  };
};

const Shell = ({ theme, headingId, heading, children }: { theme: Theme; headingId: string; heading: string; children: React.ReactNode }) => (
  <section aria-labelledby={headingId} className={`relative min-w-0 ${theme.radiusClass}`} style={{ color: theme.textColor }}>
    <h2 id={headingId} className="text-[1.65rem] font-semibold leading-tight tracking-[-0.01em]" style={{ fontFamily: SERIF }}>
      {heading}
    </h2>
    {children}
  </section>
);

export function ChurchEventsCard({ events, ...theme }: Theme & { events: PublicEvent[] }) {
  const c = theme.t.churchEvents.public;
  const shown = events
    .map((e) => ({ e, r: resolveLanguage((l) => isEventReadable(e, l), theme.locale) }))
    .filter((x): x is { e: PublicEvent; r: { lang: PublicLang; fallback: boolean } } => x.r !== null);
  if (shown.length === 0) return null;
  return (
    <Shell theme={theme} headingId="church-events-heading" heading={c.eventsHeading}>
      <ul className="mt-5 flex flex-col gap-3">
        {shown.map(({ e, r }) => {
          const dp = dateParts(e.event_date, r.lang);
          const description = e[`description_${r.lang}`];
          const when = e.start_time && e.end_time ? c.range(e.start_time, e.end_time) : e.start_time ? c.from(e.start_time) : null;
          return (
            <li key={e.id} className={`flex items-start gap-4 border p-4 sm:p-5 ${theme.radiusClass}`} style={{ borderColor: theme.borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6), opacity: e.is_cancelled ? 0.8 : 1 }}>
              <div className="flex w-14 shrink-0 flex-col items-center rounded-2xl py-2 text-center leading-none" style={{ backgroundColor: hexToRgba(theme.accent, 0.12) }} aria-hidden="true">
                <span className="text-[1.6rem] font-semibold tabular-nums" style={{ fontFamily: SERIF }}>
                  {dp.day}
                </span>
                <span className="mt-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: theme.accentText }}>
                  {dp.month}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[1.05rem] font-semibold leading-snug [overflow-wrap:anywhere]">
                  <span className={e.is_cancelled ? "line-through decoration-1" : undefined}>{e[`title_${r.lang}`]}</span>
                  {e.is_cancelled && (
                    <span className="ml-2 inline-block rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide" style={{ border: `1px solid ${theme.borderTint}`, color: theme.accentText }}>
                      {c.cancelled}
                    </span>
                  )}
                </h3>
                <p className="mt-0.5 text-sm capitalize" style={{ opacity: 0.75 }}>
                  <time dateTime={e.event_date}>{dp.long}</time>
                </p>
                {(when || e.venue || e.address) && (
                  <div className="mt-2 flex flex-col gap-1 text-sm" style={{ opacity: 0.85 }}>
                    {when && (
                      <p className="flex items-center gap-1.5 tabular-nums">
                        <Clock size={14} className="shrink-0" style={{ color: theme.accent }} aria-hidden="true" />
                        {when}
                      </p>
                    )}
                    {(e.venue || e.address) && (
                      <p className="flex items-start gap-1.5 [overflow-wrap:anywhere]">
                        <MapPin size={14} className="mt-0.5 shrink-0" style={{ color: theme.accent }} aria-hidden="true" />
                        <span>{[e.venue, e.address].filter(Boolean).join(" · ")}</span>
                      </p>
                    )}
                  </div>
                )}
                {description && <p className="mt-3 max-w-[65ch] text-[0.95rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{description}</p>}
                {e.online_url && !e.is_cancelled && (
                  <a
                    href={e.online_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                    style={{ color: theme.accentText, outlineColor: theme.accentText }}
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    {c.online}
                  </a>
                )}
                {r.fallback && (
                  <p className="mt-2 text-xs" style={{ opacity: 0.7 }}>
                    {c.shownIn(c.languageName[r.lang])}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

export function ChurchAnnouncementsCard({ announcements, ...theme }: Theme & { announcements: PublicAnnouncement[] }) {
  const c = theme.t.churchEvents.public;
  const shown = announcements
    .map((a) => ({ a, r: resolveLanguage((l) => isAnnouncementReadable(a, l), theme.locale) }))
    .filter((x): x is { a: PublicAnnouncement; r: { lang: PublicLang; fallback: boolean } } => x.r !== null);
  if (shown.length === 0) return null;
  return (
    <Shell theme={theme} headingId="church-announcements-heading" heading={c.announcementsHeading}>
      <ul className="mt-4 flex flex-col">
        {shown.map(({ a, r }, i) => (
          <li key={a.id} className="min-w-0 py-4" style={i > 0 ? { borderTop: `1px solid ${theme.borderTint}` } : undefined}>
            <h3 className="text-[1.05rem] font-semibold leading-snug [overflow-wrap:anywhere]">{a[`title_${r.lang}`]}</h3>
            <p className="mt-1.5 max-w-[65ch] text-[0.95rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{a[`body_${r.lang}`]}</p>
            {a.expires_on && (
              <p className="mt-1.5 text-xs" style={{ opacity: 0.7 }}>
                {c.until(dateParts(a.expires_on, r.lang).long)}
              </p>
            )}
            {r.fallback && (
              <p className="mt-1 text-xs" style={{ opacity: 0.7 }}>
                {c.shownIn(c.languageName[r.lang])}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Shell>
  );
}
