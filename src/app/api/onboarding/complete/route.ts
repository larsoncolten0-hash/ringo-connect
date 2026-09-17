import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Marks the caller's own account as having seen the first-login onboarding
// tour (see OnboardingTour.tsx and 2026-09-18_onboarding_tour.sql) — called
// once, on Skip or Finish. Idempotent: calling it again just re-stamps the
// same "already seen" state, never un-sets it.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { error } = await supabase
    .from("users")
    .update({ onboarding_completed_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    console.error("onboarding/complete: update failed:", error.message);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
