import { createAdminClient } from "@/lib/supabase/server";
import UserTable from "@/components/admin/UserTable";
import AdminUsersAnalytics from "@/components/admin/AdminUsersAnalytics";
import { getLastSignInMap } from "@/lib/adminUserActivity";
import { getTestAccountIds } from "@/lib/adminTestAccounts";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back to a page via the sidebar can
// show stale cached data until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const supabase = createAdminClient();

  // "*" already includes can_approve_requests, last_active_at,
  // last_active_standalone and pwa_installed_at — UserTable and
  // AdminUsersAnalytics read those straight off each row. profiles
  // (username, verified, category) — verified lives on profiles, not
  // users, see the migration's comment; category feeds the analytics
  // panel's category-distribution chart.
  const [{ data: users }, { data: plans }, lastSignInMap, { data: countryEvents }, { data: churnRows }, testAccounts] =
    await Promise.all([
      supabase
        .from("users")
        .select("*, plans(name, display_name), profiles(username, verified, category)")
        .order("created_at", { ascending: false }),
      supabase.from("plans").select("*"),
      getLastSignInMap(supabase),
      // Platform-wide geographic distribution reuses the same
      // click_events.country data the per-creator analytics page already
      // captures — no profile_id filter, so this is visitor traffic across
      // every creator's page, not "where creators themselves are based"
      // (this schema has no such field). Capped for the same reason
      // admin/analytics already caps its own platform-wide click query.
      supabase.from("click_events").select("country, profile_id").not("country", "is", null).limit(20000),
      // Downgrade/churn — see AdminUsersAnalytics.tsx and
      // CHURN_TRACKING_STARTED_AT for why only these two actions count and
      // why the metric is labeled as starting from a fixed date rather
      // than presented as full history.
      supabase
        .from("admin_audit_log")
        .select("action, created_at")
        .in("action", ["plan_expired_downgrade", "self_downgrade"]),
      getTestAccountIds(supabase),
    ]);

  // The analytics panel excludes demo/test accounts; the user table below
  // still lists every account so an admin can manage/inspect them.
  const { userIds: testUserIds, profileIds: testProfileIds } = testAccounts;
  const realUsers = (users || []).filter((u) => !testUserIds.has(u.id));
  const realCountryEvents = (countryEvents || []).filter((e) => !e.profile_id || !testProfileIds.has(e.profile_id));

  return (
    <div className="flex flex-col gap-6">
      <AdminUsersAnalytics
        users={realUsers}
        plans={plans || []}
        countryEvents={realCountryEvents}
        churnRows={churnRows || []}
      />
      <UserTable users={users || []} plans={plans || []} lastSignInMap={lastSignInMap} />
    </div>
  );
}
