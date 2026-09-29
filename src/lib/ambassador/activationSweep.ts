// Ambassador Program (Phase C) — the safety-net sweep for Milestone 2.
//
// Why this exists at all: profile edits in this codebase are direct
// client-side Supabase writes (CatalogCard.tsx, LinksCard.tsx,
// MenuCard.tsx, TracksCard.tsx, ThemeCard.tsx, RestaurantSettingsCard.tsx,
// MusicSettingsCard.tsx, ...) — there is no server route a "profile save"
// hook could attach to (confirmed by direct audit; touching all of those
// components would be exactly the broad, unnecessary blast radius this
// program's safety rules caution against). The PWA-install route
// (src/app/api/pwa/install/route.ts) is the one other real server-side
// signal, but a customer can just as easily finish their profile AFTER
// installing the PWA as before it. This sweep is what catches that case —
// load-bearing, not a rare-edge-case backstop.
//
// Bounded and idempotent by construction: it only ever selects sales
// still sitting at 'milestone_1_earned' (a sale already at
// 'milestone_2_earned' is excluded by the query itself, so re-running
// this sweep can never re-process or duplicate anything), and
// ambassador_evaluate_milestone_2() itself is a no-op whenever
// ambassador_is_activation_ready() is still false. Mirrors the existing
// reconcileProductPayments() sweep's shape (src/lib/productCheckout/reconcile.ts):
// a small lib function the cron route just calls, kept separately
// testable from the auth/HTTP layer.
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyMilestoneEarned } from "@/lib/ambassador/notifications";

export const AMBASSADOR_SWEEP_DEFAULT_LIMIT = 200;

export interface AmbassadorSweepSummary {
  checked: number;
  earned: number;
}

export async function sweepAmbassadorActivation(
  admin: SupabaseClient,
  { limit = AMBASSADOR_SWEEP_DEFAULT_LIMIT, now = new Date() }: { limit?: number; now?: Date } = {}
): Promise<AmbassadorSweepSummary> {
  // Phase I — fairness. A sale whose customer never finishes setup stays at
  // 'milestone_1_earned' forever, so with an unordered LIMIT the same first
  // `limit` rows could be re-checked every day while later sales starved.
  // When more than `limit` are pending, each run takes ONE stable-ordered
  // window, rotating by day, so every pending sale is re-evaluated within
  // ceil(pending / limit) days. Still strictly bounded per run; when
  // everything fits in one window this is identical to the old behaviour.
  const { count } = await admin.from("ambassador_sales").select("id", { count: "exact", head: true }).eq("status", "milestone_1_earned");
  let query = admin.from("ambassador_sales").select("id").eq("status", "milestone_1_earned").order("id", { ascending: true });
  if (typeof count === "number" && count > limit) {
    const windows = Math.ceil(count / limit);
    const start = (Math.floor(now.getTime() / 86_400_000) % windows) * limit;
    query = query.range(start, start + limit - 1);
  } else {
    query = query.limit(limit);
  }
  const { data: pending } = await query;

  const rows = pending || [];
  let earned = 0;

  for (const row of rows) {
    const { data, error } = await admin.rpc("ambassador_evaluate_milestone_2", { p_sale_id: row.id });
    if (error) {
      console.error("ambassador_evaluate_milestone_2 failed during sweep:", row.id, error.message);
      continue;
    }
    if (data?.ok) {
      earned++;
      // Phase G — ok:true only on the real transition, so a re-run of the
      // sweep (or a PWA-install evaluation that got there first) never
      // re-notifies; notifyMilestoneEarned also dedupes per recipient.
      await notifyMilestoneEarned(admin, row.id, "activation");
    }
  }

  return { checked: rows.length, earned };
}
