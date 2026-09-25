import { requireShopProfile } from "@/lib/shopAuth";
import { createSellerReader } from "@/lib/productCheckout/sellerReaders";
import { getSellerEarnings } from "@/lib/productCheckout/sellerOrders";
import ShopEarningsView from "@/components/shop/ShopEarningsView";

export const dynamic = "force-dynamic";

export default async function ShopEarningsPage({ searchParams }: { searchParams: { page?: string } }) {
  const { supabase, admin, profile } = await requireShopProfile();
  const data = await getSellerEarnings(createSellerReader(supabase, admin), { profileId: profile.id, page: searchParams.page });
  return <ShopEarningsView data={data} />;
}
