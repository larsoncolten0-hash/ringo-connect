import { createAdminClient } from "@/lib/supabase/server";
import { isCategoryId, sanitizeCategoryIds } from "@/lib/categories";
import { sendPushToAdmins } from "@/lib/push/send";
import { NextResponse } from "next/server";

// Public, unauthenticated by design — this is the whole point of the
// assisted-onboarding form. There's no session to scope a regular client
// to, and RLS on signup_requests permits INSERT only (no read/update/
// delete for anon), which would make an anon client's INSERT...RETURNING
// come back empty. The admin client is used solely to insert this one
// row and hand back its id — nothing here reads or exposes other rows.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (!body?.full_name?.trim() || !body?.whatsapp_number?.trim()) {
    return NextResponse.json({ error: "Name and WhatsApp number are required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("signup_requests")
    .insert({
      full_name: body.full_name.trim(),
      whatsapp_number: body.whatsapp_number.trim(),
      email: body.email || null,
      suggested_username: body.suggested_username || null,
      avatar_url: body.avatar_url || null,
      business_note: body.business_note || null,
      category: isCategoryId(body.category) ? body.category : null,
      categories: sanitizeCategoryIds(body.categories),
      // 40 chars, not shorter — see the matching comment in src/lib/referral.ts.
      referral_code: typeof body.referral_code === "string" ? body.referral_code.trim().toUpperCase().slice(0, 40) || null : null,
      delivery_location: body.delivery_location || null,
      requested_plan_id: body.requested_plan_id || null,
      requested_interval: body.requested_interval === "yearly" ? "yearly" : "monthly",
      requested_links: Array.isArray(body.requested_links) ? body.requested_links : [],
      requested_products: Array.isArray(body.requested_products) ? body.requested_products : [],
      requested_social_links: Array.isArray(body.requested_social_links) ? body.requested_social_links : [],
      requested_addon_ids: Array.isArray(body.requested_addon_ids) ? body.requested_addon_ids : [],
      // "affiliate" = submitted through /get-started-affiliate, where
      // online payment is mandatory — see the matching check in
      // /api/signup-requests/[id]/pay. Anything else falls back to the
      // regular public-form default.
      source: body.source === "affiliate" ? "affiliate" : "get_started",
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("signup_requests insert failed:", error?.message);
    // Surface the real reason (not just a generic message) so the client
    // can show what actually went wrong instead of a dead end.
    return NextResponse.json(
      { error: error?.message ? `Could not submit — ${error.message}` : "Could not submit — try again." },
      { status: 500 }
    );
  }

  await sendPushToAdmins(admin, {
    category: "signup_request_new",
    title: "New signup request",
    body: `${body.full_name.trim()} submitted a request to join Ringo Connect.`,
    url: "/admin/requests",
  });

  return NextResponse.json({ ok: true, id: data.id });
}