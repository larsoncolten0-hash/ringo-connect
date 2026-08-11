import { createClient } from "@/lib/supabase/server";
import AdminAnalyticsView from "@/components/admin/AdminAnalyticsView";

export default async function AdminAnalyticsPage() {
  const supabase = createClient();

  const [{ data: users }, { data: transactions }, { data: events }, { data: recentTransactions }] = await Promise.all([
    supabase.from("users").select("id, role, created_at, plans(name)"),
    supabase.from("payment_transactions").select("amount, currency, status, provider"),
    // Platform-wide, so no profile_id filter — capped for the same
    // reason as the per-creator analytics page.
    supabase.from("click_events").select("target_type, created_at").order("created_at", { ascending: true }).limit(20000),
    supabase
      .from("payment_transactions")
      .select("id, plan_name, provider, amount, currency, status, created_at, users(email)")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  return (
    <AdminAnalyticsView
      users={users || []}
      transactions={transactions || []}
      events={events || []}
      recentTransactions={recentTransactions || []}
    />
  );
}