import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { getOwnPlan, listOwnPlans, listPlanItems, upsertPlan } from "@/lib/ai/calendar/store";

// GET  /api/ai/calendar/plans              — list the caller's own plans (most recent first)
// GET  /api/ai/calendar/plans?year=&month=  — one month's plan + its items
// POST /api/ai/calendar/plans               — create/update a month's plan directly (e.g. a
//                                              manual "New plan" UI action, no AI turn involved)
//
// Gated exactly like every other /api/ai/* route — the SAME text-AI access
// gate (kill switch, plan eligibility, profile ownership, staff-workspace
// rule, beta allowlist). Calendar planning is a text capability; there is
// no second authorization system here.
export const dynamic = "force-dynamic";

const STATUS_BY_REASON: Record<string, number> = { not_authenticated: 401, disabled: 403, not_configured: 503, not_in_beta: 403, plan_not_eligible: 403 };

export async function GET(request: Request) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });

  const { searchParams } = new URL(request.url);
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");

  if (yearParam && monthParam) {
    const year = Number(yearParam);
    const month = Number(monthParam);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    }
    const plan = await getOwnPlan(access.access.workspace, year, month);
    const items = plan ? await listPlanItems(access.access.workspace, plan.id) : [];
    return NextResponse.json({ plan, items });
  }

  const plans = await listOwnPlans(access.access.workspace);
  return NextResponse.json({ plans });
}

export async function POST(request: Request) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });

  const body = await request.json().catch(() => null);
  const year = Number(body?.year);
  const month = Number(body?.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) || null : null;

  const plan = await upsertPlan(access.access.workspace, year, month, { title, status: "active" });
  if (!plan) return NextResponse.json({ error: "internal" }, { status: 500 });
  return NextResponse.json({ plan });
}
