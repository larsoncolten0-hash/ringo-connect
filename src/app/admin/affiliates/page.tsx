import { getAdminAffiliateOverview } from "@/lib/affiliate";
import { getAffiliateSettings } from "@/lib/affiliateSettings";
import AdminAffiliatesView from "@/components/admin/AdminAffiliatesView";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back here via the sidebar can show
// stale payout requests until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminAffiliatesPage() {
  const [overview, settings] = await Promise.all([getAdminAffiliateOverview(), getAffiliateSettings()]);
  return <AdminAffiliatesView overview={overview} initialSettings={settings} />;
}
