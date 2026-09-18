import { createClient, createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Marks the caller's own account as having seen the first-login onboarding
// tour (see OnboardingTour.tsx and 2026-09-18_onboarding_tour.sql /
// 2026-09-18b_onboarding_tour_dismissed.sql) — called once, on Skip
// ("dismissed") or the final "Get started" ("completed"). Idempotent:
// calling it again just re-stamps the same column, never un-sets the other.
//
// Uses the ADMIN client for the actual write, not the request-scoped
// (RLS) one — matching every other write to the `users` table in this
// codebase (applyPayment.ts, cardBundle.ts, …), none of which rely on
// users' own "update own row" RLS policy for a self-service mutation. The
// request-scoped client is still what authenticates the caller
// (supabase.auth.getUser(), cookie-based) — user.id is never trusted from
// the request body.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const outcome: "completed" | "dismissed" = body?.outcome === "dismissed" ? "dismissed" : "completed";
  const column = outcome === "dismissed" ? "onboarding_dismissed_at" : "onboarding_completed_at";

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("users")
    .update({ [column]: new Date().toISOString() })
    .eq("id", user.id)
    .select("id");

  // Checked explicitly, not just the `error` field — a write that matches
  // zero rows (wrong id, RLS-style silent no-op, anything else) comes back
  // with no `error` at all from supabase-js, and this route's whole reason
  // for existing is to make that failure mode impossible to miss again.
  if (error || !updated || updated.length === 0) {
    console.error(`onboarding/complete: ${outcome} update failed for user ${user.id}:`, error?.message || "matched 0 rows");
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, outcome });
}
