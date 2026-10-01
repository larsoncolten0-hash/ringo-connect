// Business Toolkit Phase 5 (reports): the API as plain functions; the routes in src/app/api/reports/** are thin wrappers that resolve the owner
// (the same owner-only gate as bookkeeping, invoices, debtors and inventory) and call these. Everything is READ-ONLY. The business is always
// the caller's own profile; the only inputs are a month/year and a PDF language, and no figure ever comes from the request.
import type { ApiResult } from "@/lib/documents/handlers";
import { buildMonthlyReport, type ReportOwner } from "./build";
import { isReportLang, parsePeriodQuery, type ReportLang } from "./period";
import { renderReportPdfSafe, reportFilename } from "./pdf";

const bad = (details: string[]): ApiResult => ({ status: 400, body: { error: "validation_failed", details } });

export async function monthlyReport(owner: ReportOwner, query: { year?: string | null; month?: string | null }, opts: { now?: Date } = {}): Promise<ApiResult> {
  const p = parsePeriodQuery(query, opts.now);
  if (!p.ok) return bad([p.error]);
  try {
    return { status: 200, body: { report: await buildMonthlyReport(owner, p.period, opts) } };
  } catch (e: any) {
    console.error("reports build failed:", String(e?.message || e).slice(0, 200));
    return { status: 500, body: { error: "internal_error" } };
  }
}

export async function monthlyReportPdf(owner: ReportOwner, query: { year?: string | null; month?: string | null; lang?: string | null }, opts: { now?: Date } = {}): Promise<ApiResult> {
  const lang: ReportLang | null = query.lang == null || query.lang === "" ? "fr" : isReportLang(query.lang) ? query.lang : null;
  if (!lang) return bad(["invalid_lang"]);
  const p = parsePeriodQuery(query, opts.now);
  if (!p.ok) return bad([p.error]);
  let model;
  try {
    model = await buildMonthlyReport(owner, p.period, opts);
  } catch (e: any) {
    console.error("reports build failed:", String(e?.message || e).slice(0, 200));
    return { status: 500, body: { error: "internal_error" } };
  }
  const out = await renderReportPdfSafe(model, lang);
  if (!out.ok) {
    console.error("reports pdf failed:", out.error);
    return { status: 500, body: { error: "pdf_failed" } };
  }
  return { status: 200, pdf: out.bytes, filename: reportFilename(model) };
}
