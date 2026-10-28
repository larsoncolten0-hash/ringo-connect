import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST { action: "paid" | "rejected", note? }: a Ringo administrator resolves a church payout request MANUALLY (they sent the money outside this app and attest it, or they decline it and the earnings go back to
// the church's available balance). It does not call Fapshi: an automated church payout (like the Shop's send/check flow) is a separate step that is not built yet.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const { action, note } = await request.json().catch(() => ({}));
  if (!["paid", "rejected"].includes(action)) return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 500)) return NextResponse.json({ error: "Invalid note." }, { status: 400 });

  const db = createAdminClient();
  const { error } = await db.rpc("church_payout_finish", { p_payout_id: params.id, p_outcome: action, p_actor: admin.id, p_note: note || null });
  if (error) {
    const m = String(error.message || "");
    if (m.includes("payout_already_finished")) return NextResponse.json({ error: "This payout has already been processed." }, { status: 409 });
    if (m.includes("payout_not_found")) return NextResponse.json({ error: "Payout not found." }, { status: 404 });
    return NextResponse.json({ error: "Could not update this payout." }, { status: 500 });
  }
  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "resolve_church_payout", details: { payoutId: params.id, resolution: action, note: note || null } });
  return NextResponse.json({ ok: true });
}
