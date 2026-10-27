"use client";

import { ChevronLeft, ChevronRight, Clock, ExternalLink, MapPin, Pause, Play } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import { groupAnnouncements, isAnnouncementReadable, isEventReadable, resolveLanguage, type PublicAnnouncement, type PublicEvent, type PublicLang } from "@/lib/church/public/events";
import { doualaToday } from "@/lib/church/week";
import { SERIF } from "@/components/church/site/churchTheme";
import { useRotation } from "@/components/church/site/useRotation";
import ChurchPicture from "@/components/church/site/ChurchPicture";
import SeeMore from "@/components/church/site/SeeMore";

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
  /** "h1" when the card IS the page (a landing page); "h2" (default) when it is a section of the church page. */
  headingLevel?: "h1" | "h2";
  /** Where "See more" goes (the section's landing page). Not given in the dashboard preview, so no link is drawn there. */
  seeMoreHref?: string;
  /** One line under the heading (the landing page). */
  intro?: string;
  /** Replaces the section's own title (the announcements of a group page are titled "Group announcements"). */
  heading?: string;
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

const Shell = ({ theme, headingId, heading, children }: { theme: Theme; headingId: string; heading: string; children: React.ReactNode }) => {
  const H = theme.headingLevel ?? "h2";
  return (
    <section aria-labelledby={headingId} className={`relative min-w-0 ${theme.radiusClass}`} style={{ color: theme.textColor }}>
      <H id={headingId} className={`${H === "h1" ? "text-[2rem] sm:text-[2.4rem]" : "text-[1.65rem]"} font-semibold leading-tight tracking-[-0.01em] [text-wrap:balance]`} style={{ fontFamily: SERIF }}>
        {heading}
      </H>
      {theme.intro && (
        <p className="mt-2 max-w-[65ch] text-[0.95rem] leading-relaxed" style={{ opacity: 0.8 }}>
          {theme.intro}
        </p>
      )}
      {children}
      {theme.seeMoreHref && <SeeMore t={theme.t} href={theme.seeMoreHref} subject={heading} color={theme.accentText} borderColor={theme.borderTint} className="mt-5" />}
    </section>
  );
};

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
            <li key={e.id} className={`overflow-hidden border ${theme.radiusClass}`} style={{ borderColor: theme.borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6), opacity: e.is_cancelled ? 0.8 : 1 }}>
              <ChurchPicture src={e.image_url} />
              <div className="flex items-start gap-4 p-4 sm:p-5">
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
              </div>
            </li>
          );
        })}
      </ul>
    </Shell>
  );
}

type ShownAnnouncement = { a: PublicAnnouncement; r: { lang: PublicLang; fallback: boolean } };

