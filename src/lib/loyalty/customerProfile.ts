import { createAdminClient } from "@/lib/supabase/server";
import type { ConnectedCustomer } from "@/lib/loyalty/customers";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";

// The "Customer Loyalty Profile" shown to staff after a scan or search: only what is
// needed to serve the customer at the counter. Name, when they connected, their progress in
// THIS business's programs, rewards ready, active packages and a few recent entries. No
// email, no phone, no customer id, nothing from any other business.
//
// Everything is scoped by BOTH profile_id and customer_id; `conn` must come from
// getActiveConnection()/resolveScan() (i.e. an active connection to the caller's profile).

export interface ProfileProgram {
  programId: string;
  name: string;
  type: "visits" | "spend" | "points";
  actionKey: string;
  currency: string | null;
  target: number;
  unitAmount: number | null;
  pointsPerUnit: number | null;
  rewardTitle: string;
  progress: number;
  cycle: number;
  status: "active" | "reward_ready";
}

export interface ProfileReward {
  id: string;
  programId: string;
  title: string;
  earnedAt: string;
  expiresAt: string | null;
}

export interface ProfilePackageCredit {
  id: string;
  actionKey: string;
  total: number;
  used: number;
  remaining: number;
  carriedIn: number;
}

export interface ProfilePackage {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  status: string;
  credits: ProfilePackageCredit[];
}

export interface ProfileActivity {
  id: string;
  kind: "record" | "reversal";
  actionKey: string;
  quantity: number;
  balanceAfter: number | null;
  createdAt: string;
  programName: string | null;
  isPackage: boolean;
  carryOver: boolean;
  reversed: boolean;
}

export interface CustomerLoyaltyProfile {
  connection: { connectionId: string; name: string; connectedAt: string };
  programs: ProfileProgram[];
  rewards: ProfileReward[];
  packages: ProfilePackage[];
  recent: ProfileActivity[];
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export async function buildCustomerLoyaltyProfile(
  profileId: string,
  conn: ConnectedCustomer,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<CustomerLoyaltyProfile> {
  const nowIso = new Date().toISOString();
  const now = Date.now();

  const [programsRes, membershipsRes, rewardsRes, packagesRes, recentRes] = await Promise.all([
    admin
      .from("loyalty_programs")
      .select("id, name, type, action_key, currency, target, unit_amount, points_per_unit, reward_title, starts_at, ends_at")
      .eq("profile_id", profileId)
      .eq("active", true)
      .order("created_at", { ascending: true }),
    admin.from("loyalty_memberships").select("program_id, progress, cycle, status").eq("profile_id", profileId).eq("customer_id", conn.customerId),
    admin
      .from("loyalty_rewards")
      .select("id, program_id, title_snapshot, earned_at, expires_at")
      .eq("profile_id", profileId)
      .eq("customer_id", conn.customerId)
      .eq("status", "available")
      .order("earned_at", { ascending: false }),
    admin
      .from("loyalty_packages")
      .select("id, name_snapshot, starts_at, ends_at, status, loyalty_package_credits(id, action_key, total, used, carried_in, carried_out)")
      .eq("profile_id", profileId)
      .eq("customer_id", conn.customerId)
      .eq("status", "active")
      .gt("ends_at", nowIso)
      .order("ends_at", { ascending: true }),
    admin
      .from("loyalty_activities")
      .select("id, kind, source, action_key, quantity, balance_after, created_at, loyalty_programs(name)")
      .eq("profile_id", profileId)
      .eq("customer_id", conn.customerId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);
  for (const r of [programsRes, membershipsRes, rewardsRes, packagesRes, recentRes]) {
    if (r.error) throw new Error(`buildCustomerLoyaltyProfile failed: ${r.error.message}`);
  }

  const memberships = new Map<string, any>(((membershipsRes.data ?? []) as any[]).map((m) => [m.program_id, m]));

  // Rewards that are genuinely usable right now. A reward past its expiry still says
  // "available" in the table until something touches it, so it is filtered here.
  const rewards: ProfileReward[] = ((rewardsRes.data ?? []) as any[])
    .filter((r) => !r.expires_at || new Date(r.expires_at).getTime() > now)
    .map((r) => ({ id: r.id, programId: r.program_id, title: r.title_snapshot, earnedAt: r.earned_at, expiresAt: r.expires_at ?? null }));
  const rewardProgramIds = new Set(rewards.map((r) => r.programId));

  const programs: ProfileProgram[] = ((programsRes.data ?? []) as any[])
    .filter((p) => (!p.starts_at || new Date(p.starts_at).getTime() <= now) && (!p.ends_at || new Date(p.ends_at).getTime() > now))
    .map((p) => {
      const m = memberships.get(p.id);
      const hasLiveReward = rewardProgramIds.has(p.id);
      // membership says reward_ready but the reward has expired: the next record closes that
      // cycle and carries only the surplus, so show that instead of a stale full bar.
      const stale = m?.status === "reward_ready" && !hasLiveReward;
      return {
        programId: p.id,
        name: p.name,
        type: p.type,
        actionKey: p.action_key,
        currency: p.currency ?? null,
        target: p.target,
        unitAmount: p.unit_amount ?? null,
        pointsPerUnit: p.points_per_unit ?? null,
        rewardTitle: p.reward_title,
        progress: m ? (stale ? Math.max(m.progress - p.target, 0) : m.progress) : 0,
        cycle: m?.cycle ?? 1,
        status: hasLiveReward ? "reward_ready" : "active",
      };
    });

  const packages: ProfilePackage[] = ((packagesRes.data ?? []) as any[]).map((p) => ({
    id: p.id,
    name: p.name_snapshot,
    startsAt: p.starts_at,
    endsAt: p.ends_at,
    status: p.status,
    credits: ((p.loyalty_package_credits ?? []) as any[]).map((c) => ({
      id: c.id,
      actionKey: c.action_key,
      total: c.total,
      used: c.used,
      remaining: c.total - c.used - c.carried_out,
      carriedIn: c.carried_in,
    })),
  }));

  const recentRows = (recentRes.data ?? []) as any[];
  let reversedIds = new Set<string>();
  if (recentRows.length > 0) {
    const { data: revs } = await admin
      .from("loyalty_activities")
      .select("reverses_activity_id")
      .eq("profile_id", profileId)
      .in("reverses_activity_id", recentRows.map((r) => r.id));
    reversedIds = new Set(((revs ?? []) as any[]).map((r) => r.reverses_activity_id));
  }
  const recent: ProfileActivity[] = recentRows.map((r) => ({
    id: r.id,
    kind: r.kind,
    actionKey: r.action_key,
    quantity: r.quantity,
    balanceAfter: r.balance_after ?? null,
    createdAt: r.created_at,
    programName: one<any>(r.loyalty_programs)?.name ?? null,
    isPackage: !one<any>(r.loyalty_programs),
    carryOver: r.source === "carry_over",
    reversed: reversedIds.has(r.id),
  }));

  return {
    connection: { connectionId: conn.connectionId, name: conn.name, connectedAt: conn.connectedAt },
    programs,
    rewards,
    packages,
    recent,
  };
}
