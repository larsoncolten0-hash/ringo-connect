import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Public, unauthenticated by design — this is the whole point of the
// assisted-onboarding form. RLS on signup_requests only permits INSERT
// for anyone, no read/update/delete, so this can't be used to see or
// tamper with other people's submissions even without auth here.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.full_name?.trim() || !body?.whatsapp_number?.trim()) {
    return NextResponse.json({ error: "Name and WhatsApp number are required." }, { status: 400 });
  }

  const supabase = createClient();
  const { error } = await supabase.from("signup_requests").insert({
    full_name: body.full_name.trim(),
    whatsapp_number: body.whatsapp_number.trim(),
    email: body.email || null,
    suggested_username: body.suggested_username || null,
    avatar_url: body.avatar_url || null,
    business_note: body.business_note || null,
    requested_plan_id: body.requested_plan_id || null,
    requested_interval: body.requested_interval === "yearly" ? "yearly" : "monthly",
    requested_links: Array.isArray(body.requested_links) ? body.requested_links : [],
    requested_products: Array.isArray(body.requested_products) ? body.requested_products : [],
    requested_social_links: Array.isArray(body.requested_social_links) ? body.requested_social_links : [],
    requested_addon_ids: Array.isArray(body.requested_addon_ids) ? body.requested_addon_ids : [],
  });

  if (error) {
    console.error("signup_requests insert failed:", error.message);
    return NextResponse.json({ error: "Could not submit — try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}