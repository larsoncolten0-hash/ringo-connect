import { createClient, createAdminClient } from "@/lib/supabase/server";
import { notifyMilestoneEarned } from "@/lib/ambassador/notifications";
import { NextResponse } from "next/server";

// Fired once by ActivitySignals.tsx when the browser's `appinstalled` event
// fires. This event does NOT fire on iOS Safari — Apple has never
// implemented it — so pwa_installed_at structurally undercounts iOS users
// who added the app to their home screen via the share-sheet flow instead.
// The admin Users analytics view surfaces that caveat rather than
// presenting this count as complete; see AdminUsersAnalytics.tsx.
//
// Only ever sets the column the first time (.is("pwa_installed_at", null))
// — a later reinstall doesn't need to move the recorded date.
export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ pwa_installed_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("pwa_installed_at", null);

  if (error) {
    console.error("pwa install ping failed:", error.message);
    return NextResponse.json({ error: "Could not record install." }, { status: 500 });
  }

  // Ambassador Program (Phase C) — re-evaluate Milestone 2 for this exact
  // user if (and only if) they have an in-flight, already-registered
  // Ambassador sale. `user.id` is the server-derived session identity
  // from getUser() above — never anything the client could supply. The
  // existence check keeps this a no-op for the overwhelming majority of
  // installs that have nothing to do with the Ambassador program, and
  // ambassador_is_activation_ready()/ambassador_evaluate_milestone_2()
  // remain the sole authority on whether activation is actually
  // complete — this route never re-implements any of that logic, and
  // never fails the PWA install response if the Ambassador check fails.
  try {
    const { data: sale } = await admin
      .from("ambassador_sales")
      .select("id")
      .eq("customer_user_id", user.id)
      .eq("status", "milestone_1_earned")
      .maybeSingle();
    if (sale?.id) {
      const { data: milestoneResult, error: milestoneError } = await admin.rpc("ambassador_evaluate_milestone_2", { p_sale_id: sale.id });
      if (milestoneError) console.error("ambassador_evaluate_milestone_2 failed:", milestoneError.message);
      // Phase G — ok:true only on the real milestone_1 -> milestone_2 transition.
      else if (milestoneResult?.ok) await notifyMilestoneEarned(admin, sale.id, "activation");
    }
  } catch (err: any) {
    console.error("ambassador milestone 2 evaluation threw unexpectedly:", err?.message);
  }

  return NextResponse.json({ ok: true });
}
