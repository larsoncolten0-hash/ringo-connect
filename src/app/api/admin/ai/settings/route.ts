import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { AI_SETTINGS_COLUMNS, getAiSettings, hasPricing, parseAiSettingsPatch } from "@/lib/ai/settings";
import { getAiProvider, listAiProviderIds } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

// GET /api/admin/ai/settings — current Ringo AI settings + whether the
// provider key is present (never the key itself) + the registered provider
// ids the admin UI may offer (so it never shows one that isn't wired up).
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const settings = await getAiSettings();
  const provider = getAiProvider(settings.provider);
  return NextResponse.json({
    settings,
    providers: listAiProviderIds(),
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
  // parseAiSettingsPatch only checks the id's shape; only a provider this
  // server actually has an adapter for may be selected.
  if (typeof patch.provider === "string" && !getAiProvider(patch.provider)) {
    return NextResponse.json({ error: "invalid_settings" }, { status: 400 });
  }

  const db = createAdminClient();
  const { error } = await db
    .from("ai_settings")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: admin.id })
    .eq("id", 1)
    .select(AI_SETTINGS_COLUMNS)
    .single();
  if (error) {
    console.error("ai settings update failed:", error.message);
    // Postgres error code + message only (e.g. a CHECK-constraint violation) — never the row
    // payload, credentials, or any other DB detail — so an admin can actually see why a save was
    // rejected instead of a generic message, without exposing anything sensitive.
    return NextResponse.json({ error: "update_failed", detail: { code: error.code, message: error.message } }, { status: 500 });
  }

  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "ai_settings_update", details: patch });
  return NextResponse.json({ settings: await getAiSettings() });
}
