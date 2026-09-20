import type { SupabaseClient } from "@supabase/supabase-js";

// "Test users" = the throwaway "Try the dashboard" demo accounts
// (profiles.is_demo — see src/app/api/demo/create/route.ts). They exist only
// so a prospect can look around for 7 days; counting them would inflate every
// admin analytics figure with fake signups, page views and connections.
// Read-only: this never writes anything and changes no existing data.
//
// Pass a service-role client (createAdminClient) — the admin analytics pages
// already sit behind the admin layout's own access check.
export async function getTestAccountIds(supabase: SupabaseClient) {
  const { data } = await supabase.from("profiles").select("id, user_id").eq("is_demo", true).limit(20000);
  const userIds = new Set<string>();
  const profileIds = new Set<string>();
  (data || []).forEach((p: { id: string; user_id: string | null }) => {
    profileIds.add(p.id);
    if (p.user_id) userIds.add(p.user_id);
  });
  return { userIds, profileIds };
}
