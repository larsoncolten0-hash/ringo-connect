import { NextResponse } from "next/server";
import { requireAssociationAccessJson } from "@/lib/association/access";

// POST /api/association/members/[id]/card/write — body: { associationProfileId,
// cardId, cardUid? }. Commits a Membership Card write AFTER the browser has
// already reported a successful Web NFC write (same client-side function,
// src/lib/ringoCardWriter.ts, reused unchanged — only the URL it's told to
// write differs, computed by the create route above). Mirrors
// /api/ringo-cards/[id]/write exactly, kept as its own route for the same
// "never touch the existing profile-card write path" reason. Owner only.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json().catch(() => ({}));
  const associationProfileId = body?.associationProfileId as string | undefined;
  const cardId = body?.cardId as string | undefined;
  const cardUid = typeof body?.cardUid === "string" && body.cardUid.trim() ? body.cardUid.trim().slice(0, 128) : undefined;
  if (!associationProfileId || !cardId) return NextResponse.json({ error: "associationProfileId and cardId are required." }, { status: 400 });

  const auth = await requireAssociationAccessJson(associationProfileId, { requireOwner: true });
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  // Route param `[id]` is the Member id, kept in the path for symmetry with
  // the create route; the actual card is looked up by `cardId` in the body,
  // since a Member could in principle have more than one card record over
  // time (e.g. a lost-and-replaced card) — this confirms the given card
  // actually belongs to the given Member, not just to the caller.
  const { data: card } = await supabase
    .from("ringo_cards")
    .select("id, status, association_member_id")
    .eq("id", cardId)
    .eq("user_id", user.id)
    .eq("association_member_id", params.id)
    .maybeSingle();

  if (!card) {
    return NextResponse.json({ code: "card_not_found", error: "Ringo Card not found." }, { status: 404 });
  }
  if (card.status === "disabled" || card.status === "replaced") {
    return NextResponse.json({ code: "card_inactive", error: "This Ringo Card is no longer active." }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("ringo_cards")
    .update({
      status: "active",
      last_written_at: now,
      updated_at: now,
      ...(cardUid ? { card_uid: cardUid } : {}),
    })
    .eq("id", cardId)
    .select("*")
    .single();

  if (error || !updated) {
    return NextResponse.json({ code: "server_error", error: "We couldn't connect this Ringo Card. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ card: updated });
}
