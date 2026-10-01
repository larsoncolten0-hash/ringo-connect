// Business Toolkit Phase 7A (overview): the API as a plain function; src/app/api/overview/route.ts is a thin wrapper that resolves the owner (the same
// owner-only gate as Phases 1-6) and calls this. READ-ONLY. The business is always the caller's own profile and no input comes from the request.
import type { ApiResult } from "@/lib/documents/handlers";
import type { ReportOwner } from "@/lib/reports/build";
import { parsePeriodQuery } from "@/lib/reports/period";
import { buildOverview } from "./build";
import { DEFAULT_SPAN, TREND_SPANS, buildTrends, buildYtd } from "./trends";

export async function overviewSummary(owner: ReportOwner, opts: { now?: Date } = {}): Promise<ApiResult> {
  try {
    return { status: 200, body: { overview: await buildOverview(owner, opts) } };
  } catch (e: any) {
    console.error("overview build failed:", String(e?.message || e).slice(0, 200));
    return { status: 500, body: { error: "internal_error" } };
  }
}

// ------------------------------------------------------------------------------------------------------------------------------ Phase 7B
const bad = (details: string[]): ApiResult => ({ status: 400, body: { error: "validation_failed", details } });

function parseSpan(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return DEFAULT_SPAN;
  return (TREND_SPANS as readonly number[]).map(String).includes(v) ? Number(v) : null;
}

/** Trend over 3, 6 or 12 months ending at the chosen month, with the comparison against the previous equivalent period. READ-ONLY. */
export async function overviewTrends(owner: ReportOwner, query: { year?: string | null; month?: string | null; span?: string | null }, opts: { now?: Date } = {}): Promise<ApiResult> {
  const span = parseSpan(query.span);
  if (span === null) return bad(["invalid_span"]);
  const p = parsePeriodQuery(query, opts.now);
  if (!p.ok) return bad([p.error]);
  try {
    return { status: 200, body: { trend: await buildTrends(owner, p.period, span, opts) } };
  } catch (e: any) {
    console.error("trends build failed:", String(e?.message || e).slice(0, 200));
    return { status: 500, body: { error: "internal_error" } };
  }
}

/** Year to date: January through the chosen month, additive flows only. READ-ONLY. */
export async function overviewYtd(owner: ReportOwner, query: { year?: string | null; month?: string | null }, opts: { now?: Date } = {}): Promise<ApiResult> {
  const p = parsePeriodQuery(query, opts.now);
  if (!p.ok) return bad([p.error]);
  try {
    return { status: 200, body: { ytd: await buildYtd(owner, p.period, opts) } };
  } catch (e: any) {
    console.error("ytd build failed:", String(e?.message || e).slice(0, 200));
    return { status: 500, body: { error: "internal_error" } };
  }
}
