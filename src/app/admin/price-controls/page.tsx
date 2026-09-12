import { getAffiliateSettings } from "@/lib/affiliateSettings";
import { getMusicPayoutSettings } from "@/lib/musicPayoutSettings";
import AdminPriceControlsView from "@/components/admin/AdminPriceControlsView";

// The one place every revenue-share knob lives — commission/fee rates,
// payout hold periods, minimum payout amounts — one card per category.
// Affiliate and Music are the two categories with a real payout system
// today (see /admin/affiliates and /admin/music-payouts, which now only
// handle request PROCESSING and link back here for settings). Adding a
// future category's payout settings (e.g. if restaurant_food ever gets
// its own Fapshi-verified automatic collection the way music just did) is
// just: a small `get/updateXSettings()` pair mirroring
// affiliateSettings.ts/musicPayoutSettings.ts, and one more card in
// AdminPriceControlsView.tsx — not a new admin page.
export const dynamic = "force-dynamic";

export default async function AdminPriceControlsPage() {
  const [affiliateSettings, musicSettings] = await Promise.all([getAffiliateSettings(), getMusicPayoutSettings()]);
  return <AdminPriceControlsView initialAffiliateSettings={affiliateSettings} initialMusicSettings={musicSettings} />;
}
