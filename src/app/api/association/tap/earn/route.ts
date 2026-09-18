import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";
import { createAdminClient } from "@/lib/supabase/server";

// POST /api/association/tap/earn — body: { associationProfileId, memberId,
// amountXaf }. Computes points from association_settings.points_per_amount/
// amount_unit HERE (the RPC itself only ever applies an already-computed
// points value — it never reads settings), then calls the atomic
// log_association_earn RPC. Requires the caller to be this Association's
// Owner or an ACTIVE Partner — checked via requireAssociationAccessJson
// BEFORE the RPC is ever called, since the RPC (service-role only) trusts
// whatever partner_profile_id it's given.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const associationProfileId = body?.associationProfileId as string | undefined;
  const memberId = body?.memberId as string | undefined;
  const amountXaf = Number(body?.amountXaf);

  if (!associationProfileId || !memberId || !Number.isFinite(amountXaf) || amountXaf <= 0) {
    return NextResponse.json({ error: "associationProfileId, memberId, and a positive amountXaf are required." }, { status: 400 });
  }

  const auth = await requireAssociationAccessJson(associationProfileId);
  if (!auth.ok) return auth.response;
  const { access } = auth;

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("association_members")
    .select("id, status")
    .eq("id", memberId)
    .eq("association_profile_id", associationProfileId)
    .maybeSingle();
  if (!member) return NextResponse.json({ code: "member_not_found", error: "Member not found." }, { status: 404 });
  if (member.status === "disabled") return NextResponse.json({ code: "member_disabled", error: "This Member's account is disabled." }, { status: 409 });

  const { data: settings } = await admin
    .from("association_settings")
    .select("points_per_amount, amount_unit")
    .eq("association_profile_id", associationProfileId)
    .maybeSingle();
  const pointsPerAmount = settings?.points_per_amount ?? 1;
  const amountUnit = settings?.amount_unit ?? 100;

  const points = Math.floor((amountXaf / amountUnit) * pointsPerAmount);
  if (points < 1) {
    return NextResponse.json({ code: "amount_too_small", error: "That amount doesn't earn any points at the current rate." }, { status: 400 });
  }

  // partner_profile_id is null when the Owner logs this directly (never
  // trusted from the client either way — always this resolved access's own
  // value, matching how organization_invitations.invited_by is always
  // auth.uid(), never client-supplied).
  const { data: txn, error } = await admin.rpc("log_association_earn", {
    p_association_profile_id: associationProfileId,
    p_member_id: memberId,
    p_partner_profile_id: access.isPartner ? access.partnerProfileId : null,
    p_amount_xaf: amountXaf,
    p_points: points,
  });

  // A NULL composite return from the RPC (its guard clause — member not
  // found/wrong association) comes back through PostgREST as an object
  // with every field null, not a bare JS null, so `txn.id` (not just
  // `!txn`) is what actually detects that failure case.
  if (error || !txn?.id) {
    console.error("log_association_earn failed:", error?.message);
    return NextResponse.json({ code: "server_error", error: "Could not log this purchase." }, { status: 500 });
  }

  return NextResponse.json({ transaction: txn, pointsEarned: points });
}
