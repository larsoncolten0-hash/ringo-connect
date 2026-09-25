import { assertAdmin } from "@/lib/assertAdmin";
import { getProtectionSettings, updateProtectionSettings } from "@/lib/protectionSettings";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Mirrors /api/admin/affiliate/settings/route.ts's shape exactly.
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getProtectionSettings();
  return NextResponse.json({ settings });
}

export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));

  try {
    await updateProtectionSettings(body, admin.id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // Audit trail: same existing table/pattern every other admin financial setting already uses
  // (see supabase/schema.sql's admin_audit_log, RLS-locked to admins only) — no new audit system.
  const adminClient = createAdminClient();
  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "update_protection_settings",
    details: body,
  });

  const settings = await getProtectionSettings();
  return NextResponse.json({ ok: true, settings });
}
