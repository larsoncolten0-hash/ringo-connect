// The two entry points for a Shop receipt PDF, kept out of the route files so they can be tested with stubs.
//   customer: the receipt page's own access rule, unchanged: the order's unguessable id is the credential (see getShopOrderReceiptData).
//   seller:   the Shop dashboard's own rule: signed-in OWNER of a profile for which the Shop section is visible (shopIsVisibleFor), AND
//             the order belongs to that profile (an owner-scoped, row-level-security read). Anything else is a plain 404.
// Neither writes anything. Both render the SAME data the receipt page shows, with the shared PDF foundation.
import { getShopOrderReceiptData } from "@/lib/productCheckout/receipt";
import { createClient } from "@/lib/supabase/server";
import { shopIsVisibleFor } from "@/lib/shopAuth";
import { renderShopReceiptPdf, parseReceiptLocale, shopReceiptEligible, shopReceiptFilename } from "./render";
import { isUuid } from "@/lib/documents/validation";

const HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
} as const;

const json = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { ...HEADERS, "Content-Type": "application/json" } });

async function pdfFor(orderId: string, lang: string | null, check?: (data: { sellerUsername: string }) => boolean): Promise<Response> {
  if (!isUuid(orderId)) return json(404, "order_not_found");
  let data;
  try {
    data = await getShopOrderReceiptData(orderId);
  } catch {
    return json(500, "receipt_unavailable");
  }
  if (!data || (check && !check(data))) return json(404, "order_not_found");
  if (!shopReceiptEligible(data)) return json(409, "receipt_not_available");
  try {
    const bytes = await renderShopReceiptPdf(data, parseReceiptLocale(lang));
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: { ...HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${shopReceiptFilename(data)}"` },
    });
  } catch (e) {
    console.error("shop receipt pdf: render failed:", e);
    return json(500, "pdf_failed");
  }
}

export async function customerReceiptPdf(orderId: string, lang: string | null): Promise<Response> {
  return pdfFor(orderId, lang);
}

export async function sellerReceiptPdf(orderId: string, lang: string | null): Promise<Response> {
  if (!isUuid(orderId)) return json(404, "order_not_found");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, "not_signed_in");
  const { data: profile } = await supabase.from("profiles").select("*").eq("user_id", user.id).single();
  if (!profile) return json(404, "order_not_found");
  if (!(await shopIsVisibleFor(supabase, profile))) return json(404, "order_not_found");
  // Ownership, proven by the owner-scoped (RLS) read plus an explicit profile filter, exactly as the seller order page does.
  const owned = await supabase.from("product_orders").select("id").eq("id", orderId).eq("profile_id", (profile as any).id).maybeSingle();
  if (owned.error || !owned.data) return json(404, "order_not_found");
  return pdfFor(orderId, lang, (d) => d.sellerUsername === (profile as any).username);
}
