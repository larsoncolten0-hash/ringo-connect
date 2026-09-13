import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push/send";
import { NextResponse } from "next/server";

// Declining a blue-tick request — never touches profiles.verified. The
// creator gets a fixed, friendly notification rather than the optional
// `note` this accepts, which is recorded for admin history only (see
// 2026-09-28_verification_requests.sql's own comment on admin_note).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const adminUser = await assertAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;

  const admin = createAdminClient();
  const { data: reqRow } = await admin
    .from("verification_requests")
    .select("id, user_id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!reqRow) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (reqRow.status !== "pending") {
    return NextResponse.json({ error: "This request was already reviewed." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error: updateError } = await admin
    .from("verification_requests")
    .update({ status: "rejected", admin_note: note, reviewed_by: adminUser.id, reviewed_at: now })
    .eq("id", params.id);
  if (updateError) {
    console.error("verification reject update failed:", updateError.message);
    return NextResponse.json({ error: "Could not update this request." }, { status: 500 });
  }

  await admin.from("admin_audit_log").insert({
    admin_id: adminUser.id,
    action: "verification_rejected",
    target_user_id: reqRow.user_id,
    details: { verification_request_id: params.id, note },
  });

  await Promise.all([
    notifyUser(reqRow.user_id, {
      type: "verification_rejected",
      title: "Verification request update",
      body: "Your verification request wasn't approved this time — you can review your details and try again.",
      link: "/dashboard",
    }),
    sendPushToUser(admin, reqRow.user_id, {
      category: "verification_rejected",
      title: "Verification request update",
      body: "Your verification request wasn't approved this time — you can review your details and try again.",
      url: "/dashboard",
    }),
  ]);

  return NextResponse.json({ ok: true });
}
