import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/send";
import { NextResponse } from "next/server";

// Public, unauthenticated by design — a visitor joining a community has no
// Ringo account (same reasoning as /api/bookings and /api/orders). There
// is no anon RLS policy on community_subscribers/
// community_subscription_preferences at all — this route (service-role
// admin client) is the only way in.
const MAX_SUBSCRIPTIONS_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const admin = createAdminClient();

  // Honeypot — a field named to look legitimate to a bot but hidden from
  // real visitors by CommunityJoinPage's own CSS. A filled value never
  // reaches the database; the caller gets an identical-looking success
  // response so a bot has no signal to adapt against. Same pattern as
  // /api/bookings.
  if (typeof body?.website === "string" && body.website.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const profileId = body?.profile_id;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 200) : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim().slice(0, 40) : "";
  // The ONLY source of channel consent — never inferred from whether email/
  // phone were merely filled in (see the migration's header note).
  const consentEmail = body?.consent_email === true;
  const consentWhatsapp = body?.consent_whatsapp === true;
  const source =
    typeof body?.source === "string" &&
    ["ringo_profile", "qr_code", "nfc", "product", "music", "event", "restaurant", "other"].includes(body.source)
      ? body.source
      : "ringo_profile";

  if (!profileId) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  if (!consentEmail && !consentWhatsapp) {
    return NextResponse.json({ error: "Pick at least one way to hear from you." }, { status: 400 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, user_id, community_enabled")
    .eq("id", profileId)
    .eq("published", true)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  if (profile.community_enabled !== true) {
    return NextResponse.json({ error: "This profile isn't accepting new subscribers right now." }, { status: 400 });
  }

  // Simple, table-only rate limit — same shape as /api/bookings.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await admin
    .from("community_subscribers")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", profileId)
    .eq("email", email)
    .gte("created_at", oneHourAgo);
  if ((recentCount || 0) >= MAX_SUBSCRIPTIONS_PER_HOUR) {
    return NextResponse.json({ error: "Too many attempts — please try again later." }, { status: 429 });
  }

  // Upsert by (profile_id, lower(email)) — re-subscribing after having
  // unsubscribed reactivates the same row instead of creating a duplicate.
  const { data: existing } = await admin
    .from("community_subscribers")
    .select("id")
    .eq("profile_id", profileId)
    .ilike("email", email)
    .maybeSingle();

  let subscriberId: string;

  if (existing) {
    subscriberId = existing.id;
    await admin
      .from("community_subscribers")
      .update({ name, phone: phone || null, status: "active", updated_at: new Date().toISOString() })
      .eq("id", subscriberId);
  } else {
    const { data: created, error: insertError } = await admin
      .from("community_subscribers")
      .insert({ profile_id: profileId, name, email, phone: phone || null, source })
      .select("id")
      .single();
    if (insertError || !created) {
      console.error("community subscribe insert failed:", insertError?.message);
      return NextResponse.json({ error: "Could not complete your subscription — try again." }, { status: 500 });
    }
    subscriberId = created.id;
  }

  // Net-new notification path — unlike bookings/orders, there's no
  // existing email receipt here to mirror; a new subscriber is still
  // exactly the kind of "someone did a thing on my page" event the
  // creator dashboard's push notifications are for.
  await sendPushToUser(admin, profile.user_id, {
    category: "community_subscriber_new",
    title: "New community subscriber",
    body: `${name} just joined your community.`,
    url: "/dashboard/community",
  });

  await admin.from("community_subscription_preferences").upsert(
    {
      subscriber_id: subscriberId,
      email_updates: consentEmail,
      whatsapp_updates: consentWhatsapp,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "subscriber_id" }
  );

  const { data: subscriber } = await admin
    .from("community_subscribers")
    .select("unsubscribe_token")
    .eq("id", subscriberId)
    .single();

  return NextResponse.json({ id: subscriberId, unsubscribe_token: subscriber?.unsubscribe_token });
}
