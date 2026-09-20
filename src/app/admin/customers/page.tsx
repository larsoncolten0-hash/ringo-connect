import { createAdminClient } from "@/lib/supabase/server";
import { getTestAccountIds } from "@/lib/adminTestAccounts";
import AdminCustomersAnalytics from "@/components/admin/AdminCustomersAnalytics";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back to a page via the sidebar can
// show stale cached data until a hard reload.
export const dynamic = "force-dynamic";

// Analytics for Ringo CUSTOMERS (the people who sign in to My Ringo and
// connect with creators) — deliberately its own page, separate from the
// creator/user analytics on /admin and the platform figures on
// /admin/analytics. Read-only: it only selects from ringo_customers,
// customer_connections and profiles, and writes nothing.
export default async function AdminCustomersPage() {
  const supabase = createAdminClient();

  const [{ data: customers }, { data: connections }, testAccounts] = await Promise.all([
    supabase.from("ringo_customers").select("id, created_at, last_login_at, preferred_language").limit(20000),
    supabase.from("customer_connections").select("customer_id, profile_id, status, source, marketing_consent").limit(20000),
    getTestAccountIds(supabase),
  ]);

  // Connections to demo/test creator pages are test data. A customer whose
  // ONLY connections are to demo pages is a test customer and is excluded too.
  const allConnections = connections || [];
  const realConnections = allConnections.filter((c) => !testAccounts.profileIds.has(c.profile_id));
  const customersWithReal = new Set(realConnections.map((c) => c.customer_id));
  const customersWithAny = new Set(allConnections.map((c) => c.customer_id));
  const realCustomers = (customers || []).filter((c) => customersWithReal.has(c.id) || !customersWithAny.has(c.id));

  // Top creators by active connections — resolve usernames only for the top 10.
  const counts: Record<string, number> = {};
  realConnections
    .filter((c) => c.status === "active")
    .forEach((c) => {
      counts[c.profile_id] = (counts[c.profile_id] || 0) + 1;
    });
  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  const { data: topProfiles } = top.length
    ? await supabase.from("profiles").select("id, username, name").in("id", top.map(([id]) => id))
    : { data: [] as { id: string; username: string; name: string | null }[] };
  const topCreators = top.map(([id, count]) => {
    const p = (topProfiles || []).find((x) => x.id === id);
    return { label: p?.name || (p?.username ? `@${p.username}` : "Unknown"), count };
  });

  return (
    <AdminCustomersAnalytics
      customers={realCustomers}
      connections={realConnections}
      topCreators={topCreators}
      hiddenTestCustomers={(customers || []).length - realCustomers.length}
    />
  );
}
