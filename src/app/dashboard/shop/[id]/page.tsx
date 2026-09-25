import { notFound } from "next/navigation";
import { requireShopProfile } from "@/lib/shopAuth";
import { createSellerReader } from "@/lib/productCheckout/sellerReaders";
import { getSellerOrderDetail } from "@/lib/productCheckout/sellerOrders";
import { isUuid } from "@/lib/productCheckout/validation";
import ShopOrderDetail from "@/components/shop/ShopOrderDetail";

export const dynamic = "force-dynamic";

// Ownership is proven by the RLS-scoped read inside getSellerOrderDetail; another seller's order (or a
// malformed id) is simply "not found".
export default async function ShopOrderPage({ params }: { params: { id: string } }) {
  const { supabase, admin, profile } = await requireShopProfile();
  if (!isUuid(params.id)) return notFound();
  const order = await getSellerOrderDetail(createSellerReader(supabase, admin), { profileId: profile.id, orderId: params.id });
  if (!order) return notFound();
  return <ShopOrderDetail order={order} />;
}
