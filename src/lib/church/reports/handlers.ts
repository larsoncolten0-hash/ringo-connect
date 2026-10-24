import type { ChurchActor } from "../actor";
import { failure } from "../errors";
import { todayDouala, type Result } from "../handlers";
import { REPORT_SECTIONS, allowedSections, buildReport, type ReportSectionId } from "./build";
import { REPORT_LANGS, csvFilename, sectionCsv, type ReportLang } from "./csv";
import { parseReportPeriod } from "./period";

// Churches & Ministries Reports (Phase 10): everything behind /api/church/reports. Same rules as the other church handlers:
//   * the church is always actor.profileId (server-resolved), never read from a request;
//   * every figure is read through the user's own session (row-level security is the authority) and a section is only built when the person holds the permission for its data;
//   * a failure is a short code, never the database's own message; a section that cannot be read is reported as failed, never as zero;
//   * READ-ONLY: nothing here writes, and nothing here reads a name, a child's record, a care case or any finance figure (see build.ts).
// GET /api/church/reports?from=&to=             the JSON report for the dates (Africa/Douala days, both ends included; default: the last 30 days)
// GET /api/church/reports?...&section=&format=csv&lang=   one section as CSV (counts only), in English or French

const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);
const ALLOWED_PARAMS = ["from", "to", "section", "format", "lang"];

export type ReportQuery = { from: string | null; to: string | null; section: ReportSectionId | null; format: "json" | "csv"; lang: ReportLang };

export function parseReportQuery(params: URLSearchParams): { ok: true; value: ReportQuery } | { ok: false; code: string; field?: string } {
  for (const k of Array.from(params.keys())) if (!ALLOWED_PARAMS.includes(k)) return { ok: false, code: "unexpected_field", field: k };
  for (const k of ALLOWED_PARAMS) if (params.getAll(k).length > 1) return { ok: false, code: "unexpected_field", field: k };
  const section = params.get("section");
  if (section !== null && !(REPORT_SECTIONS as readonly string[]).includes(section)) return { ok: false, code: "invalid_section", field: "section" };
  const format = params.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return { ok: false, code: "invalid_format", field: "format" };
  if (format === "csv" && section === null) return { ok: false, code: "invalid_section", field: "section" };
  const lang = params.get("lang") ?? "en";
  if (!(REPORT_LANGS as readonly string[]).includes(lang)) return { ok: false, code: "invalid_lang", field: "lang" };
  return { ok: true, value: { from: params.get("from"), to: params.get("to"), section: section as ReportSectionId | null, format, lang: lang as ReportLang } };
}

export async function getReport(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  // reports.view is the door; a group leader (a roster person, not staff) never has it
  if (a.kind === "leader" || !a.caps.viewReports) return fail(403, "forbidden");
  const q = parseReportQuery(params);
  if (!q.ok) return fail(400, q.code, q.field);
  const today = todayDouala();
  const period = parseReportPeriod(q.value.from, q.value.to, today);
  if (!period.ok) return fail(400, period.code, period.field);

  const allowed = allowedSections(a);
  if (q.value.section && !allowed.includes(q.value.section)) return fail(403, "section_unavailable");

  const model = await buildReport(a, period.value, today, q.value.section ?? undefined);
  if (q.value.format === "csv") {
    const id = q.value.section as ReportSectionId;
    const csv = sectionCsv(id, model, q.value.lang);
    if (csv === null) return fail(502, "report_failed");
    return { status: 200, body: { ok: true, csv, filename: csvFilename(id, model) } };
  }
  return { status: 200, body: { ok: true, report: model, allowed } };
}
