import { createAdminClient } from "@/lib/supabase/server";

export type OrgActivityAction =
  | "member_invited"
  | "invitation_link_generated"
  | "invitation_revoked"
  | "invitation_resent"
  | "member_joined"
  | "role_changed"
  | "permissions_changed"
  | "member_deactivated"
  | "member_reactivated"
  | "member_removed"
  | "role_created"
  | "role_updated"
  | "role_deleted";

/**
 * Records one organization_activity_log row. Uses the service-role client
 * so this can never fail (or be blocked) by the RLS insert-check's
 * `actor_user_id = auth.uid()` requirement in edge cases like the
 * invitation-accept route, where the "actor" (the new member) is legitimate
 * but the write happens under an admin client anyway for the membership
 * insert itself. Errors are logged, never thrown — an audit-log failure
 * must never take down the action it's describing (same posture as
 * src/lib/notifications.ts).
 */
export async function logOrgActivity(input: {
  profileId: string;
  actorUserId?: string | null;
  action: OrgActivityAction;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  const { error } = await admin.from("organization_activity_log").insert({
    profile_id: input.profileId,
    actor_user_id: input.actorUserId ?? null,
    action: input.action,
    target_user_id: input.targetUserId ?? null,
    details: input.details ?? null,
  });
  if (error) console.error("logOrgActivity failed:", error.message);
}
