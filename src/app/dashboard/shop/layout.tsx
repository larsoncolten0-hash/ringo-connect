import { requireShopProfile } from "@/lib/shopAuth";
import ShopTabs from "@/components/shop/ShopTabs";

export const dynamic = "force-dynamic";

// Seller Shop section (product orders, fulfillment, earnings). Owner only, like Music - see shopAuth.ts.
export default async function ShopDashboardLayout({ children }: { children: React.ReactNode }) {
  await requireShopProfile();

  return (
    <div className="max-w-5xl">
      <ShopTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
