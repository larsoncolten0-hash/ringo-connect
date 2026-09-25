import { requireShopProfile } from "@/lib/shopAuth";
import { createSellerReader } from "@/lib/productCheckout/sellerReaders";
import { getSellerEarnings } from "@/lib/productCheckout/sellerOrders";
import { getMyShopPayoutOverview } from "@/lib/shopPayouts";
import ShopEarningsView from "@/components/shop/ShopEarningsView";

export const dynamic = "force-dynamic";

export default async function ShopEarningsPage({ searchParams }: { searchParams: { page?: string } }) {
  const { supabase, admin, profile } = await requireShopProfile();
  const [data, payoutOverview] = await Promise.all([
    getSellerEarnings(createSellerReader(supabase, admin), { profileId: profile.id, page: searchParams.page }),
    getMyShopPayoutOverview(),
  ]);
  return <ShopEarningsView data={data} payoutOverview={payoutOverview} />;
}
