// Application-level eligibility for Ringo Protection checkout. Pure. Deliberately mirrors (rather
// than imports) productCheckout/eligibility.ts's platform/profile gate — defence in depth, same
// reasoning that file already uses against create_product_order() — plus Protection's own two extra
// gates (protection_enabled, a configured fee rate). Protection can never be available where Normal
// Payment itself would already be blocked: it is charged through the same Fapshi collection service.

import type { ProtectionCheckoutErrorCode } from "./checkoutErrors";
import type { ProtectionOrderRow, ProtectionProfileRow, ProtectionSettingsView } from "./checkoutTypes";

export interface ProtectionCommerceSettings {
  commerceEnabled: boolean;
  fapshiEnabled: boolean;
}

const SUPPORTED_CURRENCY = "XAF";
const isMusicProfile = (p: Pick<ProtectionProfileRow, "category" | "categories">) =>
  p.category === "music_entertainment" || !!p.categories?.includes("music_entertainment");

/** May a NEW Protection transaction be created for this existing, unpaid order right now? */
export function checkProtectionEligibility(input: {
  protection: ProtectionSettingsView;
  commerce: ProtectionCommerceSettings;
  profile: ProtectionProfileRow | null;
  order: ProtectionOrderRow;
}): ProtectionCheckoutErrorCode | null {
  const { protection, commerce, profile, order } = input;
  if (!protection.protectionEnabled) return "protection_disabled";
  if (protection.protectionFeeRate === null) return "protection_not_configured";
  if (!commerce.commerceEnabled) return "protection_disabled";
  if (!commerce.fapshiEnabled) return "payment_provider_unavailable";
  if (!profile || !profile.published || profile.is_demo) return "order_not_payable";
  if (isMusicProfile(profile)) return "order_not_payable";
  if (profile.id !== order.profile_id) return "order_not_payable";
  const currency = (profile.currency && profile.currency.trim() ? profile.currency.trim() : "USD").toUpperCase();
  if (currency !== SUPPORTED_CURRENCY || order.currency !== SUPPORTED_CURRENCY) return "order_not_payable";
  return null;
}
