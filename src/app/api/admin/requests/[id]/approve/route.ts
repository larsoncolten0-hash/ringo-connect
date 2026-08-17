import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { fapshiGetStatus } from "@/lib/fapshi";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { username, email, password, fullName, whatsappNumber, note, avatarUrl, planId, billingInterval, paymentMethod } = body;

  if (!username || !email || !password || !fullName || !whatsappNumber || !planId) {
    return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (!["charge", "manual", "none"].includes(paymentMethod)) {
    return NextResponse.json({ error: "Invalid payment method." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  const { data: signupRequest } = await adminClient
    .from("signup_requests")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!signupRequest || signupRequest.status !== "pending") {
    return NextResponse.json({ error: "Request not found or already processed." }, { status: 404 });
  }

  // Defense in depth — the UI already checks this, but re-verify
  // server-side before creating anything.
  const { data: existingProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("username", username.toLowerCase())
    .maybeSingle();
  if (existingProfile) {
    return NextResponse.json({ error: "That username is already taken." }, { status: 409 });
  }

  const { data: plan } = await adminClient.from("plans").select("*").eq("id", planId).single();
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });

  // If a charge was made during review, re-verify it one final time
  // against Fapshi directly before trusting it enough to grant a paid
  // plan — never trust a client-reported "it succeeded" alone.
  if (paymentMethod === "charge") {
    if (!signupRequest.pending_fapshi_trans_id) {
      return NextResponse.json({ error: "No charge was started for this request." }, { status: 400 });
    }
    try {
      const tx = await fapshiGetStatus(signupRequest.pending_fapshi_trans_id);
      if (tx.status !== "SUCCESSFUL") {
        return NextResponse.json({ error: `Payment is not confirmed yet (status: ${tx.status}).` }, { status: 400 });
      }
    } catch (err: any) {
      return NextResponse.json({ error: "Could not verify the payment. Try again." }, { status: 502 });
    }
  }

  // Create the actual account — email_confirm: true is what skips email
  // verification entirely, which is only possible via this Admin API,
  // never through the normal client-side signUp() flow.
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username: username.toLowerCase() },
  });

  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message || "Could not create the account." }, { status: 500 });
  }

  const newUserId = created.user.id;

  // The signup trigger already created users + profiles rows (free plan,
  // username from metadata) — now fill in the rest from what was
  // submitted, and grant the actual chosen plan.
  await adminClient
    .from("profiles")
    .update({
      name: fullName,
      avatar_url: avatarUrl || null,
      whatsapp_number: whatsappNumber,
      about_long_bio: note || null,
    })
    .eq("user_id", newUserId);

  const { data: newProfile } = await adminClient
    .from("profiles")
    .select("id")
    .eq("user_id", newUserId)
    .single();

  // Turn the staged JSONB content from the public form into real rows —
  // this only happens now, at approval, never earlier.
  if (newProfile) {
    const links = Array.isArray(signupRequest.requested_links) ? signupRequest.requested_links : [];
    if (links.length > 0) {
      await adminClient.from("links").insert(
        links.map((l: any, i: number) => ({
          profile_id: newProfile.id,
          title: l.title,
          url: l.url,
          sort_order: i,
        }))
      );
    }

    const products = Array.isArray(signupRequest.requested_products) ? signupRequest.requested_products : [];
    if (products.length > 0) {
      await adminClient.from("products").insert(
        products.map((p: any, i: number) => ({
          profile_id: newProfile.id,
          name: p.name,
          price: p.price ?? null,
          image_url: p.image_url || null,
          sort_order: i,
        }))
      );
    }

    const socialLinks = Array.isArray(signupRequest.requested_social_links)
      ? signupRequest.requested_social_links
      : [];
    if (socialLinks.length > 0) {
      await adminClient.from("social_links").insert(
        socialLinks.map((s: any, i: number) => ({
          profile_id: newProfile.id,
          platform: s.platform,
          url: s.url,
          sort_order: i,
        }))
      );
    }
  }

  const interval: "monthly" | "yearly" = billingInterval === "yearly" ? "yearly" : "monthly";
  const isPaidPlan = Number(plan.price_usd) > 0;

  const userUpdates: Record<string, any> = { plan_id: plan.id, billing_interval: interval };

  if (paymentMethod === "charge" && isPaidPlan) {
    userUpdates.payment_provider = "fapshi";
    const expires = new Date();
    expires.setDate(expires.getDate() + (interval === "yearly" ? 365 : 30));
    userUpdates.plan_expires_at = expires.toISOString();
  } else if (paymentMethod === "manual" && isPaidPlan) {
    userUpdates.payment_provider = "manual";
    const expires = new Date();
    expires.setDate(expires.getDate() + (interval === "yearly" ? 365 : 30));
    userUpdates.plan_expires_at = expires.toISOString();
  } else {
    userUpdates.payment_provider = null;
    userUpdates.plan_expires_at = null;
  }

  await adminClient.from("users").update(userUpdates).eq("id", newUserId);

  // Add-ons apply regardless of whether the plan itself is paid — a
  // required add-on (e.g. the physical card) on an otherwise-free plan
  // still needs to be charged/recorded, so this can't gate on isPaidPlan
  // alone.
  const addonIds: string[] = signupRequest.requested_addon_ids || [];
  let addonsXaf = 0;
  let addonsUsd = 0;
  if (addonIds.length > 0) {
    const { data: selectedAddons } = await adminClient
      .from("addons")
      .select("name, price_xaf, price_usd")
      .in("id", addonIds);
    for (const a of selectedAddons || []) {
      addonsXaf += Number(a.price_xaf);
      addonsUsd += Number(a.price_usd);
    }
  }

  if (paymentMethod === "charge") {
    const amount = (interval === "yearly" ? Number(plan.price_xaf_yearly) : Number(plan.price_xaf)) + addonsXaf;
    if (amount > 0) {
      await adminClient.from("payment_transactions").insert({
        user_id: newUserId,
        provider: "fapshi",
        provider_transaction_id: signupRequest.pending_fapshi_trans_id,
        plan_name: plan.name,
        billing_interval: interval,
        amount,
        currency: "XAF",
        status: "success",
      });
    }
  } else if (paymentMethod === "manual") {
    const amount = (interval === "yearly" ? Number(plan.price_usd_yearly) : Number(plan.price_usd)) + addonsUsd;
    if (amount > 0) {
      await adminClient.from("payment_transactions").insert({
        user_id: newUserId,
        provider: "manual",
        provider_transaction_id: `manual-${signupRequest.id}`,
        plan_name: plan.name,
        billing_interval: interval,
        amount,
        currency: "USD",
        status: "success",
      });
    }
  }

  await adminClient
    .from("signup_requests")
    .update({
      status: "approved",
      created_user_id: newUserId,
      reviewed_by: admin.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "approve_signup_request",
    target_user_id: newUserId,
    details: { requestId: signupRequest.id, planName: plan.name, paymentMethod },
  });

  return NextResponse.json({ ok: true, userId: newUserId, username: username.toLowerCase() });
}