import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const EDITABLE_FIELDS = ["name", "price_xaf", "price_usd", "required", "active", "show_on_affiliate_page", "bundle_features"];

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const patch: Record<string, any> = {};
  for (const key of EDITABLE_FIELDS) {
    if (key in body) patch[key] = body[key];
  }

  // Ringo Card bundle bullet points (see AddonsManager.tsx) — sanitized
  // the same way an addon's own name/price already implicitly are by
  // going through a controlled admin form: trimmed, blank lines dropped,
  // and capped so one accidental huge paste can't blow out a bundle card
  // on the actual get-started form.
  if (Array.isArray(patch.bundle_features)) {
    patch.bundle_features = patch.bundle_features
      .map((line: unknown) => String(line).trim())
      .filter((line: string) => line.length > 0)
      .slice(0, 6);
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.from("addons").update(patch).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}