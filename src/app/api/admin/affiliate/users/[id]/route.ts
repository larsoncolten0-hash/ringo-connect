import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Suspends/unsuspends ONE person's ability to earn as an affiliate,
// independent of their account status — see affiliate_suspended in
// supabase/migrations/2026-09-06_affiliate_system.sql. Writes through the
// service-role client, so it's unaffected by the protect_affiliate_fields
// trigger that blocks a regular user session from touching this column.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { suspended } = await request.json().catch(() => ({}));
  if (typeof suspended !== "boolean") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("users").update({ affiliate_suspended: suspended }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: suspended ? "suspend_affiliate" : "unsuspend_affiliate",
    target_user_id: params.id,
  });

  return NextResponse.json({ ok: true });
}
