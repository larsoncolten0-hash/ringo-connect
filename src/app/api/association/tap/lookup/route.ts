import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";
import { createAdminClient } from "@/lib/supabase/server";

// POST /api/association/tap/lookup — body: { associationProfileId, cardReference }.
// The first step of the tap-to-log flow: the Partner's browser has already
// read the physical card via the existing Web NFC read function
// (readRingoCard, src/lib/ringoCardWriter.ts) and extracted the reference
// from the URL on the chip (member_card_url is
// https://.../m-card/<cardReference>) — this route resolves that reference
// to the Member's identity + current balance. Requires the caller to be
// this Association's Owner or an ACTIVE Partner (checked here, before any
// balance-affecting call is even possible) — never trusts a card reference
// alone as proof of authorization.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const associationProfileId = body?.associationProfileId as string | undefined;
  const cardReference = typeof body?.cardReference === "string" ? body.cardReference.trim() : "";
  if (!associationProfileId || !cardReference) {
    return NextResponse.json({ error: "associationProfileId and cardReference are required." }, { status: 400 });
  }

  const auth = await requireAssociationAccessJson(associationProfileId);
  if (!auth.ok) return auth.response;

  // A Partner has no RLS access to ringo_cards or association_members at
  // all (only the Owner does — see the migration's own note on why) — the
  // requireAssociationAccessJson call above IS the security boundary here,
  // not RLS, exactly like the existing card write/verify routes already
  // resolve a card via the service-role client rather than relying on the
  // caller owning it.
  const admin = createAdminClient();

  const { data: card } = await admin
    .from("ringo_cards")
    .select("id, status, association_member_id")
    .eq("card_reference", cardReference)
    .maybeSingle();

  if (!card || !card.association_member_id) {
    return NextResponse.json({ code: "card_not_recognized", error: "This isn't a recognized Membership Card." }, { status: 404 });
  }
  if (card.status === "disabled" || card.status === "replaced" || card.status === "lost") {
    return NextResponse.json({ code: "card_inactive", error: "This card is no longer active." }, { status: 409 });
  }

  const { data: member } = await admin
    .from("association_members")
    .select("id, name, points_balance, status")
    .eq("id", card.association_member_id)
    .eq("association_profile_id", associationProfileId)
    .maybeSingle();

  if (!member) return NextResponse.json({ code: "card_wrong_association", error: "This card doesn't belong to this Association." }, { status: 404 });
  if (member.status === "disabled") return NextResponse.json({ code: "member_disabled", error: "This Member's account is disabled." }, { status: 409 });

  return NextResponse.json({ member: { id: member.id, name: member.name, pointsBalance: member.points_balance } });
}
