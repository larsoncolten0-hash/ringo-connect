import { getAdminShopPayoutOverview } from "@/lib/shopPayouts";
import { getShopPayoutSettings } from "@/lib/shopPayoutSettings";
import AdminShopPayoutsView from "@/components/admin/AdminShopPayoutsView";

// See src/app/admin/settings/page.tsx for why this is needed on every admin page — without it,
// navigating back here can show stale payout requests until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminShopPayoutsPage() {
  const [overview, settings] = await Promise.all([getAdminShopPayoutOverview(), getShopPayoutSettings()]);
  return <AdminShopPayoutsView overview={overview} initialSettings={settings} />;
}
