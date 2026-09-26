import { getProtectionAdminOverview } from "@/lib/protection/adminOverview";
import { listAdminProtectionTransactions } from "@/lib/protection/adminTransactions";
import AdminProtectionView from "@/components/admin/AdminProtectionView";

// See src/app/admin/settings/page.tsx for why this is needed on every admin page — without it,
// navigating back here can show stale data until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminProtectionPage() {
  const [overview, transactions] = await Promise.all([getProtectionAdminOverview(), listAdminProtectionTransactions()]);
  return <AdminProtectionView overview={overview} transactions={transactions} />;
}
