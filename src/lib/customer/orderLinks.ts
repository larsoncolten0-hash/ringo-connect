import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie } from "@/lib/customer/session";

export type OrderKind = "music_order" | "restaurant_order" | "booking";

/**
 * Called by the EXISTING guest checkout routes right after they create a
 * record. If (and only if) the request carries a valid Ringo customer
 * session, the new record is linked to that customer. The customer comes
 * from the session cookie — never from the request body — and guests are
 * unaffected: no session means nothing happens. Never throws, so it can
 * never break a checkout (including before the migration has been applied).
 */
export async function linkOrderToSessionCustomer(kind: OrderKind, orderId: string): Promise<void> {
  try {
    const session = await getCustomerFromCookie();
    if (!session) return;
    const { error } = await createAdminClient()
      .from("customer_order_links")
      .upsert(
        { customer_id: session.customer.id, order_kind: kind, order_id: orderId, link_source: "checkout_session" },
        { onConflict: "order_kind,order_id", ignoreDuplicates: true }
      );
    if (error) console.error("customer_order_links insert failed:", error.message);
  } catch (err) {
    console.error("linkOrderToSessionCustomer failed:", err);
  }
}

/**
 * Every record of `kind` that belongs to this customer: ONLY records that were
 * explicitly linked from their authenticated session at checkout.
 *
 * Deliberately NOT matched by email or phone. A guest checkout's email/phone
 * was typed into a form and never verified, so "the customer's verified email
 * equals the order's email" does not prove the customer made (or is entitled
 * to) that purchase — and here it would grant access to purchased audio and
 * order details. Old guest purchases therefore stay reachable exactly as before
 * (their own receipt/order link and email); making them appear in My Ringo
 * needs a dedicated, verified recovery flow (not built).
 *
 * `customer` must come from the server-side customer session.
 */
export async function resolveOwnedOrderIds(customer: { id: string }, kind: OrderKind): Promise<string[]> {
  const { data, error } = await createAdminClient()
    .from("customer_order_links")
    .select("order_id")
    .eq("customer_id", customer.id)
    .eq("order_kind", kind)
    .limit(1000);
  // Table not created yet (migration pending) or a transient error: nothing is
  // linked as far as we can tell — never fail the page.
  if (error) {
    console.error("customer_order_links read failed:", error.message);
    return [];
  }
  return (data || []).map((l: any) => l.order_id as string);
}
