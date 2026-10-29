// Churches & Ministries Recurring Weekly Services: the calendar maths, in ONE place (pure: no I/O, no React, safe in the browser and on the server).
//
// A church stores a service ONCE ("Sunday 09:00-12:00, Africa/Douala"); nothing here ever writes a dated copy. A dated "occurrence" is computed on demand from the weekday, the local wall-clock
// times and the service's OWN IANA timezone, so a church in Paris, Douala or Toronto each get their own local week, and daylight-saving changes are handled by the timezone database
// (Intl), never by a fixed offset. Weekdays follow lib/church/week.ts: 0 = Sunday ... 6 = Saturday.
//
// An occurrence is identified by `key` = "<serviceId>:<local YYYY-MM-DD>". That pair is stable for ever, so the planned attendance feature can record "I plan to come" / "I was there" against
// a real service day without any occurrence ever being stored.
//
//   upcoming  now is before the start
//   live      the start has passed and the end has not ("happening now")
//   ended     the end has passed (shown for the rest of that local day, so a visitor sees what they missed)
//
// DST rules: a wall-clock time that does not exist (the spring-forward gap) is moved forward by the gap; a time that exists twice (the autumn repeat) means its FIRST occurrence.

import { addDays, weekday } from "../week";

export type OccurrenceStatus = "upcoming" | "live" | "ended";

export interface ScheduleService {
  id: string;
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number;
  /** "HH:MM" local wall-clock time (a database "HH:MM:SS" is accepted) */
  start_time: string;
  end_time: string;
  /** IANA timezone identifier, for example "Africa/Douala" */
  timezone: string;
  is_enabled: boolean;
  title_en?: string | null;
  title_fr?: string | null;
  description_en?: string | null;
  description_fr?: string | null;
  location?: string | null;
}

