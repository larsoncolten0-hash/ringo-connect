import { assertAdmin } from "@/lib/assertAdmin";
import { updateBrandingSettings, getBrandingSettings } from "@/lib/branding";
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

  // Which platform branding fields were changed, by whom (names only; the values are public branding but are not needed to investigate).
  await recordAudit(createAdminClient(), { actorId: admin.id, action: "branding_updated", details: { fields: Object.keys(body) } });

  return NextResponse.json({ branding: await getBrandingSettings() });
}
