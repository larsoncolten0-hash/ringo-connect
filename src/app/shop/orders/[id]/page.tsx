import { notFound } from "next/navigation";
import { getShopOrderReceiptData } from "@/lib/productCheckout/receipt";
import ShopOrderReceiptView from "@/components/shop/ShopOrderReceiptView";

// The persistent customer-facing receipt for a Shop order (Increment 5B) — the destination
// linked from the checkout success screen, the receipt email, and the My Ringo activity feed.
// Public and unauthenticated by design, same posture as /m/[username]/receipt/[id] and
// /order/[id]: a customer has no account requirement to view a receipt they hold the link to —
// the order's own unguessable id is the access control (see getShopOrderReceiptData).
export const dynamic = "force-dynamic";

export default async function ShopOrderPage({ params }: { params: { id: string } }) {
  const data = await getShopOrderReceiptData(params.id);
  if (!data) return notFound();
  return <ShopOrderReceiptView data={data} />;
}
