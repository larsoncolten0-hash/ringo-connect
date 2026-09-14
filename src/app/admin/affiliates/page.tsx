import { getAdminAffiliateOverview, getMyAffiliateOverview } from "@/lib/affiliate";
import { getAffiliateSettings } from "@/lib/affiliateSettings";
import AdminAffiliatesView from "@/components/admin/AdminAffiliatesView";
import SalesFunnelLinkCard from "@/components/SalesFunnelLinkCard";

// See src/app/admin/settings/page.tsx for why this is needed on every
// admin page — without it, navigating back here via the sidebar can show
// stale payout requests until a hard reload.
export const dynamic = "force-dynamic";

export default async function AdminAffiliatesPage() {
  // getMyAffiliateOverview() is the ADMIN'S OWN affiliate stats (same
  // function AffiliateView.tsx's page uses for any creator) — every
  // `users` row gets an affiliate_code via a DB trigger at creation,
  // admins included, so this works here identically. Distinct from
  // getAdminAffiliateOverview() below, which is the platform-wide view of
  // every affiliate's referrals/payouts, not the admin's own link.
  const [overview, settings, myOverview] = await Promise.all([
    getAdminAffiliateOverview(),
    getAffiliateSettings(),
    getMyAffiliateOverview(),
  ]);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";

  return (
    <div className="flex flex-col gap-6">
      {/* Lets the platform owner copy their own sales funnel link without
          leaving /admin for the regular creator dashboard — same card
          AffiliateView.tsx offers any creator. Only rendered when the
          signed-in admin actually has an affiliate_code (null only if the
          affiliate migration hasn't been run yet). */}
      {myOverview && <SalesFunnelLinkCard siteUrl={siteUrl} affiliateCode={myOverview.affiliateCode} />}
      <AdminAffiliatesView overview={overview} initialSettings={settings} />
    </div>
  );
}
