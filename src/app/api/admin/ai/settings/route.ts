import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { AI_SETTINGS_COLUMNS, getAiSettings, hasPricing, parseAiSettingsPatch } from "@/lib/ai/settings";
import { getAiProvider } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

// GET /api/admin/ai/settings — current Ringo AI settings + whether the
// provider key is present (never the key itself).
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getAiSettings();
  const provider = getAiProvider(settings.provider);
  return NextResponse.json({
    settings,
    providerConfigured: !!provider?.isConfigured(),
    pricingConfigured: hasPricing(settings),
  });
}

// PUT /api/admin/ai/settings — partial update; invalid values reject the whole update.
export async function PUT(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patch = parseAiSettingsPatch(await request.json().catch(() => null));
  if (!patch) return NextResponse.json({ error: "invalid_settings" }, { status: 400 });

  const db = createAdminClient();
  const { error } = await db
    .from("ai_settings")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: admin.id })
    .eq("id", 1)
    .select(AI_SETTINGS_COLUMNS)
    .single();
  if (error) {
    console.error("ai settings update failed:", error.message);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "ai_settings_update", details: patch });
  return NextResponse.json({ settings: await getAiSettings() });
}
