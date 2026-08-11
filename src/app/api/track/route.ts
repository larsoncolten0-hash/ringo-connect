import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractRequestContext } from "@/lib/requestContext";

// Used for link/product/WhatsApp click events, which originate from a
// browser interaction. Page views are logged directly in the profile
// page's server component instead, since that's already server-rendered
// and doesn't need a round trip.
//
// RLS already permits anonymous inserts into click_events (`with check
// (true)`), so this uses the regular (anon-key) server client — no
// service role needed here.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.profileId || !body?.targetType) {
    return NextResponse.json({ error: "Missing profileId or targetType" }, { status: 400 });
  }

  const { profileId, targetType, targetId } = body;
  if (!["link", "product", "whatsapp"].includes(targetType)) {
    return NextResponse.json({ error: "Invalid targetType" }, { status: 400 });
  }

  const { referrer, country, city } = extractRequestContext(request.headers);
  const supabase = createClient();

  const { error } = await supabase.from("click_events").insert({
    profile_id: profileId,
    target_type: targetType,
    target_id: targetId || null,
    referrer,
    country,
    city,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}