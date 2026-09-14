import { createAdminClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/team/permissions";

/**
 * Every user_id who should hear about an event on organization `profileId`:
 * the owner always, plus any ACTIVE organization_members whose role
 * includes at least one of `anyOfPermissions`. Used to expand a
 * notification's audience beyond the owner alone — it does NOT decide who
 * can actually read the underlying data (that's still RLS's job); calling
 * this for an event type whose data isn't yet staff-RLS-enforced would
 * notify people about something they can't open, so callers should only
 * use this where that's already true (see /api/orders' own comment on why
 * restaurant orders qualify and bookings/music orders don't yet).
 *
 * Uses the service-role client — this runs from server routes that already
 * hold it for the write that triggered the notification in the first
 * place, and a notification's own send path (like every other cross-
 * cutting sender in this app) isn't scoped to any one caller's session.
 */
export async function getOrgNotificationAudience(profileId: string, anyOfPermissions: Permission[]): Promise<string[]> {
  const admin = createAdminClient();
  const [{ data: profile }, { data: members }] = await Promise.all([
    admin.from("profiles").select("user_id").eq("id", profileId).maybeSingle(),
    admin
      .from("organization_members")
      .select("user_id, organization_roles(permissions)")
      .eq("profile_id", profileId)
      .eq("status", "active"),
  ]);

  const ids = new Set<string>();
  if (profile?.user_id) ids.add(profile.user_id);

  for (const m of members || []) {
    const permissions = ((m as any).organization_roles?.permissions || []) as string[];
    if (anyOfPermissions.some((p) => permissions.includes(p))) {
      ids.add((m as any).user_id);
    }
  }

  return Array.from(ids);
}
