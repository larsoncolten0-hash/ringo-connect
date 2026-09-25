import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isSameOrigin } from "@/lib/customer/session";
import { fulfillOrder } from "@/lib/productCheckout/fulfillOrder";
import { createFulfillStore } from "@/lib/productCheckout/sellerReaders";
import { SELLER_HTTP_STATUS, type SellerErrorCode } from "@/lib/productCheckout/sellerErrors";

// Seller marks a PAID product order as fulfilled (paid -> fulfilled, nothing else).
//  - requires a signed-in seller (401) and a same-origin request (403, CSRF);
//  - ownership is proven by an RLS-scoped read of the seller's OWN profile's order - another seller's
//    order is indistinguishable from a missing one (404);
//  - the write is a conditional claim, so repeating it is harmless (200, already: true);
//  - the database trigger stays the final guard; the body is never read.
// Responses carry stable codes only - never database text.
export const dynamic = "force-dynamic";

const fail = (code: SellerErrorCode) => NextResponse.json({ error: code }, { status: SELLER_HTTP_STATUS[code] });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return fail("not_authenticated");
    if (!isSameOrigin(request)) return fail("forbidden");

    // The seller's OWN profile only (owner-only, like Music); an admin is not special-cased here.
    const { data: profile } = await supabase.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
    if (!profile) return fail("order_not_found");

    const result = await fulfillOrder(
      createFulfillStore(supabase, createAdminClient(), (profile as { id: string }).id, (event, data) => console.warn(`[shop] ${event}`, data ?? {})),
      params.id
    );
    if (!result.ok) return fail(result.code);
    return NextResponse.json(result.data);
  } catch (err) {
    console.error("[shop] fulfill failed:", (err as Error)?.message || err);
    return fail("internal_error");
  }
}
