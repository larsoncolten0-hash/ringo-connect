import type { ChurchActor } from "../actor";
import type { ReportPeriod } from "./period";

// Churches & Ministries Reports (Phase 10): the AGGREGATE figures behind the church reports. Counts and totals only.
//   * NO name, phone, e-mail, address or free text of a person ever enters a report: not a member, not a child, not a guardian, not a participant, not a beneficiary. Event and programme TITLES are the
//     church's own public content and are the only text a report carries.
//   * CHILDREN are never counted from the roster; the only child figure is the plain number recorded at an event (Attendance counts), exactly as it was entered.
//   * Care & Support and any money are NOT here, by design: no care case, beneficiary, contribution or finance figure is read by this file.
//   * Every figure is read through the signed-in person's OWN session, so row-level security stays the authority; on top of that a section is only built when the person holds the permission for the
//     data behind it (a reports.view holder without attendance.view gets no attendance section). A section that cannot be read is reported as failed, never as zero.

type Row = Record<string, any>;
export type ReportSectionId = "people" | "groups" | "events" | "attendance" | "bible" | "content";
export const REPORT_SECTIONS: readonly ReportSectionId[] = ["people", "groups", "events", "attendance", "bible", "content"];

/** Most events listed in the attendance table / most programmes in the Bible table. */
export const ATTENDANCE_EVENT_LIMIT = 60;
export const BIBLE_PROGRAM_LIMIT = 30;
const COUNT_CHUNK = 10;

export interface PeopleSection {
  scope: "snapshot+range";
  /** Roster people who are NOT children, by status. Children are never counted from the roster. */
  byStatus: { pending: number; active: number; inactive: number; removed: number };
  /** Active people who are NOT children, by age group. */
  activeByAgeGroup: { adult: number; youth: number };
  activeByLanguage: { en: number; fr: number; unknown: number };
  /** Added to the roster within the range (not children). */
  addedInRange: number;
}
export interface GroupsSection {
  scope: "snapshot";
  byKind: { department: number; group: number };
  /** Appointments with no end date, or an end date that has not passed. */
  openLeadershipAppointments: number;
}
export interface EventsSection {
  scope: "range";
  published: number;
  cancelled: number;
  upcoming: number;
  past: number;
  announcementsPublishedInRange: number;
}
export interface AttendanceEventRow {
  event_id: string;
  event_date: string;
  title_en: string | null;
  title_fr: string | null;
  is_cancelled: boolean;
  /** Roster people recorded present (a number: who they were is not in a report). */
  present: number;
  visitors: number;
  children: number;
  total: number;
  /** present + visitors: the figure that leaves the dashboard (CSV, Ringo AI). Children are not part of it, so subtracting cannot recover them. */
  totalNoChildren: number;
  recorded: boolean;
}
export interface AttendanceSection {
  scope: "range";
  events: AttendanceEventRow[];
  /** true when more events fall in the range than the table lists (the newest are kept). */
  truncated: boolean;
  totals: { eventsListed: number; eventsWithAttendance: number; present: number; visitors: number; children: number; total: number; averagePerRecordedEvent: number; peak: number; totalNoChildren: number; averageNoChildren: number; peakNoChildren: number };
}
export interface BibleProgramRow {
  program_id: string;
  title_en: string | null;
  title_fr: string | null;
  sessions: number;
  /** How many people follow it. Only a number: the database never tells staff who. */
  enrolled: number;
}
export interface BibleSection {
  scope: "snapshot";
  published: number;
  drafts: number;
  programs: BibleProgramRow[];
  truncated: boolean;
  totalEnrolled: number;
}
export interface ContentSection {
  scope: "range";
  publishedInRange: number;
  scheduledAhead: number;
  drafts: number;
}

export interface ReportModel {
  period: { from: string; to: string; days: number };
  today: string;
  sections: { people?: PeopleSection; groups?: GroupsSection; events?: EventsSection; attendance?: AttendanceSection; bible?: BibleSection; content?: ContentSection };
  /** Sections this person's permissions do not cover (not built, not read). */
  unavailable: ReportSectionId[];
  /** Sections that should have been built but could not be read. */
  failed: ReportSectionId[];
}

/** Which sections this person may have: reports.view AND the permission for the data behind each one. */
export function allowedSections(a: Pick<ChurchActor, "caps" | "kind">): ReportSectionId[] {
  const c = a.caps;
  if (a.kind === "leader" || !c.viewReports) return [];
  const out: ReportSectionId[] = [];
  if (c.viewMembers) out.push("people");
  if (c.viewGroups || c.viewLeadership) out.push("groups");
  if (c.viewEvents) out.push("events");
  if (c.viewAttendance) out.push("attendance");
  if (c.viewBible) out.push("bible");
  if (c.viewContent) out.push("content");
  return out;
}

const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.trunc(v) : 0);

