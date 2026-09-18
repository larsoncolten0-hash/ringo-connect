import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";
import { createAdminClient } from "@/lib/supabase/server";

// POST /api/association/tap/redeem — body: { associationProfileId, memberId,
// rewardId }. Calls the atomic log_association_redeem RPC, which re-reads
// the reward's points cost server-side (never trusted from the client) and
// only succeeds if the Member's balance actually covers it — the WHERE
// clause re-check inside that single UPDATE is what prevents a double-spend
// race on two near-simultaneous redemption taps for the same Member.
// Requires the caller to be this Association's Owner or an ACTIVE Partner —
// checked here BEFORE the RPC is called, same reasoning as tap/earn.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const associationProfileId = body?.associationProfileId as string | undefined;
  const memberId = body?.memberId as string | undefined;
  const rewardId = body?.rewardId as string | undefined;

  if (!associationProfileId || !memberId || !rewardId) {
    return NextResponse.json({ error: "associationProfileId, memberId, and rewardId are required." }, { status: 400 });
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

  const { data: txn, error } = await admin.rpc("log_association_redeem", {
    p_association_profile_id: associationProfileId,
    p_member_id: memberId,
    p_partner_profile_id: access.isPartner ? access.partnerProfileId : null,
    p_reward_id: rewardId,
  });

  // Same null-composite-vs-JS-null subtlety as log_association_earn — a
  // guard-clause failure (reward missing/inactive/wrong association, or
  // insufficient balance) comes back as an all-null-fields object.
  if (error || !txn?.id) {
    return NextResponse.json(
      { code: "redeem_failed", error: "Couldn't redeem this reward — check the reward is active and the Member has enough points." },
      { status: 409 }
    );
  }

  return NextResponse.json({ transaction: txn });
}
