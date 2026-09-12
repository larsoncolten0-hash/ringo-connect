import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Records that a Ringo Card was actually read back and matched its
// expected destination — the "Verify" step right after writing, and the
// "Read Card" diagnostic action. Called only after the browser has done a
// real Web NFC read (readRingoCard in src/lib/ringoCardWriter.ts); this
// route just timestamps it against the caller's own card.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: card } = await supabase
    .from("ringo_cards")
    .select("id")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!card) return NextResponse.json({ error: "Ringo Card not found." }, { status: 404 });

  const body = await request.json().catch(() => ({}));
  // Best-effort hardware serial number captured during the read-back —
  // metadata only (see the migration's comment on ringo_cards.card_uid),
  // never treated as a credential.
  const cardUid = typeof body?.cardUid === "string" && body.cardUid.trim() ? body.cardUid.trim().slice(0, 128) : undefined;

  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("ringo_cards")
    .update({ last_verified_at: now, updated_at: now, ...(cardUid ? { card_uid: cardUid } : {}) })
    .eq("id", card.id)
    .select("*")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Couldn't verify your Ringo Card." }, { status: 500 });
  }

  return NextResponse.json({ card: updated });
}
