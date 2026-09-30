// A Team Leader adds existing Ringo accounts to THEIR team as Ambassadors — and
// nothing more. The new Ambassador is created 'pending': their code does not
// work, they cannot approve clients, save a payout destination or request a
// payout, and they hold no admin-granted permission. Ringo Management reviews
// them in Admin -> Ambassadors and activates them; only then do they have any
// access.
//
// Rules, all enforced here from the caller's verified session (the request body
// contributes ONLY a username to look up):
//   * the caller must lead an ACTIVE team; the new member always joins THAT team —
//     a Team Leader can never add anyone to another team, choose a status, choose a
//     code, or touch an existing Ambassador (no moving people between teams,
//     no re-activating);
//   * the person must already have a Ringo account. The Team Leader creates no
//     logins and sets no passwords;
//   * one Ambassador profile per person: anyone who already has one, in any state,
//     is refused;
//   * demo and suspended accounts are refused;
//   * a cap on how many members can be waiting for review at once, so the queue
//     cannot be flooded;
//   * audited in ambassador_admin_actions, and Management is notified.
import { notifyAdminsOfPendingAmbassador, notifyAmbassadorAddedPending } from "@/lib/ambassador/notifications";

/** How many of a team's Ambassadors may be awaiting review at the same time. */
export const MAX_PENDING_PER_TEAM = 25;

export type AddMemberErrorCode = "not_team_leader" | "team_inactive" | "invalid_username" | "user_not_found" | "cannot_add_self" | "already_ambassador" | "account_unavailable" | "too_many_pending" | "unavailable";

export async function addPendingAmbassador(admin: any, leaderUserId: string, rawUsername: unknown): Promise<{ ok: true; username: string } | { ok: false; code: AddMemberErrorCode }> {
  const username = typeof rawUsername === "string" ? rawUsername.trim().toLowerCase().replace(/^@/, "") : "";
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return { ok: false, code: "invalid_username" };

  const { data: team } = await admin.from("ambassador_teams").select("id, status").eq("team_leader_user_id", leaderUserId).maybeSingle();
  if (!team) return { ok: false, code: "not_team_leader" };
  if (team.status !== "active") return { ok: false, code: "team_inactive" };

  const { data: target } = await admin.from("profiles").select("user_id, username, is_demo").eq("username", username).maybeSingle();
  if (!target?.user_id) return { ok: false, code: "user_not_found" };
  if (target.user_id === leaderUserId) return { ok: false, code: "cannot_add_self" }; // they use "Add my account as an Ambassador"
  if (target.is_demo) return { ok: false, code: "account_unavailable" };

  const { data: owner } = await admin.from("users").select("status").eq("id", target.user_id).maybeSingle();
  if (!owner || owner.status === "suspended") return { ok: false, code: "account_unavailable" };

  const { data: existing } = await admin.from("ambassador_profiles").select("id").eq("user_id", target.user_id).maybeSingle();
  if (existing) return { ok: false, code: "already_ambassador" };

  const { count } = await admin.from("ambassador_profiles").select("id", { count: "exact", head: true }).eq("team_id", team.id).eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING_PER_TEAM) return { ok: false, code: "too_many_pending" };

  // status and team are fixed here; the sales_code comes from the existing database trigger.
  const { data: created, error } = await admin
    .from("ambassador_profiles")
    .insert({ user_id: target.user_id, team_id: team.id, status: "pending", created_by: leaderUserId })
    .select("id, sales_code, status, team_id")
    .single();
  if (error || !created) {
    console.error("team leader add-ambassador failed:", error?.message);
    return { ok: false, code: "unavailable" };
  }

  try {
    await admin.from("ambassador_admin_actions").insert({
      actor_user_id: leaderUserId,
      action: "ambassador_added_by_team_leader",
      target_table: "ambassador_profiles",
      target_id: created.id,
      before: null,
      after: { user_id: target.user_id, username: target.username, team_id: team.id, status: "pending" },
      reason: null,
    });
  } catch (err: any) {
    console.error("team leader add-ambassador audit failed:", err?.message);
  }

  // Neither can fail the creation.
  await notifyAdminsOfPendingAmbassador(admin, created.id);
  await notifyAmbassadorAddedPending(admin, target.user_id, created.id);
  return { ok: true, username: target.username };
}

export interface TeamMemberRow {
  id: string;
  username: string | null;
  status: string;
}

/** The Team Leader's own team members: username + status only (no code, no earnings). */
export async function listTeamMembers(admin: any, leaderUserId: string): Promise<TeamMemberRow[]> {
  const { data: team } = await admin.from("ambassador_teams").select("id").eq("team_leader_user_id", leaderUserId).maybeSingle();
  if (!team) return [];
  const { data: members } = await admin.from("ambassador_profiles").select("id, user_id, status").eq("team_id", team.id).order("created_at", { ascending: false }).limit(200);
  const rows = (members || []) as any[];
  const userIds = rows.map((m) => m.user_id);
  const { data: profiles } = userIds.length ? await admin.from("profiles").select("user_id, username").in("user_id", userIds) : { data: [] as any[] };
  const nameByUser = new Map<string, string>((profiles || []).map((p: any) => [p.user_id as string, p.username as string]));
  return rows.map((m) => ({ id: m.id, username: nameByUser.get(m.user_id) ?? null, status: m.status }));
}
