import { createAdminClient } from "@/lib/supabase/server";
import type { ActivityItem } from "@/lib/customer/activity";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";

// Loyalty events for the EXISTING My Ringo Activity feed (src/lib/customer/activity.ts). Like the
// rest of that feed they are not copied into an activity table: they are read straight from the
// authoritative loyalty records that belong to this customer, so the feed can never drift from
// them or show something that did not happen.
//
//   progress recorded / corrected  <- loyalty_activities (program rows)
//   package credit used / corrected <- loyalty_activities (package rows)
//   reward unlocked / redeemed      <- loyalty_rewards (earned_at / redeemed_at)
//   package activated               <- loyalty_packages (activated_at)
//
// `customerId` must come from the authenticated My Ringo session. Staff-only details (who
// recorded it, the reversal reason, payment references) are never selected. Rows stay visible
// after the customer disconnects from a business: disconnecting must not erase history.

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

const profileOf = (p: any) => {
  const b = one<any>(p);
  return b?.username ? { name: b.name || b.username, username: b.username } : null;
};

export async function listLoyaltyFeed(customerId: string, limit = 100, admin: LoyaltyAdmin = createAdminClient()): Promise<ActivityItem[]> {
  const [activitiesRes, rewardsRes, packagesRes] = await Promise.all([
    admin
      .from("loyalty_activities")
      .select("id, created_at, kind, action_key, quantity, balance_after, package_credit_id, loyalty_programs(type, target, currency), profiles(name, username)")
      .eq("customer_id", customerId)
      .neq("source", "carry_over")
      .order("created_at", { ascending: false })
      .limit(limit),
    admin
      .from("loyalty_rewards")
      .select("id, title_snapshot, earned_at, redeemed_at, status, loyalty_programs(profiles(name, username))")
      .eq("customer_id", customerId)
      .order("earned_at", { ascending: false })
      .limit(limit),
    admin
      .from("loyalty_packages")
      .select("id, name_snapshot, activated_at, ends_at, profiles(name, username)")
      .eq("customer_id", customerId)
      .order("activated_at", { ascending: false })
      .limit(limit),
  ]);
  for (const r of [activitiesRes, rewardsRes, packagesRes]) {
    if (r.error) throw new Error(`listLoyaltyFeed failed: ${r.error.message}`);
  }

  const activityRows = (activitiesRes.data ?? []) as any[];
  const creditIds = activityRows.map((a) => a.package_credit_id).filter(Boolean);
  const packageByCredit = new Map<string, string>();
  if (creditIds.length > 0) {
    const { data } = await admin
      .from("loyalty_package_credits")
      .select("id, loyalty_packages(name_snapshot)")
      .eq("customer_id", customerId)
      .in("id", creditIds);
    for (const c of (data ?? []) as any[]) packageByCredit.set(c.id, one<any>(c.loyalty_packages)?.name_snapshot ?? "");
  }

  const items: ActivityItem[] = [];

  for (const a of activityRows) {
    const profile = profileOf(a.profiles);
    if (a.package_credit_id) {
      items.push({
        id: `loy-act-${a.id}`,
        kind: a.kind === "reversal" ? "loyalty_correction" : "package_used",
        at: a.created_at,
        profile,
        loyalty: { actionKey: a.action_key, remaining: a.balance_after ?? null, packageName: packageByCredit.get(a.package_credit_id) ?? "" },
      });
      continue;
    }
    const p = one<any>(a.loyalty_programs);
    items.push({
      id: `loy-act-${a.id}`,
      kind: a.kind === "reversal" ? "loyalty_correction" : "loyalty_progress",
      at: a.created_at,
      profile,
      loyalty: {
        type: p?.type ?? "visits",
        actionKey: a.action_key,
        progress: a.balance_after ?? null,
        target: p?.target ?? null,
        currency: p?.currency ?? null,
      },
    });
  }

  for (const r of (rewardsRes.data ?? []) as any[]) {
    const profile = profileOf(one<any>(r.loyalty_programs)?.profiles);
    items.push({ id: `loy-rew-${r.id}`, kind: "reward_unlocked", at: r.earned_at, profile, loyalty: { rewardTitle: r.title_snapshot } });
    if (r.redeemed_at) {
      items.push({ id: `loy-red-${r.id}`, kind: "reward_redeemed", at: r.redeemed_at, profile, loyalty: { rewardTitle: r.title_snapshot } });
    }
  }

  for (const p of (packagesRes.data ?? []) as any[]) {
    items.push({
      id: `loy-pkg-${p.id}`,
      kind: "package_activated",
      at: p.activated_at,
      profile: profileOf(p.profiles),
      loyalty: { packageName: p.name_snapshot, endsAt: p.ends_at },
    });
  }

  return items;
}
