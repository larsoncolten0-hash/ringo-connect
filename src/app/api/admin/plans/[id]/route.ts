import { createAdminClient } from "@/lib/supabase/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { NextResponse } from "next/server";

const EDITABLE_FIELDS = [
  "display_name",
  "max_links",
  "max_products",
  "pixels_enabled",
  "custom_theme_enabled",
  "full_analytics_enabled",
  "badge_removed",
  "price_usd",
  "price_xaf",
  "price_usd_yearly",
  "price_xaf_yearly",
  "features_en",
  "features_fr",
];

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const patch: Record<string, any> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) patch[key] = body[key];
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("plans").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "edit_plan",
    details: { planId: params.id, patch },
  });

  return NextResponse.json({ ok: true });
}