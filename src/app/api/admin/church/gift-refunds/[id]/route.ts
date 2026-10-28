import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST { decision: "approved" | "declined" | "refunded", note? }: a Ringo administrator records the decision on a church gift refund request.
// THIS MOVES NO MONEY AND CALLS NOTHING AT FAPSHI (Fapshi refunds are not supported by this code). "refunded" means the administrator has ALREADY returned the money by hand; it records that, marks the gift
// refunded and reverses the church's earning, and only while that earning is not part of a payout (otherwise the database refuses with refund_earning_in_payout and nothing changes).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { decision, note } = await request.json().catch(() => ({}));
  if (!["approved", "declined", "refunded"].includes(decision)) return NextResponse.json({ error: "Invalid decision." }, { status: 400 });
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 500)) return NextResponse.json({ error: "Invalid note." }, { status: 400 });

  const db = createAdminClient();
  const { error } = await db.rpc("church_gift_refund_decide", { p_request_id: params.id, p_decision: decision, p_actor: admin.id, p_note: note || null });
  if (error) {
    const m = String(error.message || "");
    if (m.includes("refund_earning_in_payout")) return NextResponse.json({ error: "This gift's earning is already part of a payout. Reject that payout first." }, { status: 409 });
    if (m.includes("refund_already_decided")) return NextResponse.json({ error: "This request was already decided." }, { status: 409 });
    if (m.includes("refund_not_found")) return NextResponse.json({ error: "Request not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not record the decision." }, { status: 500 });
  }
  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "decide_church_gift_refund", details: { requestId: params.id, decision, note: note || null } });
  return NextResponse.json({ ok: true });
}
