import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push/send";
import { NextResponse } from "next/server";

// Granting a blue-tick request — the only code path that actually flips
// profiles.verified (see 2026-09-14_pin_and_verified.sql; UserTable.tsx's
// manual admin toggle is the other one). Service-role client throughout,
// gated by assertAdmin(), same posture as the support/admin routes.
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const adminUser = await assertAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    .update({ status: "approved", reviewed_by: adminUser.id, reviewed_at: now })
    .eq("id", params.id);
  if (updateError) {
    console.error("verification approve update failed:", updateError.message);
    return NextResponse.json({ error: "Could not approve this request." }, { status: 500 });
  }

  await admin.from("profiles").update({ verified: true }).eq("user_id", reqRow.user_id);

  await admin.from("admin_audit_log").insert({
    admin_id: adminUser.id,
    action: "verification_approved",
    target_user_id: reqRow.user_id,
    details: { verification_request_id: params.id },
  });

  await Promise.all([
    notifyUser(reqRow.user_id, {
      type: "verification_approved",
      title: "You're verified!",
      body: "Your profile now shows the verified badge.",
      link: "/dashboard",
    }),
    sendPushToUser(admin, reqRow.user_id, {
      category: "verification_approved",
      title: "You're verified!",
      body: "Your profile now shows the verified badge.",
      url: "/dashboard",
    }),
  ]);

  return NextResponse.json({ ok: true });
}
