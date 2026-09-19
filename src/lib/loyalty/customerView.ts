import { createAdminClient } from "@/lib/supabase/server";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";

// What a Ringo CUSTOMER sees in My Ringo -> My Rewards. `customerId` must ALWAYS come from the
// authenticated My Ringo session (requireCustomer()), never from a request. Every query is
// scoped by that id, so a customer only ever reads their own rows, across all the businesses
// they take part in. Nothing here is calculated by the browser: statuses (an expired reward, a
// finished package) are derived on the server from database state, and the page re-reads them on
// every request.

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export interface BusinessRef {
  name: string;
  username: string;
  avatarUrl: string | null;
}

export interface CustomerProgress {
  programId: string;
  programName: string;
  business: BusinessRef;
  type: "visits" | "spend" | "points";
  actionKey: string;
  currency: string | null;
  target: number;
  progress: number; // effective, already clamped where a reward is waiting
  rewardReady: boolean;
  rewardTitle: string;
}

export type RewardStatus = "available" | "redeemed" | "expired" | "voided";

export interface CustomerReward {
  id: string;
  business: BusinessRef;
  title: string;
  status: RewardStatus; // effective status (an unredeemed reward past its expiry reads "expired")
  earnedAt: string;
  expiresAt: string | null;
  redeemedAt: string | null;
}

export interface CustomerPackageCredit {
  id: string;
  actionKey: string;
  total: number;
  used: number;
  remaining: number;
}

export interface CustomerPackage {
  id: string;
  business: BusinessRef;
  name: string;
  startsAt: string;
  endsAt: string;
  status: "active" | "upcoming" | "completed" | "expired" | "cancelled"; // effective
  credits: CustomerPackageCredit[];
}

export interface CustomerHistoryActivity {
  id: string;
  at: string;
  kind: "record" | "reversal";
  actionKey: string;
  quantity: number;
  balanceAfter: number | null;
  business: BusinessRef;
  programName: string | null;
  packageName: string | null;
}

export interface CustomerRewardsData {
  ready: CustomerReward[];
  progress: CustomerProgress[];
  packages: CustomerPackage[]; // active / upcoming only
  history: {
    rewards: CustomerReward[]; // redeemed / expired / voided
    packages: CustomerPackage[]; // completed / expired / cancelled
    activity: CustomerHistoryActivity[];
  };
}

const biz = (p: any): BusinessRef => {
  const b = one<any>(p);
  return { name: b?.name || b?.username || "", username: b?.username || "", avatarUrl: b?.avatar_url ?? null };
};

