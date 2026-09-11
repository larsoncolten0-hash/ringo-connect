import { getAdminMusicPayoutOverview } from "@/lib/musicEarnings";
import { getMusicPayoutSettings } from "@/lib/musicPayoutSettings";
import AdminMusicPayoutsView from "@/components/admin/AdminMusicPayoutsView";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back here can show stale payout
// requests until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminMusicPayoutsPage() {
  const [overview, settings] = await Promise.all([getAdminMusicPayoutOverview(), getMusicPayoutSettings()]);
  return <AdminMusicPayoutsView overview={overview} initialSettings={settings} />;
}
