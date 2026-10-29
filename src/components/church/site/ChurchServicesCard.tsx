"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import type { PublicService } from "@/lib/church/public/services";
import { WEEKDAY_ORDER_MONDAY_FIRST, countdownParts, currentOccurrences, localDate, type OccurrenceStatus, type ServiceOccurrence } from "@/lib/church/schedule/occurrences";
import { addDays } from "@/lib/church/week";
import { SERIF } from "./churchTheme";

// "Our services" on the public church page: the church's regular weekly services, shown as the real next dates with a countdown. The church stores each service ONCE (weekday, local times,
// timezone); every date, countdown and status below is computed in the visitor's browser from those rules (lib/church/schedule/occurrences.ts), so nothing is generated or stored per week and the
// page stays cacheable. Before the browser has the time (server render, no JavaScript) the card shows the plain weekly timetable instead of dates, so the server and the browser never disagree.
// Status is always written in words (Happening now / Upcoming / Ended today), never colour alone. The countdown refreshes quietly once a minute and is not announced by screen readers.

interface Props {
  t: Translations;
  locale: "en" | "fr";
  services: PublicService[];
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
  surface?: string;
}

const pick = (en: string | null | undefined, fr: string | null | undefined, locale: "en" | "fr") => (locale === "fr" ? fr || en : en || fr) || "";

/** "2 d 3 h", "3 h 10 min", "12 min" from a number of milliseconds. */
export function countdownText(ms: number, c: Translations["churchSchedule"]["public"]): string {
  const { days, hours, minutes } = countdownParts(ms);
  if (days > 0) return `${days} ${c.dayShort} ${hours} ${c.hourShort}`;
  if (hours > 0) return `${hours} ${c.hourShort} ${minutes} ${c.minuteShort}`;
  return `${minutes} ${c.minuteShort}`;
}

const STATUS_WORD = (c: Translations["churchSchedule"]["public"], s: OccurrenceStatus) => (s === "live" ? c.live : s === "ended" ? c.ended : c.upcoming);

function dayLabel(o: ServiceOccurrence<PublicService>, now: number, locale: "en" | "fr", c: Translations["churchSchedule"]["public"]): string {
  const today = localDate(now, o.service.timezone);
  if (today === o.date) return c.today;
  if (today && addDays(today, 1) === o.date) return c.tomorrow;
  const [y, m, d] = o.date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

export default function ChurchServicesCard({ t, locale, services, accent, accentText, textColor, borderTint, radiusClass, surface }: Props) {
  const c = t.churchSchedule;
  const p = c.public;
  const [now, setNow] = useState<number | null>(null);
  const [deviceZone, setDeviceZone] = useState<string | null>(null);

  useEffect(() => {
    setNow(Date.now());
    try {
      setDeviceZone(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      setDeviceZone(null);
    }
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  if (services.length === 0) return null;
  const occurrences = now === null ? [] : currentOccurrences(services, now);
  const weekly = [...services].sort((a, b) => WEEKDAY_ORDER_MONDAY_FIRST.indexOf(a.weekday) - WEEKDAY_ORDER_MONDAY_FIRST.indexOf(b.weekday) || (a.start_time < b.start_time ? -1 : 1));
  const headingId = "church-services-heading";

  return (
    <section aria-labelledby={headingId} className={`relative overflow-hidden ${radiusClass}`} style={{ border: `1px solid ${borderTint}`, backgroundColor: surface ?? hexToRgba(textColor, 0.03), color: textColor }}>
      <div className="p-5 sm:p-7">
        <h2 id={headingId} className="flex items-center gap-2 text-[1.65rem] font-semibold leading-tight tracking-[-0.01em] [text-wrap:balance]" style={{ fontFamily: SERIF }}>
          <CalendarClock size={22} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          {p.title}
        </h2>
        <p className="mt-1.5 text-[0.95rem] leading-relaxed" style={{ opacity: 0.8 }}>
          {p.subtitle}
        </p>

        {now === null ? (
          <ul className="mt-4 flex flex-col">
            {weekly.map((s, i) => (
              <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5" style={i > 0 ? { borderTop: `1px solid ${borderTint}` } : undefined}>
                <span className="font-medium [overflow-wrap:anywhere]">{pick(s.title_en, s.title_fr, locale)}</span>
                <span className="text-sm tabular-nums" style={{ opacity: 0.85 }}>
                  {`${c.weekdays[s.weekday]} ${s.start_time} - ${s.end_time}`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="mt-4 flex flex-col">
            {occurrences.map((o, i) => {
              const name = pick(o.service.title_en, o.service.title_fr, locale);
              const description = pick(o.service.description_en, o.service.description_fr, locale);
              const status = STATUS_WORD(p, o.status);
              const when = o.status === "live" ? p.endsIn(countdownText(o.msUntilEnd, p)) : o.status === "upcoming" ? (o.msUntilStart < 60_000 ? p.startsSoon : p.startsIn(countdownText(o.msUntilStart, p))) : "";
              const label = dayLabel(o, now, locale, p);
              const range = `${o.service.start_time} - ${o.service.end_time}`;
              const otherZone = deviceZone !== null && deviceZone !== o.service.timezone;
              return (
                <li key={o.key} className="py-3.5" style={i > 0 ? { borderTop: `1px solid ${borderTint}` } : undefined} aria-label={p.itemAria(name, status, label)}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={o.status === "live" ? { backgroundColor: accent, color: "#fff" } : { border: `1px solid ${borderTint}`, color: o.status === "ended" ? textColor : accentText, opacity: o.status === "ended" ? 0.75 : 1 }}
                    >
                      {status}
                    </span>
                    <span className="text-base font-semibold [overflow-wrap:anywhere]">{name}</span>
                  </div>
                  <p className="mt-1 text-sm tabular-nums" style={{ opacity: 0.9 }}>
                    <span className="capitalize">{label}</span>
                    {` · ${range}`}
                  </p>
                  {when && (
                    <p className="mt-0.5 text-sm font-medium tabular-nums" style={{ color: accentText }}>
                      {when}
                    </p>
                  )}
                  {description && <p className="mt-1 max-w-[65ch] text-sm leading-relaxed [overflow-wrap:anywhere]" style={{ opacity: 0.85 }}>{description}</p>}
                  {o.service.location && <p className="mt-0.5 text-sm [overflow-wrap:anywhere]" style={{ opacity: 0.85 }}>{o.service.location}</p>}
                  {otherZone && (
                    <p className="mt-0.5 text-xs" style={{ opacity: 0.7 }}>
                      {p.timezoneLabel(o.service.timezone)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
