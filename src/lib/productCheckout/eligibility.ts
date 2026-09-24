// Application-level eligibility for product checkout. Pure. This mirrors the gates inside
// create_product_order() on purpose (defence in depth): it lets the API answer with a stable code
// before touching stock, while the database function stays the authority.

import { SUPPORTED_CURRENCY } from "./constants";
import type { CheckoutErrorCode } from "./errors";
import { isWholeAmount, toCents } from "./money";
import type { CommerceSettings, OrderRow, ProductRow, ProfileRow } from "./types";

export const profileCurrency = (profile: Pick<ProfileRow, "currency">): string =>
  (profile.currency && profile.currency.trim() ? profile.currency.trim() : "USD").toUpperCase();

export const isMusicProfile = (profile: Pick<ProfileRow, "category" | "categories">): boolean =>
  profile.category === "music_entertainment" || !!profile.categories?.includes("music_entertainment");

function platformAndProfileGate(settings: CommerceSettings, profile: ProfileRow | null): CheckoutErrorCode | null {
  if (!settings.commerceEnabled || settings.commissionRate === null || settings.commissionRate === undefined) return "commerce_disabled";
  if (!settings.fapshiEnabled) return "payment_provider_unavailable";
  if (!profile || !profile.published || profile.is_demo) return "profile_unavailable";
  if (isMusicProfile(profile)) return "music_profile_not_supported";
  return null;
}

/** Can a NEW order be created for this product and quantity? */
export function checkCommerceEligibility(input: {
  settings: CommerceSettings;
  profile: ProfileRow | null;
  product: ProductRow | null;
  quantity: number;
}): CheckoutErrorCode | null {
  const { settings, profile, product, quantity } = input;
  const gate = platformAndProfileGate(settings, profile);
  if (gate) return gate;
  if (profileCurrency(profile as ProfileRow) !== SUPPORTED_CURRENCY) return "commerce_currency_unsupported";

  if (!product || product.profile_id !== profile!.id) return "product_unavailable";
  if (product.available === false) return "product_unavailable";
  if (!product.name || !product.name.trim()) return "product_unavailable";
  const priceCents = toCents(product.price);
  if (priceCents === null || priceCents <= 0) return "product_unavailable";
  if (!isWholeAmount((priceCents * quantity) / 100)) return "product_price_unsupported"; // Fapshi moves whole XAF
  if (product.inventory_count !== null && product.inventory_count !== undefined && product.inventory_count < quantity) return "insufficient_stock";
  return null;
}

/** May a payment be started for this EXISTING order right now (settings/profile/currency/amount)? */
export function checkPaymentEligibility(input: {
  settings: CommerceSettings;
  profile: ProfileRow | null;
  order: OrderRow;
}): CheckoutErrorCode | null {
  const { settings, profile, order } = input;
  const gate = platformAndProfileGate(settings, profile);
  if (gate) return gate;
  if (order.currency !== SUPPORTED_CURRENCY || profileCurrency(profile as ProfileRow) !== SUPPORTED_CURRENCY) return "commerce_currency_unsupported";
  if (profile!.id !== order.profile_id) return "order_not_payable";
  if (!isWholeAmount(order.total)) return "payment_amount_invalid";
  return null;
}
