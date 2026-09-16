import { randomUUID } from "crypto";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { extractClientIp } from "@/lib/pixelTracking";
import { isCategoryId, type CategoryId } from "@/lib/categories";
import { translations } from "@/lib/i18n/translations";
import { NextResponse } from "next/server";

// "Try the dashboard" — creates a fresh, throwaway, isolated Business Pro
// account with zero signup friction (see src/app/demo/page.tsx). Every
// visitor gets their OWN account: a real Supabase anonymous auth user (see
// migration-time coalesce() fix on handle_new_auth_user for why that
// trigger needed a small change to accept a null email), flagged
// is_demo = true and set to auto-expire in 7 days (cleaned up by
// /api/cron/cleanup-demo-accounts).
//
// Uses the cookie-bound server client (not the admin client) for
// signInAnonymously() specifically, since that's what actually sets the
// session cookies on this response — the admin client has no session to
// attach. Every write AFTER the account exists uses the admin client
// instead, deliberately not the fresh anonymous session's own RLS-scoped
// access, so this route (not client-side RLS) is the one place that
// decides what a demo account starts with.
const DEMO_PLAN_NAME = "business_pro";
const DEMO_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const category: CategoryId | null = isCategoryId(body?.category) ? body.category : null;
  const locale = body?.locale === "fr" ? "fr" : "en";

  if (!category) {
    return NextResponse.json({ code: "invalid_category", error: "A category is required." }, { status: 400 });
  }

  const ip = extractClientIp(request.headers) || "unknown";
  const admin = createAdminClient();

  // Rate limit: a simple per-IP cap, checked BEFORE creating anything —
  // see the migration's own comment for why this exists as its own small
  // table rather than a general-purpose rate limiter.
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error: countError } = await admin
    .from("demo_signup_attempts")
    .select("id", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("created_at", since);

  if (countError) {
    console.error("demo/create: rate limit check failed:", countError.message);
    return NextResponse.json({ code: "generic_error", error: "Could not start your demo." }, { status: 500 });
  }
  if ((count ?? 0) >= RATE_LIMIT_MAX) {
    return NextResponse.json({ code: "rate_limited", error: "Too many demo accounts from this IP." }, { status: 429 });
  }

  // A short, obviously-non-real username — never colliding in practice
  // (36^10 possibilities), and not worth a retry loop for a throwaway
  // account nobody will ever try to type by hand.
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const username = `test-user-${suffix}`;

  const supabase = createClient();
  const { data: signInData, error: signInError } = await supabase.auth.signInAnonymously({
    options: { data: { username } },
  });

  if (signInError || !signInData.user) {
    console.error("demo/create: anonymous sign-in failed:", signInError?.message);
    return NextResponse.json({ code: "generic_error", error: "Could not start your demo." }, { status: 500 });
  }

  const userId = signInData.user.id;

  const { data: plan } = await admin.from("plans").select("id").eq("name", DEMO_PLAN_NAME).single();
  if (!plan) {
    console.error("demo/create: business_pro plan not found");
    // The auth user + trigger-created rows already exist at this point —
    // clean up rather than leave an orphaned, mis-configured account
    // behind.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json({ code: "generic_error", error: "Could not start your demo." }, { status: 500 });
  }

  const demoExpiresAt = new Date(Date.now() + DEMO_DURATION_MS).toISOString();
  const displayName = translations[locale].demo.testUserName;

  const [{ error: usersUpdateError }, { error: profileUpdateError }] = await Promise.all([
    admin.from("users").update({ plan_id: plan.id }).eq("id", userId),
    admin
      .from("profiles")
      .update({ category, is_demo: true, demo_expires_at: demoExpiresAt, name: displayName })
      .eq("user_id", userId),
  ]);

  if (usersUpdateError || profileUpdateError) {
    console.error("demo/create: profile setup failed:", usersUpdateError?.message, profileUpdateError?.message);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    return NextResponse.json({ code: "generic_error", error: "Could not start your demo." }, { status: 500 });
  }

  // Recorded only after everything above succeeded — the cap counts real
  // demo accounts created, not failed attempts.
  await admin.from("demo_signup_attempts").insert({ ip });

  return NextResponse.json({ ok: true });
}
