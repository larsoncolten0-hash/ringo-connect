import { getAffiliateSettings } from "@/lib/affiliateSettings";
import { getMusicPayoutSettings } from "@/lib/musicPayoutSettings";
import { getShopPayoutSettings } from "@/lib/shopPayoutSettings";
import { getProtectionSettings } from "@/lib/protectionSettings";
import { getSubscriptionReminderSettings } from "@/lib/subscriptionReminderSettings";
import AdminPriceControlsView from "@/components/admin/AdminPriceControlsView";

// The one place every revenue-share knob lives — commission/fee rates,
// payout hold periods, minimum payout amounts — one card per category.
// Affiliate, Music and Shop are the categories with a real payout system
// today (see /admin/affiliates, /admin/music-payouts and
// /admin/shop-payouts, which now only handle request PROCESSING and link
// back here for settings). Adding a future category's payout settings is
// just: a small `get/updateXSettings()` pair mirroring
// affiliateSettings.ts/musicPayoutSettings.ts/shopPayoutSettings.ts, and
// one more card in AdminPriceControlsView.tsx — not a new admin page.
//
// Shop's own commerce_enabled/commerce_commission_rate live on the
// general Admin Settings page (Commerce / Shop section) instead — those
// are platform/provider-level switches, not payout knobs, so they follow
// platformSettings.ts's existing convention rather than this file's.
export const dynamic = "force-dynamic";

export default async function AdminPriceControlsPage() {
  const [affiliateSettings, musicSettings, shopSettings, protectionSettings, subscriptionReminderSettings] = await Promise.all([
    getAffiliateSettings(),
    getMusicPayoutSettings(),
    getShopPayoutSettings(),
    getProtectionSettings(),
    getSubscriptionReminderSettings(),
  ]);
  return (
    <AdminPriceControlsView
      initialAffiliateSettings={affiliateSettings}
      initialMusicSettings={musicSettings}
      initialShopSettings={shopSettings}
      initialProtectionSettings={protectionSettings}
      initialSubscriptionReminderSettings={subscriptionReminderSettings}
    />
  );
}
