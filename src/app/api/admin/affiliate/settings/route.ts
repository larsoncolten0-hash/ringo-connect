import { assertAdmin } from "@/lib/assertAdmin";
import { getAffiliateSettings, updateAffiliateSettings } from "@/lib/affiliateSettings";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getAffiliateSettings();
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));

  try {
    await updateAffiliateSettings(body, admin.id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  const adminClient = createAdminClient();
  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "update_affiliate_settings",
    details: body,
  });

  const settings = await getAffiliateSettings();
  return NextResponse.json({ ok: true, settings });
}
