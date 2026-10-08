import { assertAdmin } from "@/lib/assertAdmin";
import { updateBrandingSettings, getBrandingSettingsFresh, BRANDING_CACHE_TAG } from "@/lib/branding";
import { revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/adminAudit";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  try {
    await updateBrandingSettings(body, admin.id);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // The platform branding is cached for a short window (lib/branding.ts); a save makes it visible everywhere at once.
  try {
    revalidateTag(BRANDING_CACHE_TAG);
  } catch {
    /* the cache expires by itself within BRANDING_REVALIDATE_SECONDS */
  }

  // Which platform branding fields were changed, by whom (names only; the values are public branding but are not needed to investigate).
  await recordAudit(createAdminClient(), { actorId: admin.id, action: "branding_updated", details: { fields: Object.keys(body) } });

  return NextResponse.json({ branding: await getBrandingSettingsFresh() });
}
