import { translations } from "@/lib/i18n/translations";
import type { ReportModel, ReportSectionId } from "./build";

// Churches & Ministries Reports (Phase 10): the CSV export. Pure: no I/O. The export NEVER carries a child figure (not even the recorded children count): its totals are present + visitors. It writes ONLY what the report model holds (counts and the church's own event / programme titles), so a CSV can never
// carry a name, a contact detail or a child's record: the model has none. Every cell that could be read as a spreadsheet formula is neutralised, and a byte-order mark makes Excel read accents.

export type ReportLang = "en" | "fr";
export const REPORT_LANGS: readonly ReportLang[] = ["en", "fr"];

/** The single-number figures of a section, in display order: [key, value]. The key is also the label key under t.churchReports.figures.<section>. Tables (attendance events, Bible programmes) are separate. */
export function sectionFigures(id: ReportSectionId, model: ReportModel, opts: { exportSafe?: boolean } = {}): Array<[string, number]> {
  const s = model.sections;
  switch (id) {
    case "people":
      return s.people ? [["pending", s.people.byStatus.pending], ["active", s.people.byStatus.active], ["inactive", s.people.byStatus.inactive], ["removed", s.people.byStatus.removed], ["adult", s.people.activeByAgeGroup.adult], ["youth", s.people.activeByAgeGroup.youth], ["english", s.people.activeByLanguage.en], ["french", s.people.activeByLanguage.fr], ["languageUnknown", s.people.activeByLanguage.unknown], ["addedInRange", s.people.addedInRange]] : [];
    case "groups":
      return s.groups ? [["departments", s.groups.byKind.department], ["groups", s.groups.byKind.group], ["leadership", s.groups.openLeadershipAppointments]] : [];
    case "events":
      return s.events ? [["published", s.events.published], ["cancelled", s.events.cancelled], ["upcoming", s.events.upcoming], ["past", s.events.past], ["announcements", s.events.announcementsPublishedInRange]] : [];
    case "attendance":
      return s.attendance ? [["eventsListed", s.attendance.totals.eventsListed], ["eventsWithAttendance", s.attendance.totals.eventsWithAttendance], ["present", s.attendance.totals.present], ["visitors", s.attendance.totals.visitors], ...(opts.exportSafe ? [] : [["children", s.attendance.totals.children] as [string, number]]), ...(opts.exportSafe ? ([["totalNoChildren", s.attendance.totals.totalNoChildren], ["averageNoChildren", s.attendance.totals.averageNoChildren], ["peakNoChildren", s.attendance.totals.peakNoChildren]] as Array<[string, number]>) : ([["total", s.attendance.totals.total], ["average", s.attendance.totals.averagePerRecordedEvent], ["peak", s.attendance.totals.peak]] as Array<[string, number]>))] : [];
    case "bible":
      return s.bible ? [["published", s.bible.published], ["drafts", s.bible.drafts], ["followers", s.bible.totalEnrolled]] : [];
    case "content":
      return s.content ? [["publishedInRange", s.content.publishedInRange], ["scheduledAhead", s.content.scheduledAhead], ["drafts", s.content.drafts]] : [];
  }
}

/** One CSV cell: a formula-looking value is made inert, then quoted when it needs it. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !(typeof value === "number" && Number.isFinite(value))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const line = (cells: unknown[]) => cells.map(csvCell).join(",");
const titleOf = (en: string | null, fr: string | null, lang: ReportLang) => (lang === "fr" ? fr || en : en || fr) ?? "";

export function csvFilename(id: ReportSectionId, model: ReportModel): string {
  return `church-report-${id}-${model.period.from}_${model.period.to}.csv`;
}

/** The CSV text of one section of a report, in English or French. Returns null when the section is not in the model. */
export function sectionCsv(id: ReportSectionId, model: ReportModel, lang: ReportLang): string | null {
  if (!model.sections[id]) return null;
  const t = translations[lang].churchReports;
  const fig = (t.figures as Record<string, Record<string, string>>)[id];
  const rows: string[] = [
    line([t.csv.section, t.sections[id]]),
    line([t.csv.periodFrom, model.period.from]),
    line([t.csv.periodTo, model.period.to]),
    "",
    line([t.csv.measure, t.csv.value]),
    ...sectionFigures(id, model, { exportSafe: true }).map(([k, v]) => line([fig[k] ?? k, v])),
  ];
  if (id === "attendance" && model.sections.attendance) {
    const a = t.attendance;
    rows.push("", line([a.date, a.event, a.present, a.visitors, a.totalNoChildren]));
    for (const e of model.sections.attendance.events) rows.push(line([e.event_date, titleOf(e.title_en, e.title_fr, lang) + (e.is_cancelled ? ` (${a.cancelled})` : ""), e.present, e.visitors, e.totalNoChildren]));
  }
  if (id === "bible" && model.sections.bible) {
    const b = t.bible;
    rows.push("", line([b.program, b.sessions, b.followers]));
    for (const p of model.sections.bible.programs) rows.push(line([titleOf(p.title_en, p.title_fr, lang), p.sessions, p.enrolled]));
  }
  return "﻿" + rows.join("\r\n") + "\r\n";
}
