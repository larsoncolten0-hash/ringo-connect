import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { getOwnPlanById, listPlanItems } from "@/lib/ai/calendar/store";
import { isUuid } from "@/lib/customer/connect";

export const dynamic = "force-dynamic";

const STATUS_BY_REASON: Record<string, number> = { not_authenticated: 401, disabled: 403, not_configured: 503, not_in_beta: 403, plan_not_eligible: 403 };

// GET /api/ai/calendar/plans/[id] — one plan + its items, ownership re-verified server-side.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const plan = await getOwnPlanById(access.access.workspace, params.id);
  if (!plan) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const items = await listPlanItems(access.access.workspace, plan.id);
  return NextResponse.json({ plan, items });
}
