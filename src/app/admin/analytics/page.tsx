import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getTestAccountIds } from "@/lib/adminTestAccounts";
import AdminAnalyticsView from "@/components/admin/AdminAnalyticsView";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back to a page via the sidebar can
// show stale cached data until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const supabase = createClient();

  const [{ data: users }, { data: transactions }, { data: events }, { data: recentTransactions }, testAccounts] = await Promise.all([
    supabase.from("users").select("id, role, created_at, plans(name)"),
    supabase.from("payment_transactions").select("user_id, amount, currency, status, provider"),
    // Platform-wide, so no profile_id filter — capped for the same
    // reason as the per-creator analytics page.
    supabase.from("click_events").select("profile_id, target_type, created_at").order("created_at", { ascending: true }).limit(20000),
    supabase
      .from("payment_transactions")
      .select("id, user_id, plan_name, provider, amount, currency, status, created_at, users(email)")
      .order("created_at", { ascending: false })
      .limit(60),
    getTestAccountIds(createAdminClient()),
  ]);

  // Demo/test accounts never count toward platform analytics. Recent
  // transactions were over-fetched (60) so 25 real ones usually remain.
  const { userIds: testUserIds, profileIds: testProfileIds } = testAccounts;

  return (
    <AdminAnalyticsView
      users={(users || []).filter((u) => !testUserIds.has(u.id))}
      transactions={(transactions || []).filter((t) => !t.user_id || !testUserIds.has(t.user_id))}
      events={(events || []).filter((e) => !e.profile_id || !testProfileIds.has(e.profile_id))}
      recentTransactions={(recentTransactions || []).filter((t) => !t.user_id || !testUserIds.has(t.user_id)).slice(0, 25)}
    />
  );
}