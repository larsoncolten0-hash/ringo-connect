import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { publishCalendarItem } from "@/lib/ai/calendar/publish";
import { isUuid } from "@/lib/customer/connect";

// POST /api/ai/calendar/items/[id]/publish — the ONLY path that ever sends a calendar item to
// the Ringo Community. Never reachable from chat/AI tools — only this owner-initiated click.
export const dynamic = "force-dynamic";

const STATUS_BY_REASON: Record<string, number> = { not_authenticated: 401, disabled: 403, not_configured: 503, not_in_beta: 403, plan_not_eligible: 403 };

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const result = await publishCalendarItem(access.access.workspace, params.id);
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : result.reason === "already_published" || result.reason === "not_publishable" ? 409 : 500;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, communityPostId: result.communityPostId });
}
