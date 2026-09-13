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

  const email = typeof body.email === "string" ? body.email.trim() || null : null;
  // 40 chars, not shorter — see the matching comment in src/lib/referral.ts.
  const referralCode =
    typeof body.referral_code === "string" ? body.referral_code.trim().toUpperCase().slice(0, 40) || null : null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("signup_requests")
    .insert({
      full_name: body.full_name.trim(),
      whatsapp_number: body.whatsapp_number.trim(),
      email,
      suggested_username: body.suggested_username || null,
      avatar_url: body.avatar_url || null,
      business_note: body.business_note || null,
      category: isCategoryId(body.category) ? body.category : null,
      categories: sanitizeCategoryIds(body.categories),
      referral_code: referralCode,
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

  // GetStartedFlow.tsx calls this route two ways: a real "pay later"
  // submission (createRequest() with no argument — nothing left to wait
  // on, so admins should hear about it immediately, same as always), and
  // as the first step of an online-payment attempt (sendPayment() calling
  // createRequest(true) right before talking to Fapshi — see that
  // component's own comment). Only the first case should notify anyone
  // yet: a row created to start a payment isn't an actionable request
  // until that payment actually succeeds, which
  // /api/signup-requests/[id]/pay-status already notifies admins about
  // on its own the moment Fapshi confirms it. Notifying here too would
  // mean an admin hears about (and can see, still-unpaid) every payment
  // attempt the instant someone starts one — including ones that are
  // abandoned or fail — not just the ones that actually go through.
  if (!body.pending_online_payment) {
    await sendPushToAdmins(admin, {
      category: "signup_request_new",
      title: "New signup request",
      body: `${body.full_name.trim()} submitted a request to join Ringo Connect.`,
      url: "/admin/requests",
    });
  }

  return NextResponse.json({ ok: true, id: data.id });
}