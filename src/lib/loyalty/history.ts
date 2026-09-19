import { createAdminClient } from "@/lib/supabase/server";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";
import type { ProgramRow } from "@/lib/loyalty/programs";

// Business-side reading: the loyalty activity history and the overview numbers.
// Every query is scoped by profile_id, which always comes from the authenticated session.

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export interface ActivityItem {
  id: string;
  createdAt: string;
  kind: "record" | "reversal";
  source: string;
  actionKey: string;
  quantity: number;
  balanceAfter: number | null;
  reason: string | null;
  customerName: string;
  programName: string | null;
  packageName: string | null;
  // Just the part of the staff member's address before the "@" (like a first name): enough to tell
  // who recorded it, without handing colleagues' full email addresses to every scan-only user.
  staffLabel: string | null;
  reversed: boolean;
}

export const ACTIVITY_PAGE_SIZE = 30;

export function staffLabelOf(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const local = email.split("@")[0]?.trim();
  return local ? local : null;
}

/** Newest first. `cursor` is the created_at of the last item of the previous page. */
export async function listActivity(
  profileId: string,
  options: { cursor?: string | null; limit?: number } = {},
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(options.limit ?? ACTIVITY_PAGE_SIZE, 1), 100);

  let q = admin
    .from("loyalty_activities")
    .select(
      "id, created_at, kind, source, action_key, quantity, balance_after, reversal_reason, package_credit_id, ringo_customers(name), loyalty_programs(name), users(email)"
    )
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (options.cursor) {
    const d = new Date(options.cursor);
    if (!Number.isNaN(d.getTime())) q = q.lt("created_at", d.toISOString());
  }
  const { data, error } = await q;
  if (error) throw new Error(`listActivity failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? page[page.length - 1].created_at : null;

  const ids = page.map((r) => r.id);
  const creditIds = page.map((r) => r.package_credit_id).filter(Boolean);
  const [revs, credits] = await Promise.all([
    ids.length
      ? admin.from("loyalty_activities").select("reverses_activity_id").eq("profile_id", profileId).in("reverses_activity_id", ids)
      : Promise.resolve({ data: [] as any[] }),
    creditIds.length
      ? admin.from("loyalty_package_credits").select("id, loyalty_packages(name_snapshot)").eq("profile_id", profileId).in("id", creditIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const reversed = new Set(((revs.data ?? []) as any[]).map((r) => r.reverses_activity_id));
  const packageByCredit = new Map<string, string>(
    ((credits.data ?? []) as any[]).map((c) => [c.id, one<any>(c.loyalty_packages)?.name_snapshot ?? ""])
  );

  const items: ActivityItem[] = page.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    kind: r.kind,
    source: r.source,
    actionKey: r.action_key,
    quantity: r.quantity,
    balanceAfter: r.balance_after ?? null,
    reason: r.reversal_reason ?? null,
    customerName: one<any>(r.ringo_customers)?.name ?? "",
    programName: one<any>(r.loyalty_programs)?.name ?? null,
    packageName: r.package_credit_id ? packageByCredit.get(r.package_credit_id) ?? null : null,
    staffLabel: staffLabelOf(one<any>(r.users)?.email),
    reversed: reversed.has(r.id),
  }));
  return { items, nextCursor };
}

export interface OverviewStats {
  members: number;
  newMembersMonth: number;
  activeMembers30d: number;
  activitiesMonth: number;
  rewardsReady: number;
  rewardsEarned: number;
  rewardsRedeemed: number;
  redemptionRate: number; // 0-100
  activePackages: number;
  programProgress: Record<string, number>; // programId -> average % of target (0-100)
}

// Lightweight on purpose: a handful of counts plus two narrow column reads, no analytics
// engine. The two column reads are capped so a very large customer base cannot make the
// overview slow; beyond the cap, "members" and "active" are a lower bound.
const READ_CAP = 10_000;

export async function getOverviewStats(
  profileId: string,
  programs: ProgramRow[],
  admin: LoyaltyAdmin = createAdminClient()
): Promise<OverviewStats> {
  const now = new Date();
  const nowIso = now.toISOString();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const since30 = new Date(now.getTime() - 30 * 864e5).toISOString();

  const count = async (build: () => any): Promise<number> => {
    const { count: c, error } = await build();
    if (error) throw new Error(`overview count failed: ${error.message}`);
    return c ?? 0;
  };
  const head = (table: string) => admin.from(table).select("id", { count: "exact", head: true }).eq("profile_id", profileId);

  const [
    newMembersMonth,
    recordsMonth,
    reversalsMonth,
    rewardsReady,
    rewardsRedeemed,
    rewardsEarned,
    activePackages,
    membershipsRes,
    recentRes,
  ] = await Promise.all([
    count(() => head("loyalty_memberships").gte("joined_at", monthStart)),
    count(() => head("loyalty_activities").eq("kind", "record").neq("source", "carry_over").gte("created_at", monthStart)),
    count(() => head("loyalty_activities").eq("kind", "reversal").gte("created_at", monthStart)),
    count(() => head("loyalty_rewards").eq("status", "available").or(`expires_at.is.null,expires_at.gt.${nowIso}`)),
    count(() => head("loyalty_rewards").eq("status", "redeemed")),
    count(() => head("loyalty_rewards").neq("status", "voided")),
    count(() => head("loyalty_packages").eq("status", "active").gt("ends_at", nowIso)),
    admin.from("loyalty_memberships").select("customer_id, program_id, progress").eq("profile_id", profileId).limit(READ_CAP),
    admin
      .from("loyalty_activities")
      .select("customer_id")
      .eq("profile_id", profileId)
      .eq("kind", "record")
      .neq("source", "carry_over")
      .gte("created_at", since30)
      .limit(READ_CAP),
  ]);
  if (membershipsRes.error) throw new Error(`overview memberships failed: ${membershipsRes.error.message}`);
  if (recentRes.error) throw new Error(`overview recent failed: ${recentRes.error.message}`);

  const memberships = (membershipsRes.data ?? []) as any[];
  const targetById = new Map(programs.map((p) => [p.id, p.target]));
  const sums = new Map<string, { total: number; n: number }>();
  for (const m of memberships) {
    const target = targetById.get(m.program_id);
    if (!target) continue;
    const pct = Math.min(m.progress / target, 1) * 100;
    const s = sums.get(m.program_id) ?? { total: 0, n: 0 };
    s.total += pct;
    s.n += 1;
    sums.set(m.program_id, s);
  }
  const programProgress: Record<string, number> = {};
  for (const [id, s] of Array.from(sums.entries())) programProgress[id] = Math.round(s.total / s.n);

  return {
    members: new Set(memberships.map((m) => m.customer_id)).size,
    newMembersMonth,
    activeMembers30d: new Set(((recentRes.data ?? []) as any[]).map((r) => r.customer_id)).size,
    activitiesMonth: Math.max(recordsMonth - reversalsMonth, 0),
    rewardsReady,
    rewardsEarned,
    rewardsRedeemed,
    redemptionRate: rewardsEarned > 0 ? Math.round((rewardsRedeemed / rewardsEarned) * 100) : 0,
    activePackages,
    programProgress,
  };
}
