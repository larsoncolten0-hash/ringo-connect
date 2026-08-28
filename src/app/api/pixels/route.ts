import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/crypto";

// Saves the per-profile Meta Conversions API / TikTok Events API access
// tokens. A dedicated route rather than PixelsCard's usual direct
// client-side supabase update (used for the plain pixel ID fields)
// because these need encrypting with Node's crypto module before they
// touch the database, and the raw token must never round-trip back to
// the browser once saved.
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body?.profileId) return NextResponse.json({ error: "Missing profileId" }, { status: 400 });

  const patch: Record<string, string> = {};
  // A blank field means "leave it alone" — the inputs on the client show
  // a masked "configured" state instead of the real value, so an
  // untouched field must never wipe an already-saved token.
  if (typeof body.facebookCapiToken === "string" && body.facebookCapiToken.trim()) {
    patch.facebook_capi_token_encrypted = encryptSecret(body.facebookCapiToken.trim());
  }
  if (typeof body.tiktokEventsToken === "string" && body.tiktokEventsToken.trim()) {
    patch.tiktok_events_token_encrypted = encryptSecret(body.tiktokEventsToken.trim());
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  // RLS ("profiles update by owner or admin") is the actual ownership
  // check here — this update simply matches zero rows for anyone else's
  // profileId, since this uses the caller's own session, not the
  // service-role client.
  const { error, data } = await supabase.from("profiles").update(patch).eq("id", body.profileId).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
