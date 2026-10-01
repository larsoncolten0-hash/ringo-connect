// Business Toolkit Phase 7A (overview): the API as a plain function; src/app/api/overview/route.ts is a thin wrapper that resolves the owner (the same
// owner-only gate as Phases 1-6) and calls this. READ-ONLY. The business is always the caller's own profile and no input comes from the request.
import type { ApiResult } from "@/lib/documents/handlers";
import type { ReportOwner } from "@/lib/reports/build";
import { buildOverview } from "./build";

export async function overviewSummary(owner: ReportOwner, opts: { now?: Date } = {}): Promise<ApiResult> {
  try {
    return { status: 200, body: { overview: await buildOverview(owner, opts) } };
  } catch (e: any) {
    console.error("overview build failed:", String(e?.message || e).slice(0, 200));
    return { status: 500, body: { error: "internal_error" } };
  }
}