async function countOf(a: ChurchActor, table: string, apply: (q: any) => any = (q) => q): Promise<number> {
  const { count, error } = await apply(a.supabase.from(table).select("id", { count: "exact", head: true }).eq("profile_id", a.profileId));
  if (error) throw new Error("count_failed");
  return int(count);
}

async function peopleSection(a: ChurchActor, p: ReportPeriod): Promise<PeopleSection> {
  const notChild = (q: any) => q.neq("age_group", "child");
  const [pending, active, inactive, removed, adult, youth, en, fr, addedInRange] = await Promise.all([
    ...(["pending", "active", "inactive", "removed"] as const).map((s) => countOf(a, "church_members", (q) => notChild(q).eq("status", s))),
    ...(["adult", "youth"] as const).map((g) => countOf(a, "church_members", (q) => q.eq("status", "active").eq("age_group", g))),
    ...(["en", "fr"] as const).map((l) => countOf(a, "church_members", (q) => notChild(q).eq("status", "active").eq("preferred_language", l))),
    countOf(a, "church_members", (q) => notChild(q).gte("created_at", p.fromUtc).lt("created_at", p.toUtcExclusive)),
  ]);
  return { scope: "snapshot+range", byStatus: { pending, active, inactive, removed }, activeByAgeGroup: { adult, youth }, activeByLanguage: { en, fr, unknown: Math.max(0, active - en - fr) }, addedInRange };
}

async function groupsSection(a: ChurchActor, today: string): Promise<GroupsSection> {
  const c = a.caps;
  const [department, group, open] = await Promise.all([
    c.viewGroups ? countOf(a, "church_groups", (q) => q.eq("kind", "department")) : Promise.resolve(0),
    c.viewGroups ? countOf(a, "church_groups", (q) => q.eq("kind", "group")) : Promise.resolve(0),
    c.viewLeadership ? countOf(a, "church_leadership", (q) => q.or(`ended_on.is.null,ended_on.gte.${today}`)) : Promise.resolve(0),
  ]);
  return { scope: "snapshot", byKind: { department, group }, openLeadershipAppointments: open };
}

async function eventsSection(a: ChurchActor, p: ReportPeriod, today: string): Promise<EventsSection> {
  const inRange = (q: any) => q.eq("status", "published").gte("event_date", p.from).lte("event_date", p.to);
  const [published, cancelled, upcoming, past, announcements] = await Promise.all([
    countOf(a, "ministry_events", inRange),
    countOf(a, "ministry_events", (q) => inRange(q).eq("is_cancelled", true)),
    countOf(a, "ministry_events", (q) => inRange(q).gte("event_date", today)),
    countOf(a, "ministry_events", (q) => inRange(q).lt("event_date", today)),
    countOf(a, "ministry_announcements", (q) => q.eq("status", "published").gte("published_at", p.fromUtc).lt("published_at", p.toUtcExclusive)),
  ]);
  return { scope: "range", published, cancelled, upcoming, past, announcementsPublishedInRange: announcements };
}

