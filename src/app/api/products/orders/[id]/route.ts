import { NextResponse } from "next/server";
import { getShopOrderReceiptData } from "@/lib/productCheckout/receipt";

// Customer-facing Shop order receipt. Public, unauthenticated — same reasoning as
// /api/orders/[id] and /api/music/orders/[id]: the order's `id` is a random UUID handed to the
// customer at checkout, never listable, so knowing it is itself the access control. Reads only
// through getShopOrderReceiptData(), which hand-picks customer-safe fields (never `select("*")`)
// and never returns provider secrets, payout/earnings figures, phone/email, or any other
// seller-only column.
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const data = await getShopOrderReceiptData(params.id);
  if (!data) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  return NextResponse.json(data);
}
