// Universal Smart CTA for catalogue products. Deterministic, no I/O, no AI.
//
// Three concepts are kept strictly apart:
//   ACTION       what the button means (purchase, booking…) — from the category
//                or from the preset the creator explicitly chose.
//   LABEL        the words on the button — a preset id (translated via
//                t.cta.labels) or the creator's own text. Presentation only.
//   DESTINATION  where a tap goes — derived from what the item really can do
//                (its own link, the music storefront, the booking page), NEVER
//                from the label. A label can't create, change or bypass one.
//
// products.cta_preset / products.cta_label both NULL means "behave exactly as
// before": resolveProductCta returns label: null and the caller keeps its
// existing wording. The recommendation is only ever applied when the creator
// explicitly picks it in the editor.

import { resolveCustomerAction } from "./customerAction";

export type CtaAction = "purchase" | "order" | "booking" | "ticket" | "quote" | "viewing" | "register" | "info";

// Every preset belongs to exactly one action. To add a wording, add it here
// and to t.cta.labels in both languages (scripts/tests/cta.test.mjs enforces
// parity and that every category list stays within one action).
export const CTA_PRESETS = {
  buy_now: "purchase",
  shop_now: "purchase",
  get_yours: "purchase",
  order_now: "order",
  place_order: "order",
  book_now: "booking",
  reserve_now: "booking",
  request_booking: "booking",
  book_appointment: "booking",
  book_consultation: "booking",
  book_treatment: "booking",
  book_ticket: "booking",
  book_tour: "booking",
  get_tickets: "ticket",
  reserve_spot: "ticket",
  request_quote: "quote",
  get_quote: "quote",
  request_viewing: "viewing",
  book_viewing: "viewing",
  enroll_now: "register",
  register_now: "register",
  view_details: "info",
  learn_more: "info",
} as const satisfies Record<string, CtaAction>;

export type CtaPresetId = keyof typeof CTA_PRESETS;

export const CTA_LABEL_MAX_LENGTH = 30;

// First entry is Ringo's recommendation; the rest are the relevant same-action
// alternatives. Categories not listed (and "other"/null) get the informational
// pair, so nothing ever pretends the customer can buy or book.
const CATEGORY_PRESETS: Record<string, CtaPresetId[]> = {
  music_entertainment: ["buy_now", "shop_now", "get_yours"],
  business_ecommerce: ["buy_now", "shop_now", "get_yours"],
  agriculture_agribusiness: ["buy_now", "shop_now", "get_yours"],
  restaurant_food: ["order_now", "place_order"],
  beauty_wellness: ["book_now", "book_treatment", "reserve_now", "request_booking"],
  health_medical: ["book_appointment", "book_consultation", "request_booking"],
  professional_services: ["book_consultation", "book_now", "request_booking"],
  transport_logistics: ["book_now", "book_ticket", "reserve_now", "request_booking"],
  travel_hospitality: ["book_now", "book_tour", "reserve_now", "request_booking"],
  creative_media: ["book_now", "reserve_now", "request_booking"],
  real_estate: ["request_viewing", "book_viewing"],
  events_experiences: ["get_tickets", "reserve_spot"],
  education_training: ["enroll_now", "register_now"],
  freelancers_creators: ["request_quote", "get_quote"],
  construction_home_services: ["request_quote", "get_quote"],
};

const FALLBACK_PRESETS: CtaPresetId[] = ["view_details", "learn_more"];

export function isCtaPresetId(value: unknown): value is CtaPresetId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CTA_PRESETS, value);
}

// Trim, collapse whitespace, cap length by code point. Empty → null.
export function normalizeCtaLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return Array.from(cleaned).slice(0, CTA_LABEL_MAX_LENGTH).join("").trim() || null;
}

export function getRecommendedCta(category: string | null | undefined): {
  action: CtaAction;
  recommended: CtaPresetId;
  alternatives: CtaPresetId[]; // includes the recommended one, first
} {
  const list = (category && CATEGORY_PRESETS[category]) || FALLBACK_PRESETS;
  return { action: CTA_PRESETS[list[0]], recommended: list[0], alternatives: list };
}

export type CtaDestination = "external" | "music_storefront" | "booking_page" | "whatsapp" | "none";

export interface ResolvedProductCta {
  action: CtaAction;
  destination: CtaDestination;
  // null = no creator choice: the caller keeps its existing wording.
  label: { kind: "custom"; text: string } | { kind: "preset"; id: CtaPresetId } | null;
}

export function resolveProductCta(input: {
  category?: string | null;
  isMusic: boolean;
  hasLandingUrl: boolean;
  bookingEnabled: boolean;
  // The profile has a WhatsApp number — the existing way to act on an offering
  // that has no link and no native workflow switched on.
  hasWhatsapp?: boolean;
  ctaPreset?: string | null;
  ctaLabel?: string | null;
}): ResolvedProductCta {
  const custom = normalizeCtaLabel(input.ctaLabel);
  const preset = isCtaPresetId(input.ctaPreset) ? input.ctaPreset : null; // unknown ids fall back safely
  const label: ResolvedProductCta["label"] = custom
    ? { kind: "custom", text: custom }
    : preset
    ? { kind: "preset", id: preset }
    : null;

  const action = preset ? CTA_PRESETS[preset] : getRecommendedCta(input.category).action;

  // Destination depends only on what the item can really do, and is decided by
  // the universal resolver (src/lib/customerAction.ts): the item's own link
  // wins, then the music storefront, then the booking page — the latter only
  // for a booking- or viewing-type button the creator explicitly chose, and
  // only when the profile actually has bookings on. Resolver destinations this
  // product page doesn't render yet map to "none" (no button, as before).
  const resolved = resolveCustomerAction({
    cta: { action, explicit: label !== null, presetId: preset },
    source: "product",
    hasLandingUrl: input.hasLandingUrl,
    profile: { isMusic: input.isMusic, capabilities: { bookingsEnabled: input.bookingEnabled, hasWhatsapp: !!input.hasWhatsapp } },
  });
  const destination: CtaDestination =
    resolved.destination === "external_link"
      ? "external"
      : resolved.destination === "music_storefront" || resolved.destination === "booking_page" || resolved.destination === "whatsapp"
      ? resolved.destination
      : "none";

  return { action, destination, label };
}
