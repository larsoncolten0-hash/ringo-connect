import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// The one gate standing between "10-second preview" and "full song" — see
// the migration's header comment for the full architecture. This route
// NEVER returns the protected file itself, only a short-lived signed URL,
// and only after verifying the requester's order actually paid for this
// exact track (directly, or via the release/EP-album it belongs to).
// Nothing here trusts anything the client claims about its own purchase —
// order and track are both re-fetched from the database.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order");
  if (!orderId) return NextResponse.json({ error: "Missing order reference." }, { status: 400 });

  const admin = createAdminClient();

  const { data: track } = await admin.from("tracks").select("*").eq("id", params.id).maybeSingle();
  if (!track || !track.protected_audio_path) {
    return NextResponse.json({ error: "This track isn't available for full playback." }, { status: 404 });
  }

  const { data: order } = await admin.from("music_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || order.profile_id !== track.profile_id || order.payment_status !== "paid") {
    return NextResponse.json({ error: "No verified purchase found for this track." }, { status: 403 });
  }

  const { data: items } = await admin
    .from("music_order_items")
    .select("track_id, release_id, item_type")
    .eq("order_id", orderId);

  const owns = (items || []).some(
    (i) => (i.item_type === "song" && i.track_id === track.id) || (i.item_type === "release" && track.release_id && i.release_id === track.release_id)
  );
  if (!owns) {
    return NextResponse.json({ error: "No verified purchase found for this track." }, { status: 403 });
  }

  // 10 minutes — long enough to actually listen/download once, short
  // enough that the link isn't a durable, freely re-shareable URL.
  const { data: signed, error } = await admin.storage.from("protected-audio").createSignedUrl(track.protected_audio_path, 600, {
    download: request.headers.get("x-download") === "1" ? `${track.title}.mp3` : undefined,
  });
  if (error || !signed) {
    return NextResponse.json({ error: "Could not generate access — try again." }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, expiresIn: 600 });
}