/** The announcements as a rotating slideshow: one at a time, holding still on hover, focus, a hidden tab and for visitors who prefer reduced motion, with a visible Pause / Play button. */
function AnnouncementsSlideshow({ shown, theme }: { shown: ShownAnnouncement[]; theme: Theme }) {
  const c = theme.t.churchEvents.public;
  const sl = theme.t.churchSite.public.slides;
  const n = shown.length;
  const rot = useRotation(n, 7000);
  const { a, r } = shown[rot.index];
  const btn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2";
  return (
    <Shell theme={theme} headingId="church-announcements-heading" heading={theme.heading ?? c.announcementsHeading}>
      <div
        aria-roledescription="carousel"
        aria-label={sl.announcementsLabel}
        className="mt-4"
        ref={rot.rootRef}
        {...rot.hold}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") rot.next();
          else if (e.key === "ArrowLeft") rot.prev();
        }}
      >
        <div role="group" aria-roledescription="slide" aria-label={sl.position(rot.index + 1, n)} aria-live={rot.live} className="min-h-[8.5rem]">
          <article key={a.id} className={`min-w-0 overflow-hidden border animate-fade-up motion-reduce:animate-none ${theme.radiusClass}`} style={{ borderColor: theme.borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6) }}>
            <ChurchPicture src={a.image_url} />
            <div className="p-5 sm:p-6">
            <h3 className="text-[1.2rem] font-semibold leading-snug [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
              {a[`title_${r.lang}`]}
            </h3>
            <p className="mt-2 max-w-[65ch] text-[0.95rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere]">{a[`body_${r.lang}`]}</p>
            {a.expires_on && (
              <p className="mt-2 text-xs" style={{ opacity: 0.7 }}>
                {c.until(dateParts(a.expires_on, r.lang).long)}
              </p>
            )}
            {r.fallback && (
              <p className="mt-1 text-xs" style={{ opacity: 0.7 }}>
                {c.shownIn(c.languageName[r.lang])}
              </p>
            )}
            </div>
          </article>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <button type="button" aria-label={sl.previous} onClick={rot.prev} className={btn} style={{ borderColor: theme.borderTint, color: theme.accentText }}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <div className="flex min-w-0 flex-wrap items-center justify-center">
            {shown.map((x, i) => (
              <button key={x.a.id} type="button" aria-label={sl.goTo(i + 1)} aria-current={i === rot.index ? "true" : undefined} onClick={() => rot.go(i)} className="group flex h-11 min-w-[28px] items-center justify-center focus-visible:outline-none">
                <span className="block h-2 rounded-full transition-all group-focus-visible:ring-2 motion-reduce:transition-none" style={{ width: i === rot.index ? 22 : 8, backgroundColor: i === rot.index ? theme.accent : hexToRgba(theme.textColor, 0.25) }} />
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" aria-label={rot.playing ? sl.pause : sl.play} aria-pressed={!rot.playing} onClick={rot.toggle} className={btn} style={{ borderColor: theme.borderTint, color: theme.accentText }}>
              {rot.playing ? <Pause size={17} aria-hidden="true" /> : <Play size={17} aria-hidden="true" />}
            </button>
            <button type="button" aria-label={sl.next} onClick={rot.next} className={btn} style={{ borderColor: theme.borderTint, color: theme.accentText }}>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </Shell>
  );
}

/** `rotate` (the church site) turns several announcements into a rotating slideshow; without it (the dashboard preview) they are a plain list. */
export function ChurchAnnouncementsCard({ announcements, rotate = false, grouped = false, ...theme }: Theme & { announcements: PublicAnnouncement[]; rotate?: boolean; /** The landing page: "This week" and "Ongoing" under their own labels. */ grouped?: boolean }) {
  const c = theme.t.churchEvents.public;
  const shown = announcements
    .map((a) => ({ a, r: resolveLanguage((l) => isAnnouncementReadable(a, l), theme.locale) }))
    .filter((x): x is ShownAnnouncement => x.r !== null);
  if (shown.length === 0) return null;
  if (rotate && shown.length > 1) return <AnnouncementsSlideshow shown={shown} theme={theme} />;
  const land = theme.t.churchSite.public.landing;
  const groups = grouped ? groupAnnouncements(shown.map((x) => x.a), doualaToday()) : null;
  const list = (rows: typeof shown) => (
      <ul className="mt-4 flex flex-col">
        {rows.map(({ a, r }, i) => (
          <li key={a.id} className="min-w-0 py-4" style={i > 0 ? { borderTop: `1px solid ${theme.borderTint}` } : undefined}>
            <ChurchPicture src={a.image_url} className={`mb-3 ${theme.radiusClass}`} />
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
  );
  return (
    <Shell theme={theme} headingId="church-announcements-heading" heading={theme.heading ?? c.announcementsHeading}>
      {groups ? (
        <>
          {([["thisWeek", land.thisWeek], ["ongoing", land.ongoing]] as const).map(([key, label]) => {
            const ids = new Set(groups[key].map((x) => x.id));
            const rows = shown.filter((x) => ids.has(x.a.id));
            return rows.length === 0 ? null : (
              <div key={key} className="mt-6">
                <h2 className="text-sm font-semibold" style={{ color: theme.accentText }}>
                  {label}
                </h2>
                {list(rows)}
              </div>
            );
          })}
        </>
      ) : (
        list(shown)
      )}
    </Shell>
  );
}
