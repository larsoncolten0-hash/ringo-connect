import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie } from "@/lib/customer/session";
import { isUuid } from "@/lib/productCheckout/validation";
import { decideDigitalDownload } from "@/lib/digitalProducts/downloadAuth";

// The one gate standing between "paid for it" and "here's the file" for a Digital Product
// (see src/lib/digitalProducts/downloadAuth.ts for the authorization rules, and
// /api/music/tracks/[id]/audio for the precedent this route deliberately mirrors). NEVER returns
// the private file itself — only a short-lived signed Storage URL, and only after independently
// re-fetching the order and its item from the database. Nothing here trusts the client: not a
// product id alone, not an order id alone, not any payment-status claim in the request.
export const dynamic = "force-dynamic";

const SIGNED_URL_SECONDS = 300; // long enough to actually start a download, short enough to not be a durable, re-shareable link

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order");
  const productId = searchParams.get("product");
  if (!isUuid(orderId) || !isUuid(productId)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const admin = createAdminClient();

  const [{ data: order }, session] = await Promise.all([
    admin.from("product_orders").select("id, status, customer_id").eq("id", orderId).maybeSingle(),
    getCustomerFromCookie(),
  ]);

  // The item lookup is scoped to BOTH order_id and product_id — this is what makes "the order
  // contains the requested product" a real check rather than a client-supplied assumption, and it
  // never runs at all if the order itself doesn't exist.
  const { data: item } = order
    ? await admin
        .from("product_order_items")
        .select("digital_file_path_snapshot, digital_file_name_snapshot")
        .eq("order_id", orderId)
        .eq("product_id", productId)
        .maybeSingle()
    : { data: null };

  const decision = decideDigitalDownload(
    order ? { id: order.id, status: order.status, customerId: order.customer_id } : null,
    item ? { digitalFilePath: item.digital_file_path_snapshot, digitalFileName: item.digital_file_name_snapshot } : null,
    { sessionCustomerId: session?.customer.id ?? null }
  );

  if (!decision.ok) {
    const status = decision.reason === "order_not_found" || decision.reason === "item_not_found" ? 404 : decision.reason === "not_authorized" ? 403 : 409;
    return NextResponse.json({ error: decision.reason }, { status });
  }

  const { data: signed, error } = await admin.storage.from("digital-products").createSignedUrl(decision.path, SIGNED_URL_SECONDS, {
    download: decision.fileName || undefined,
  });
  if (error || !signed) {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl, expiresIn: SIGNED_URL_SECONDS });
}
