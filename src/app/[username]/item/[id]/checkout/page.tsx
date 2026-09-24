import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { profileHasCategory } from "@/lib/categories";
import { getCustomerFromCookie } from "@/lib/customer/session";
import ProductCheckout from "@/components/checkout/ProductCheckout";
import { productImages } from "@/components/catalog/productHref";
import { getCheckoutBlock } from "@/lib/productCheckout/availability";
import { MAX_QUANTITY } from "@/lib/productCheckout/constants";
import { isUuid } from "@/lib/productCheckout/validation";
import { LOW_INVENTORY_THRESHOLD } from "@/lib/ticketTypes";

// The customer checkout for a catalogue product (V1: single product, Fapshi Mobile Money, XAF).
// Server component: it loads the profile + product, asks the SAME eligibility rules the order API
// enforces whether checkout is possible, and hands the client only what it needs to display. Prices,
// totals, stock and payment status are always decided by the backend; nothing here is authoritative.
export const dynamic = "force-dynamic";

async function getItem(username: string, id: string) {
  const supabase = createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*, products(*)")
    .eq("username", username)
    .eq("published", true)
    .single();
  if (!profile) return null;
  const product = (profile.products || []).find((p: any) => p.id === id);
  if (!product) return null;
  return { profile, product };
}

export async function generateMetadata({ params }: { params: { username: string; id: string } }): Promise<Metadata> {
  const found = await getItem(params.username, params.id);
  if (!found) return { robots: { index: false, follow: false } };
  return { title: `${found.product.name} — ${found.profile.name || found.profile.username}`, robots: { index: false, follow: false } };
}

export default async function ProductCheckoutRoute({
  params,
  searchParams,
}: {
  params: { username: string; id: string };
  searchParams: { order?: string };
}) {
  const found = await getItem(params.username, params.id);
  if (!found) return notFound();
  const { profile, product } = found;
  // Music & Entertainment keeps its own storefront checkout; this lane never serves it.
  if (profileHasCategory(profile, "music_entertainment")) return notFound();

  // Returning to an order (refresh, or a receipt link) must still work even if checkout has since
  // been switched off, so the block only applies to starting a NEW checkout.
  const orderId = typeof searchParams?.order === "string" && isUuid(searchParams.order) ? searchParams.order : null;
  const block = await getCheckoutBlock(profile, product, 1);

  // A signed-in Ringo customer's own details, to prefill their own form. Guests are unaffected.
  const session = await getCustomerFromCookie();

  const stock: number | null = typeof product.inventory_count === "number" ? product.inventory_count : null;
  const price = Number(product.price);

  return (
    <ProductCheckout
      product={{
        id: product.id,
        name: product.name || "",
        description: product.description || null,
        image: productImages(product)[0] || null,
        unitPrice: Number.isFinite(price) ? price : 0,
        currency: profile.currency || "XAF",
        maxQuantity: Math.max(1, Math.min(MAX_QUANTITY, stock === null ? MAX_QUANTITY : stock)),
        lowStock: stock !== null && stock > 0 && stock <= LOW_INVENTORY_THRESHOLD ? stock : null,
      }}
      seller={{ name: profile.name || profile.username, username: profile.username }}
      theme={{
        accent: profile.theme_color || "#D4A954",
        bg: profile.background_color || "#0A0A0A",
        fg: profile.text_color || "#FAFAFA",
      }}
      productHref={`/${profile.username}/item/${product.id}`}
      sellerHref={`/${profile.username}`}
      prefill={session ? { name: session.customer.name, phone: session.customer.phone, email: session.customer.email } : undefined}
      initialOrderId={orderId}
      unavailableCode={orderId ? null : block}
    />
  );
}
