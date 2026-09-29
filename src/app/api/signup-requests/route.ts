import { createAdminClient } from "@/lib/supabase/server";
import { isCategoryId, sanitizeCategoryIds } from "@/lib/categories";
import { sendPushAndBellToAdmins } from "@/lib/push/withBell";
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

  // Ambassador attribution (Phase A — capture/attribution only; no
  // commission logic of any kind lives here). Wholly independent of
  // referral_code/users.referred_by: a different body field, a different
  // column, never merged, never read by the legacy affiliate system.
  //
  // This route never decides whether a code is real/active/self-
  // referring, never computes a card price, and never picks which
  // Ambassador/Team Leader/percentage applies — ambassador_attribute_sale()
  // (the approved, already-idempotent database function) is the sole
  // authority for all of that. This route's only two jobs are: (1) find
  // which of the requested addons is actually a Smart Card, so the
  // required card_type/selling_price can be snapshotted from the real
  // `addons` row (never a client-supplied price), and (2) tell the
  // difference between an ordinary declined attribution (proceed
  // normally) and a genuine system failure (protect the Ambassador's
  // sale — see below).
  const rawAmbassadorCode = typeof body.ambassador_code === "string" ? body.ambassador_code.trim().slice(0, 40) : "";
  if (rawAmbassadorCode) {
    const requestedAddonIds: string[] = Array.isArray(body.requested_addon_ids) ? body.requested_addon_ids : [];
    const { data: selectedAddons } = requestedAddonIds.length
      ? await admin
          .from("addons")
          .select("id, name, price_xaf, grants_plan_name, grants_plan_duration_days")
          .in("id", requestedAddonIds)
      : { data: [] as any[] };
    // An addon that grants a plan (grants_plan_name + grants_plan_duration_days)
    // IS a Ringo physical Smart Card in this codebase's own model — see
    // 2026-10-07_card_subscription_bundles.sql. No other addon type sets
    // both fields. V1 only ever attributes an actual Smart Card purchase;
    // a plain free-profile signup with no card in the cart is simply not
    // a qualifying sale, even with a valid-looking Ambassador code.
    const cardAddon = (selectedAddons || []).find((a: any) => a.grants_plan_name && a.grants_plan_duration_days);

    if (cardAddon) {
      const { data: attribution, error: attributionError } = await admin.rpc("ambassador_attribute_sale", {
        p_signup_request_id: data.id,
        p_ambassador_code: rawAmbassadorCode,
        p_signup_email: email,
        p_signup_whatsapp: body.whatsapp_number.trim(),
        p_card_type: cardAddon.name,
        p_selling_price: Number(cardAddon.price_xaf),
        p_payment_reference: null,
      });

      if (attributionError) {
        // A genuine, unexpected database/server failure while a real
        // attribution attempt was in flight — this is NOT the same as an
        // ordinary declined attribution (invalid code, inactive
        // ambassador, self-referral), which the function itself already
        // handles as a normal `{ok:false,...}` result below. Silently
        // letting this signup proceed would permanently lose the
        // Ambassador's sale (there's no later point this can be
        // reconstructed from), so this request is rejected — same as any
        // other required-field failure this route already returns — and
        // the just-created row is rolled back so a retry starts clean.
        console.error("ambassador_attribute_sale failed unexpectedly:", attributionError.message);
        await admin.from("signup_requests").delete().eq("id", data.id);
        return NextResponse.json({ error: "Could not submit — try again." }, { status: 500 });
      }

      // A normal, authoritative decision from the database — valid, or a
      // documented decline (invalid code, inactive ambassador, self-
      // referral) — is never treated as an error; the signup always
      // proceeds either way. signup_requests.ambassador_code is only
      // ever written here, and only once the database has actually
      // confirmed the code as a real, active, non-self-referring
      // Ambassador — never the raw client-submitted value.
      if (attribution?.ok) {
        await admin.from("signup_requests").update({ ambassador_code: rawAmbassadorCode.toUpperCase() }).eq("id", data.id);
      }
    }
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
    await sendPushAndBellToAdmins(admin, {
      category: "signup_request_new",
      title: "New signup request",
      body: `${body.full_name.trim()} submitted a request to join Ringo Connect.`,
      url: `/admin/requests/${data.id}`,
    });
  }

  return NextResponse.json({ ok: true, id: data.id });
}