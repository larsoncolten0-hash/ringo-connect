import { NextResponse } from "next/server";
import { generateUniqueCardReference } from "@/lib/ringoCardReference";
import { requireAssociationAccessJson } from "@/lib/association/access";

// POST /api/association/members/[id]/card — body: { associationProfileId }.
// Assigns a new Ringo Card to a Member — the Member-binding equivalent of
// POST /api/ringo-cards, kept as its own separate route rather than a new
// branch on that one (see the migration's own note: the existing
// profile-card write logic is never touched). Owner only.
//
// user_id is set to the OWNER's own user_id (they administratively own the
// physical card) — profile_id stays null, association_member_id is set
// instead. This needs no RLS change at all: the existing "ringo_cards owner
// all" policy already grants the Owner correct access via user_id =
// auth.uid(). member_card_url points at a new, harmless public landing page
// (never the Member's own dashboard) — see src/app/m-card/[reference]/page.tsx.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const associationProfileId = body?.associationProfileId as string | undefined;
  if (!associationProfileId) return NextResponse.json({ error: "associationProfileId is required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data: member } = await supabase
    .from("association_members")
    .select("id")
    .eq("id", params.id)
    .eq("association_profile_id", associationProfileId)
    .maybeSingle();
  if (!member) return NextResponse.json({ code: "member_not_found", error: "Member not found." }, { status: 404 });

  let cardReference: string;
  try {
    cardReference = await generateUniqueCardReference(supabase);
  } catch (err: any) {
    return NextResponse.json({ code: "server_error", error: err.message || "Could not prepare a Ringo Card." }, { status: 500 });
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
  const memberCardUrl = `${siteUrl}/m-card/${cardReference}`;

  const { data: card, error } = await supabase
    .from("ringo_cards")
    .insert({
      user_id: user.id,
      association_member_id: member.id,
      card_reference: cardReference,
      member_card_url: memberCardUrl,
      status: "assigned",
      assigned_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !card) {
    console.error("association member card insert failed:", error?.message);
    return NextResponse.json({ code: "server_error", error: "Ringo couldn't complete the setup. Check your connection and try again." }, { status: 500 });
  }

  return NextResponse.json({ card });
}
