import { requireLoyaltyPage } from "@/lib/loyalty/access";
import RetentionSegments from "@/components/loyalty/RetentionSegments";

export const dynamic = "force-dynamic";

// Customer segments (new, returning, VIP, inactive) as counts. Needs loyalty.manage; the API re-checks it.
export default async function LoyaltySegmentsPage() {
  const { profile } = await requireLoyaltyPage(["loyalty.manage"]);
  const isChurch = profile.category === "church_ministries" || (profile.categories || []).includes("church_ministries");
  return <RetentionSegments isChurch={isChurch} />;
}
