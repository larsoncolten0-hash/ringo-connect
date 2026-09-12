import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Commits a Ringo Card write AFTER the browser has already reported an
// actual, successful Web NFC write (see writeRingoCardUrl in
// src/lib/ringoCardWriter.ts) — this route never touches NFC hardware
// itself, it only records that it happened. Handles two cases with the
// same body shape ({ profileId, cardUid? }):
//
//   - First write: the card was just created via POST /api/ringo-cards
//     (status "assigned") and is now confirmed written -> "active".
//   - Rewrite: an existing "active" card is being pointed at a different
//     one of the caller's own profiles ("Rewrite Your Ringo Card").
//
// Security: exactly like the create route, profileId is resolved against
// the request-scoped (RLS) client and destination_url is always
// recomputed from that profile's username server-side — never accepted
// as a URL from the client. The card itself is loaded scoped to
// user_id = caller, so nobody can confirm a write against a card they
// don't own.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: card } = await supabase
    .from("ringo_cards")
    .select("id, user_id, status")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!card) return NextResponse.json({ error: "Ringo Card not found." }, { status: 404 });
  if (card.status === "disabled" || card.status === "replaced") {
    return NextResponse.json({ error: "This Ringo Card is no longer active." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const profileId = typeof body?.profileId === "string" ? body.profileId : null;
  const cardUid = typeof body?.cardUid === "string" && body.cardUid.trim() ? body.cardUid.trim().slice(0, 128) : undefined;
  if (!profileId) return NextResponse.json({ error: "A Ringo profile is required." }, { status: 400 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username")
    .eq("id", profileId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: "This Ringo profile is unavailable." }, { status: 404 });

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
  const destinationUrl = `${siteUrl}/${profile.username}`;
  const now = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("ringo_cards")
    .update({
      profile_id: profile.id,
      destination_url: destinationUrl,
      status: "active",
      last_written_at: now,
      updated_at: now,
      ...(cardUid ? { card_uid: cardUid } : {}),
    })
    .eq("id", card.id)
    .select("*")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "We couldn't connect your Ringo Card. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ card: updated });
}