export interface ServiceOccurrence<S extends ScheduleService = ScheduleService> {
  /** "<serviceId>:<local date>": the stable identity of one real service day (what attendance will attach to). */
  key: string;
  service: S;
  /** The local calendar date of the service in its own timezone, YYYY-MM-DD. */
  date: string;
  startMs: number;
  endMs: number;
  status: OccurrenceStatus;
  /** Milliseconds until the start (0 once started). */
  msUntilStart: number;
  /** Milliseconds until the end (0 once ended). */
  msUntilEnd: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;
const MINUTE = 60_000;
const DAY = 86_400_000;

/** "17:30" or "17:30:00" -> "17:30"; null when it is not a time of day. */
export function normalizeTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = HHMM.exec(value.trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

const formatters = new Map<string, Intl.DateTimeFormat | null>();
function formatterFor(tz: string): Intl.DateTimeFormat | null {
  if (formatters.has(tz)) return formatters.get(tz) ?? null;
  let f: Intl.DateTimeFormat | null = null;
  try {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    f = null;
  }
  if (formatters.size > 200) formatters.clear();
  formatters.set(tz, f);
  return f;
}

/** Whether `tz` is an IANA timezone identifier this runtime knows (case-sensitive, like the database). */
export function isValidTimezone(tz: unknown): tz is string {
  return typeof tz === "string" && tz.length >= 1 && tz.length <= 64 && /^[A-Za-z0-9_+\-/]+$/.test(tz) && formatterFor(tz) !== null;
}

interface LocalParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function localParts(ms: number, tz: string): LocalParts | null {
  const f = formatterFor(tz);
  if (!f) return null;
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") out[p.type] = Number(p.value);
  if (out.year === undefined) return null;
  return { y: out.year, mo: out.month, d: out.day, h: out.hour === 24 ? 0 : out.hour, mi: out.minute, s: out.second };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** The local calendar date (YYYY-MM-DD) at instant `ms` in `tz`; null for an unknown timezone. */
export function localDate(ms: number, tz: string): string | null {
  const p = localParts(ms, tz);
  return p ? `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}` : null;
}

/** The offset of `tz` from UTC at instant `ms`, in milliseconds (positive east of Greenwich). */
function offsetAt(ms: number, tz: string): number | null {
  const p = localParts(ms, tz);
  if (!p) return null;
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** The instant a local wall-clock time ("YYYY-MM-DD" + "HH:MM") happens in `tz`; null for an unknown timezone, date or time. */
export function zonedTimeToMs(date: string, time: string, tz: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = normalizeTime(time);
  if (!m || !t || weekday(date) === null) return null;
  const [hh, mm] = t.split(":").map(Number);
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm);
  // The offsets in force a day before and a day after bracket any single transition. A candidate instant is real when it maps back to the same wall-clock time.
  const before = offsetAt(wall - DAY, tz);
  const after = offsetAt(wall + DAY, tz);
  if (before === null || after === null) return null;
  const real = Array.from(new Set([before, after]))
    .map((o) => wall - o)
    .filter((candidate) => offsetAt(candidate, tz) === wall - candidate);
  if (real.length > 0) return Math.min(...real); // two real instants = the autumn repeat: the first one
  return wall - before; // the spring-forward gap: the time does not exist, so move forward by the gap
}

/** One dated occurrence of `service` on the local `date`, relative to `now`; null when the service's data is unusable or the date is not its weekday. */
export function occurrenceOn<S extends ScheduleService>(service: S, date: string, now: number): ServiceOccurrence<S> | null {
  if (weekday(date) !== service.weekday) return null;
  const start = zonedTimeToMs(date, service.start_time, service.timezone);
  const rawEnd = zonedTimeToMs(date, service.end_time, service.timezone);
  if (start === null || rawEnd === null) return null;
  const end = Math.max(rawEnd, start + MINUTE); // a service always lasts at least a minute, whatever a DST gap does to its end
  const status: OccurrenceStatus = now < start ? "upcoming" : now < end ? "live" : "ended";
  return { key: `${service.id}:${date}`, service, date, startMs: start, endMs: end, status, msUntilStart: Math.max(0, start - now), msUntilEnd: Math.max(0, end - now) };
}

const ORDER: Record<OccurrenceStatus, number> = { live: 0, upcoming: 1, ended: 2 };

/**
 * The services to show on a public page, computed from the schedule alone:
 *   - every enabled service's NEXT occurrence (today's if it has not ended, otherwise next week's);
 *   - plus today's occurrence when it is happening now (live) or already ended today, so a visitor sees what is on and what they missed.
 * Disabled services and services with unusable data are skipped. Order: happening now, then upcoming (soonest first), then ended today.
 * `limit` caps the result (live first, so a service in progress is never the one dropped).
 */
export function currentOccurrences<S extends ScheduleService>(services: readonly S[], now: number = Date.now(), limit = 12): ServiceOccurrence<S>[] {
  const out: ServiceOccurrence<S>[] = [];
  for (const s of services) {
    if (!s || s.is_enabled === false || !Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6) continue;
    const today = localDate(now, s.timezone);
    if (today === null) continue;
    const dow = weekday(today);
    if (dow === null) continue;
    const delta = (s.weekday - dow + 7) % 7;
    const first = addDays(today, delta);
    const occ = first ? occurrenceOn(s, first, now) : null;
    if (!occ) continue;
    if (occ.status === "ended") {
      out.push(occ); // ended earlier today
      const next = addDays(first as string, 7);
      const nextOcc = next ? occurrenceOn(s, next, now) : null;
      if (nextOcc) out.push(nextOcc);
    } else {
      out.push(occ);
    }
  }
  out.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === "ended" ? b.startMs - a.startMs : a.startMs - b.startMs) || (a.key < b.key ? -1 : 1));
  return out.slice(0, Math.max(0, limit));
}

/** The next occurrence of one service, for a caller that needs just that (for example attendance later). */
export function nextOccurrence<S extends ScheduleService>(service: S, now: number = Date.now()): ServiceOccurrence<S> | null {
  return currentOccurrences([service], now, 2).find((o) => o.status !== "ended") ?? null;
}

export interface Countdown {
  days: number;
  hours: number;
  minutes: number;
}

/** A countdown split into days / hours / minutes, rounded DOWN to the minute (so "starts in 0 minutes" only appears in the final minute). */
export function countdownParts(ms: number): Countdown {
  const total = Math.max(0, Math.floor(ms / MINUTE));
  return { days: Math.floor(total / 1440), hours: Math.floor((total % 1440) / 60), minutes: total % 60 };
}

/** The weekday names are a UI concern, in i18n; this only fixes the order a church thinks in: Sunday first is how the data is numbered, Monday first is how the dashboard lists them. */
export const WEEKDAY_ORDER_MONDAY_FIRST: readonly number[] = [1, 2, 3, 4, 5, 6, 0];
