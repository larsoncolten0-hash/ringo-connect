import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";

// GET /api/association/settings?associationProfileId=... — the Owner's
// earn rate + default MoMo number. Readable by the Owner and any active
// Partner (they need points_per_amount/amount_unit and the default MoMo
// number to run the tap-to-log/payment-display flow) — requireOwner is
// deliberately omitted here, unlike every other Owner-management route.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const associationProfileId = searchParams.get("associationProfileId");
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId);
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const { data: settings } = await supabase
    .from("association_settings")
    .select("*")
    .eq("association_profile_id", associationProfileId)
    .maybeSingle();

  // No row yet is a normal, expected state (row is created lazily, on
  // first save) — return the same defaults the column defaults declare,
  // so the UI never has to special-case "no settings row exists yet."
  return NextResponse.json({
    settings: settings || {
      association_profile_id: associationProfileId,
      points_per_amount: 1,
      amount_unit: 100,
      default_momo_number: null,
    },
  });
}

// PATCH /api/association/settings — body: { associationProfileId,
// pointsPerAmount?, amountUnit?, defaultMomoNumber? }. Owner only.
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  const associationProfileId = body?.associationProfileId as string | undefined;
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  const pointsPerAmount = Number(body?.pointsPerAmount);
  const amountUnit = Number(body?.amountUnit);
  if (!Number.isFinite(pointsPerAmount) || pointsPerAmount <= 0 || !Number.isFinite(amountUnit) || amountUnit <= 0) {
    return NextResponse.json({ code: "invalid_rate", error: "pointsPerAmount and amountUnit must both be positive numbers." }, { status: 400 });
  }
  const defaultMomoNumber = typeof body?.defaultMomoNumber === "string" ? body.defaultMomoNumber.trim().slice(0, 40) || null : null;

  const { data: settings, error } = await supabase
    .from("association_settings")
    .upsert(
      {
        association_profile_id: associationProfileId,
        points_per_amount: pointsPerAmount,
        amount_unit: amountUnit,
        default_momo_number: defaultMomoNumber,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "association_profile_id" }
    )
    .select("*")
    .single();

  if (error || !settings) return NextResponse.json({ code: "server_error", error: "Could not save settings." }, { status: 500 });
  return NextResponse.json({ settings });
}
