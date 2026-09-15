import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Public, unauthenticated by design — /public/card-funnel.html is a static
// page shared before a visitor ever reaches the app, so it has no session
// to authenticate with (same reasoning as /api/community/subscribe). Looks
// up which user a ?ref= affiliate code belongs to and returns ONLY their
// profiles.whatsapp_number, so the funnel page's "I have a question"
// button can message the actual person who shared the link. Never throws
// for an unknown/invalid code — always resolves to { whatsapp_number: null }
// so the funnel page can fall back to the platform default number.
export async function GET(request: Request) {
  const ref = new URL(request.url).searchParams.get("ref")?.trim().toUpperCase();
  if (!ref) return NextResponse.json({ whatsapp_number: null });

  const admin = createAdminClient();
  const { data: owner } = await admin.from("users").select("id").eq("affiliate_code", ref).maybeSingle();
  if (!owner) return NextResponse.json({ whatsapp_number: null });

  const { data: profile } = await admin
    .from("profiles")
    .select("whatsapp_number")
    .eq("user_id", owner.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ whatsapp_number: profile?.whatsapp_number || null });
}
