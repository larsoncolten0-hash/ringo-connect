import { createClient } from "@/lib/supabase/server";
import { generateUniqueCardReference } from "@/lib/ringoCardReference";
import { NextResponse } from "next/server";

// Assigns a new Ringo Card to one of the caller's own profiles — the
// "Assign this Ringo Card to my profile" step in the Ringo Card Writer
// flow (src/components/dashboard/RingoCardWriter.tsx). This only creates
// the logical record (status "assigned"); the physical NFC write itself
// happens client-side via Web NFC and is only confirmed by the caller a
// moment later through POST /api/ringo-cards/[id]/write, which is what
// actually flips status to "active".
//
// Security: profileId is the only client input. destination_url is never
// accepted from the client — it's always computed here from the profile
// row we just loaded, and that load uses the request-scoped (RLS) client,
// so a profileId belonging to someone else simply won't be found.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const profileId = typeof body?.profileId === "string" ? body.profileId : null;
  if (!profileId) return NextResponse.json({ error: "A Ringo profile is required." }, { status: 400 });

  // RLS ("profiles are publicly readable... or auth.uid() = user_id")
  // already prevents reading someone else's profile here, but we assert
  // ownership explicitly rather than relying on that alone.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, user_id")
    .eq("id", profileId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return NextResponse.json({ error: "This Ringo profile is unavailable." }, { status: 404 });

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
  const destinationUrl = `${siteUrl}/${profile.username}`;

  let cardReference: string;
  try {
    cardReference = await generateUniqueCardReference(supabase);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not prepare a Ringo Card." }, { status: 500 });
  }

  const { data: card, error } = await supabase
    .from("ringo_cards")
    .insert({
      user_id: user.id,
      profile_id: profile.id,
      card_reference: cardReference,
      destination_url: destinationUrl,
      status: "assigned",
      assigned_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !card) {
    return NextResponse.json({ error: "Ringo couldn't complete the setup. Check your connection and try again." }, { status: 500 });
  }

  return NextResponse.json({ card });
}
