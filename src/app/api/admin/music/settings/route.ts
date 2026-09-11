import { assertAdmin } from "@/lib/assertAdmin";
import { updateMusicPayoutSettings } from "@/lib/musicPayoutSettings";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Mirrors /api/admin/affiliate/settings/route.ts's shape.
export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();

  try {
    await updateMusicPayoutSettings(body, admin.id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const adminClient = createAdminClient();
  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "update_music_payout_settings",
    details: body,
  });

  return NextResponse.json({ ok: true });
}
