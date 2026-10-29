import { requireLoyaltyPage } from "@/lib/loyalty/access";
import OffersManager from "@/components/loyalty/OffersManager";

export const dynamic = "force-dynamic";

// Offers: create and announce (loyalty.manage), apply at the till (loyalty.scan). The UI hides what the caller may not do; every API route re-checks it.
export default async function LoyaltyOffersPage() {
  const { can } = await requireLoyaltyPage(["loyalty.manage", "loyalty.scan"]);
  return <OffersManager can={{ scan: can.scan, manage: can.manage }} />;
}
