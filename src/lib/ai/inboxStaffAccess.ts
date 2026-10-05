import { createAdminClient } from "@/lib/supabase/server";
import { getAiSettings } from "@/lib/ai/settings";
import { getAiProvider } from "@/lib/ai/providers";
import type { AiAccess, AiAccessResult } from "@/lib/ai/guard";

// Ringo AI for a TEAM MEMBER working in someone else's Inbox. Eligibility and quota belong to the ORGANIZATION, i.e. its OWNER:
//   * the owner's plan (`ai_enabled`), account status, demo flag and beta allowlist decide whether Ringo AI is available at all;
//   * the workspace carries the OWNER's user id and profile id, so reserveAiQuota / recordUsageEvent charge the owner's existing, shared quota —
//     a staff member never gets a separate quota and cannot multiply the owner's;
//   * the global kill switch and the provider configuration are the same ones the owner path uses.
// The staff member is recorded as the actor (`actor.kind = "staff"`), never as the billing owner. The caller (the assist route) has ALREADY checked, with
// guardConversationAction, that the signed-in user is an active member of the organization that owns the conversation, that the Team plan gate holds and
// that the role grants inbox.ai (+ inbox.view). `ownerProfileId` is derived on the server from that conversation; nothing here comes from the browser.
// The checks below mirror resolveAiAccess in guard.ts, in the same order, evaluated for the owner instead of the session user.

export interface StaffAiInput {
  ownerProfileId: string;
  /** The authenticated team member (already authorized for inbox.ai by the database). Used only to label the actor. */
  staffUserId: string;
}

export async function resolveOrganizationAiAccess(input: StaffAiInput): Promise<AiAccessResult> {
  const settings = await getAiSettings();
  if (!settings.enabled) return { ok: false, reason: "disabled" };

  const provider = getAiProvider(settings.provider);
  if (!provider || !provider.isConfigured()) return { ok: false, reason: "not_configured" };

  const admin = createAdminClient();
  let roleName = "Team member";
  let permissions: string[] = [];
  try {
    const { data: m } = await admin.from("organization_members").select("organization_roles(name, permissions)").eq("profile_id", input.ownerProfileId).eq("user_id", input.staffUserId).eq("status", "active").maybeSingle();
    const r = (m as any)?.organization_roles;
    if (r) {
      roleName = String(r.name || roleName).slice(0, 60);
      permissions = (Array.isArray(r.permissions) ? r.permissions : []).filter((p: unknown): p is string => typeof p === "string" && p.startsWith("inbox."));
    }
  } catch {
    /* the role label is informational only */
  }
  const { data: profile } = await admin.from("profiles").select("id, user_id, username, is_demo").eq("id", input.ownerProfileId).maybeSingle();
  if (!profile?.user_id) return { ok: false, reason: "no_profile" };

  const { data: ownerRow } = await admin.from("users").select("status, role, plan_id, plans(ai_enabled)").eq("id", profile.user_id).maybeSingle();
  if (!ownerRow || (ownerRow as any).status !== "active") return { ok: false, reason: "account_inactive" };
  if ((profile as any).is_demo === true) return { ok: false, reason: "demo_account" };

  let dailyMessageLimit = settings.dailyMessageLimit;
  const { data: beta } = await admin.from("ai_beta_access").select("user_id, daily_message_limit_override").eq("user_id", profile.user_id).maybeSingle();
  if (settings.accessMode === "allowlist" && !beta) return { ok: false, reason: "not_in_beta" };
  if (!beta && (ownerRow as any).plans?.ai_enabled !== true) return { ok: false, reason: "plan_not_eligible" };
  if (beta && typeof beta.daily_message_limit_override === "number") dailyMessageLimit = beta.daily_message_limit_override;

  const access: AiAccess = {
    workspace: {
      userId: String(profile.user_id),
      profileId: String(profile.id),
      username: String((profile as any).username ?? ""),
      actor: { kind: "staff", roleName, permissions },
    },
    settings,
    provider,
    dailyMessageLimit,
    isPlatformAdmin: (ownerRow as any).role === "admin",
  };
  return { ok: true, access };
}