export async function getCustomerRewards(customerId: string, admin: LoyaltyAdmin = createAdminClient()): Promise<CustomerRewardsData> {
  const now = Date.now();

  const [membershipsRes, rewardsRes, packagesRes, activityRes] = await Promise.all([
    admin
      .from("loyalty_memberships")
      .select("program_id, progress, status, loyalty_programs(name, type, action_key, currency, target, reward_title, active, profiles(name, username, avatar_url))")
      .eq("customer_id", customerId),
    admin
      .from("loyalty_rewards")
      .select("id, program_id, title_snapshot, status, earned_at, expires_at, redeemed_at, loyalty_programs(profiles(name, username, avatar_url))")
      .eq("customer_id", customerId)
      .order("earned_at", { ascending: false })
      .limit(100),
    admin
      .from("loyalty_packages")
      .select("id, name_snapshot, starts_at, ends_at, status, profiles(name, username, avatar_url), loyalty_package_credits(id, action_key, total, used, carried_out)")
      .eq("customer_id", customerId)
      .order("ends_at", { ascending: false })
      .limit(60),
    admin
      .from("loyalty_activities")
      .select("id, created_at, kind, action_key, quantity, balance_after, package_credit_id, loyalty_programs(name), profiles(name, username, avatar_url)")
      .eq("customer_id", customerId)
      .neq("source", "carry_over")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  for (const r of [membershipsRes, rewardsRes, packagesRes, activityRes]) {
    if (r.error) throw new Error(`getCustomerRewards failed: ${r.error.message}`);
  }

  // ---- rewards, with the status the customer should actually see ----
  const rewards: CustomerReward[] = ((rewardsRes.data ?? []) as any[]).map((r) => {
    let status = r.status as RewardStatus;
    if (status === "available" && r.expires_at && new Date(r.expires_at).getTime() <= now) status = "expired";
    return {
      id: r.id,
      business: biz(one<any>(r.loyalty_programs)?.profiles),
      title: r.title_snapshot,
      status,
      earnedAt: r.earned_at,
      expiresAt: r.expires_at ?? null,
      redeemedAt: r.redeemed_at ?? null,
    };
  });
  const liveRewardPrograms = new Set(
    ((rewardsRes.data ?? []) as any[])
      .filter((r) => r.status === "available" && (!r.expires_at || new Date(r.expires_at).getTime() > now))
      .map((r) => r.program_id as string)
  );

  // ---- progress ----
  const progress: CustomerProgress[] = [];
  for (const m of (membershipsRes.data ?? []) as any[]) {
    const p = one<any>(m.loyalty_programs);
    if (!p) continue;
    const rewardReady = liveRewardPrograms.has(m.program_id);
    // A program the business has paused is hidden unless a reward is still waiting on it.
    if (!p.active && !rewardReady) continue;
    // "reward_ready" with no live reward = that reward expired; the next scan closes the cycle
    // and carries only the surplus, so show that rather than a stale full bar.
    const stale = m.status === "reward_ready" && !rewardReady;
    progress.push({
      programId: m.program_id,
      programName: p.name,
      business: biz(p.profiles),
      type: p.type,
      actionKey: p.action_key,
      currency: p.currency ?? null,
      target: p.target,
      progress: stale ? Math.max(m.progress - p.target, 0) : m.progress,
      rewardReady,
      rewardTitle: p.reward_title,
    });
  }
  progress.sort((a, b) => Number(b.rewardReady) - Number(a.rewardReady) || a.business.name.localeCompare(b.business.name));

  // ---- packages ----
  const packages: CustomerPackage[] = ((packagesRes.data ?? []) as any[]).map((p) => {
    let status: CustomerPackage["status"] = p.status;
    if (status === "active") {
      if (new Date(p.ends_at).getTime() <= now) status = "expired";
      else if (new Date(p.starts_at).getTime() > now) status = "upcoming";
    }
    return {
      id: p.id,
      business: biz(p.profiles),
      name: p.name_snapshot,
      startsAt: p.starts_at,
      endsAt: p.ends_at,
      status,
      credits: ((p.loyalty_package_credits ?? []) as any[]).map((c) => ({
        id: c.id,
        actionKey: c.action_key,
        total: c.total,
        used: c.used,
        remaining: c.total - c.used - c.carried_out,
      })),
    };
  });

  // ---- history activity (package rows need the package name) ----
  const activityRows = (activityRes.data ?? []) as any[];
  const creditIds = activityRows.map((a) => a.package_credit_id).filter(Boolean);
  const packageNameByCredit = new Map<string, string>();
  if (creditIds.length > 0) {
    const { data } = await admin
      .from("loyalty_package_credits")
      .select("id, loyalty_packages(name_snapshot)")
      .eq("customer_id", customerId)
      .in("id", creditIds);
    for (const c of (data ?? []) as any[]) packageNameByCredit.set(c.id, one<any>(c.loyalty_packages)?.name_snapshot ?? "");
  }
  const activity: CustomerHistoryActivity[] = activityRows.map((a) => ({
    id: a.id,
    at: a.created_at,
    kind: a.kind,
    actionKey: a.action_key,
    quantity: a.quantity,
    balanceAfter: a.balance_after ?? null,
    business: biz(a.profiles),
    programName: one<any>(a.loyalty_programs)?.name ?? null,
    packageName: a.package_credit_id ? packageNameByCredit.get(a.package_credit_id) ?? null : null,
  }));

  const isLive = (s: CustomerPackage["status"]) => s === "active" || s === "upcoming";
  return {
    ready: rewards.filter((r) => r.status === "available"),
    progress,
    packages: packages.filter((p) => isLive(p.status)),
    history: {
      rewards: rewards.filter((r) => r.status !== "available"),
      packages: packages.filter((p) => !isLive(p.status)),
      activity,
    },
  };
}

/** How many rewards are waiting for this customer right now (for the Home card badge). */
export async function countReadyRewards(customerId: string, admin: LoyaltyAdmin = createAdminClient()): Promise<number> {
  const { count, error } = await admin
    .from("loyalty_rewards")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("status", "available")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
  if (error) {
    console.error("countReadyRewards failed:", error.message);
    return 0;
  }
  return count ?? 0;
}
