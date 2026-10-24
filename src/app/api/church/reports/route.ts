import { NextResponse } from "next/server";
import { churchRoute } from "@/lib/church/routeKit";
import { getReport } from "@/lib/church/reports/handlers";

export const dynamic = "force-dynamic";

// GET /api/church/reports?from=&to=: the church's AGGREGATE report (counts only, never names) for a range of Africa/Douala days. Needs church.reports.view; each section also needs the permission for its data.
// With ?section=&format=csv[&lang=en|fr] the answer is that one section as a CSV download. Read-only. The handler validates every parameter; this file only turns its answer into a file.
export async function GET(request: Request) {
  const res = await churchRoute(request, { write: false }, (actor, { params }) => getReport(actor, params));
  if (res.status !== 200) return res;
  const body = (await res.json()) as { csv?: unknown; filename?: unknown };
  if (typeof body.csv !== "string") return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
  if (typeof body.filename !== "string" || !/^[A-Za-z0-9_.-]+$/.test(body.filename)) {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(body.csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${body.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
