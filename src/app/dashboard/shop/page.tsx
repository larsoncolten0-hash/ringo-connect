import { requireShopProfile } from "@/lib/shopAuth";
import { createSellerReader } from "@/lib/productCheckout/sellerReaders";
import { listSellerOrders } from "@/lib/productCheckout/sellerOrders";
import ShopOrdersView from "@/components/shop/ShopOrdersView";

export const dynamic = "force-dynamic";

export default async function ShopOrdersPage({ searchParams }: { searchParams: { group?: string; page?: string } }) {
  const { supabase, admin, profile } = await requireShopProfile();
  const data = await listSellerOrders(createSellerReader(supabase, admin), { profileId: profile.id, group: searchParams.group, page: searchParams.page });
  return <ShopOrdersView data={data} />;
}