async function attendanceSection(a: ChurchActor, p: ReportPeriod, today: string): Promise<AttendanceSection> {
  const last = p.to < today ? p.to : today; // attendance exists only for events that have started
  const { data, error } = await a.supabase
    .from("ministry_events")
    .select("id, event_date, title_en, title_fr, is_cancelled")
    .eq("profile_id", a.profileId)
    .eq("status", "published")
    .gte("event_date", p.from)
    .lte("event_date", last)
    .order("event_date", { ascending: false })
    .order("id", { ascending: true })
    .limit(ATTENDANCE_EVENT_LIMIT + 1);
  if (error) throw new Error("events_failed");
  const all = (data as Row[]) || [];
  const truncated = all.length > ATTENDANCE_EVENT_LIMIT;
  const events = all.slice(0, ATTENDANCE_EVENT_LIMIT);
  const ids = events.map((e) => e.id as string);

  const present = new Map<string, number>();
  for (let i = 0; i < ids.length; i += COUNT_CHUNK) {
    const chunk = ids.slice(i, i + COUNT_CHUNK);
    const counts = await Promise.all(chunk.map((id) => countOf(a, "ministry_attendance", (q) => q.eq("event_id", id))));
    chunk.forEach((id, k) => present.set(id, counts[k]));
  }
  const counted = new Map<string, { visitors: number; children: number }>();
  if (ids.length > 0) {
    const { data: cd, error: ce } = await a.supabase.from("ministry_attendance_counts").select("event_id, visitors, children").eq("profile_id", a.profileId).in("event_id", ids);
    if (ce) throw new Error("counts_failed");
    for (const r of (cd as Row[]) || []) counted.set(r.event_id, { visitors: int(r.visitors), children: int(r.children) });
  }

  const rows: AttendanceEventRow[] = events.map((e) => {
    const pres = present.get(e.id) ?? 0;
    const c = counted.get(e.id);
    const visitors = c?.visitors ?? 0;
    const children = c?.children ?? 0;
    return { event_id: e.id, event_date: e.event_date, title_en: e.title_en ?? null, title_fr: e.title_fr ?? null, is_cancelled: e.is_cancelled === true, present: pres, visitors, children, total: pres + visitors + children, totalNoChildren: pres + visitors, recorded: pres > 0 || !!c };
  });
  const recorded = rows.filter((r) => r.recorded);
  const sum = (f: (r: AttendanceEventRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    scope: "range",
    events: rows,
    truncated,
    totals: {
      eventsListed: rows.length,
      eventsWithAttendance: recorded.length,
      present: sum((r) => r.present),
      visitors: sum((r) => r.visitors),
      children: sum((r) => r.children),
      total: sum((r) => r.total),
      averagePerRecordedEvent: recorded.length > 0 ? Math.round((recorded.reduce((s, r) => s + r.total, 0) / recorded.length) * 10) / 10 : 0,
      peak: recorded.reduce((m, r) => Math.max(m, r.total), 0),
      totalNoChildren: sum((r) => r.totalNoChildren),
      averageNoChildren: recorded.length > 0 ? Math.round((recorded.reduce((s, r) => s + r.totalNoChildren, 0) / recorded.length) * 10) / 10 : 0,
      peakNoChildren: recorded.reduce((m, r) => Math.max(m, r.totalNoChildren), 0),
    },
  };
}

async function bibleSection(a: ChurchActor): Promise<BibleSection> {
  const [published, drafts] = await Promise.all([countOf(a, "bible_programs", (q) => q.eq("status", "published")), countOf(a, "bible_programs", (q) => q.eq("status", "draft"))]);
  const { data, error } = await a.supabase
    .from("bible_programs")
    .select("id, title_en, title_fr")
    .eq("profile_id", a.profileId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(BIBLE_PROGRAM_LIMIT);
  if (error) throw new Error("programs_failed");
  const list = (data as Row[]) || [];
  const programs: BibleProgramRow[] = [];
  for (let i = 0; i < list.length; i += COUNT_CHUNK) {
    const chunk = list.slice(i, i + COUNT_CHUNK);
    const stats = await Promise.all(chunk.map((pr) => a.supabase.rpc("bible_program_stats", { p_program_id: pr.id })));
    chunk.forEach((pr, k) => {
      const s = stats[k];
      if (s.error) throw new Error("stats_failed");
      // the database answers null for a programme the caller may not see: it is left out, never shown as zero
      if (s.data && typeof s.data === "object") {
        programs.push({ program_id: pr.id, title_en: pr.title_en ?? null, title_fr: pr.title_fr ?? null, sessions: Array.isArray(s.data.sessions) ? s.data.sessions.length : 0, enrolled: int(s.data.enrolled) });
      }
    });
  }
  return { scope: "snapshot", published, drafts, programs, truncated: published > list.length, totalEnrolled: programs.reduce((s, r) => s + r.enrolled, 0) };
}

async function contentSection(a: ChurchActor, p: ReportPeriod, today: string): Promise<ContentSection> {
  const last = p.to < today ? p.to : today; // a word dated after today is not live yet
  const [publishedInRange, scheduledAhead, drafts] = await Promise.all([
    countOf(a, "daily_words", (q) => q.eq("status", "published").gte("publish_on", p.from).lte("publish_on", last)),
    countOf(a, "daily_words", (q) => q.eq("status", "published").gt("publish_on", today)),
    countOf(a, "daily_words", (q) => q.eq("status", "draft")),
  ]);
  return { scope: "range", publishedInRange, scheduledAhead, drafts };
}

/** Builds the report for the sections this person may have. Never throws for one failing section: that section is listed in `failed`. */
export async function buildReport(a: ChurchActor, period: ReportPeriod, today: string, only?: ReportSectionId): Promise<ReportModel> {
  const allowed = allowedSections(a);
  const wanted: ReportSectionId[] = only ? REPORT_SECTIONS.filter((s) => s === only) : [...REPORT_SECTIONS];
  const model: ReportModel = { period: { from: period.from, to: period.to, days: period.days }, today, sections: {}, unavailable: wanted.filter((s) => !allowed.includes(s)), failed: [] };
  const todo = wanted.filter((s) => allowed.includes(s));
  const builders: Record<ReportSectionId, () => Promise<unknown>> = {
    people: () => peopleSection(a, period),
    groups: () => groupsSection(a, today),
    events: () => eventsSection(a, period, today),
    attendance: () => attendanceSection(a, period, today),
    bible: () => bibleSection(a),
    content: () => contentSection(a, period, today),
  };
  const results = await Promise.allSettled(todo.map((s) => builders[s]()));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") (model.sections as Record<string, unknown>)[todo[i]] = r.value;
    else model.failed.push(todo[i]);
  });
  return model;
}
