// Universal Customer Action resolver. Pure and dependency-free by design:
// no imports of any kind (not cta.ts, Supabase, Next, React or fetch), no I/O,
// no side effects, never mutates its input. scripts/tests/customerAction.test.mjs
// enforces that.
//
//   DISPLAY CTA → UNIVERSAL ACTION → CAPABILITY RESOLVER → DESTINATION → workflow
//
// This module decides WHERE a customer action goes. It never decides what
// happens once they arrive: authorization, identity, prices, stock, booking
// rules, payment execution, order creation and ticket availability all stay
// in the destination workflow. `paymentMode` is descriptive metadata about
// that workflow — REQUIRED never means this module starts, changes or
// replaces a payment (music payment, in particular, stays entirely in the
// existing music code).
//
// The CTA is passed in structurally ({ action, explicit, presetId }) so the
// CTA engine can call this without either module depending on the other's
// types. Mapping from the CTA engine's `CtaAction` values (unchanged) to the
// universal model:
//   purchase→PURCHASE  order→ORDER  booking→BOOKING  viewing→BOOKING(viewing)
//   ticket→TICKET  quote→QUOTE  register→REGISTER  info→INFORMATION
// CONTACT, CHAT and EXTERNAL are resolver-side values with no CTA action yet.
// An unrecognised action string maps to INFORMATION, which has no capability
// route, so it can never produce a workflow destination.

export type UniversalAction =
  | "PURCHASE"
  | "ORDER"
  | "BOOKING"
  | "TICKET"
  | "QUOTE"
  | "REGISTER"
  | "CONTACT"
  | "CHAT"
  | "EXTERNAL"
  | "INFORMATION";

export type OfferingSource = "product" | "menu_item" | "track" | "release" | "event";
export type OfferingStatus = "available" | "sold_out" | "unavailable" | "coming_soon" | "closed";

export type CustomerDestination =
  | "external_link"
  | "music_storefront"
  | "restaurant_order_page"
  | "booking_page"
  | "ticket_flow"
  | "whatsapp"
  | "quote_form"
  | "chat"
  | "product_checkout"
  | "none";

// creator_link = the item's own configured link (today's products.landing_url,
// a legacy fallback — deliberately NOT an explicit "external action");
// native = a Ringo workflow; none = nowhere to go.
export type DestinationOrigin = "creator_link" | "native" | "none";

export type PaymentMode = "NONE" | "OPTIONAL" | "REQUIRED";

export type UnavailableReason =
  | "sold_out"
  | "unavailable"
  | "coming_soon"
  | "closed"
  | "capability_disabled"
  | "demo_profile"
  | "currency_unsupported";

export interface CustomerActionInput {
  cta: {
    // The CTA engine's action string (see mapping above).
    action: string;
    // True only when the creator explicitly chose a preset or custom label.
    // Native capability routes are offered only for explicit choices, so an
    // item nobody has configured keeps exactly today's behavior.
    explicit: boolean;
    presetId?: string | null;
  };
  source: OfferingSource;
  // e.g. a music release's "ep" / "album". Wins over the preset-derived subtype.
  sourceSubtype?: string | null;
  // Defaults to "available".
  status?: OfferingStatus;
  // The item has its own configured link.
  hasLandingUrl: boolean;
  profile: {
    // Reserved: routing never branches on category (the CTA action already
    // encodes it).
    category?: string | null;
    currency?: string | null;
    isDemo?: boolean;
    isMusic?: boolean;
    capabilities?: {
      bookingsEnabled?: boolean;
      // Restaurant profile with ordering turned on (computed by the caller).
      restaurantOrdering?: boolean;
      hasWhatsapp?: boolean;
      hasTicketing?: boolean;
      // Future workflows — all default to off.
      quotesEnabled?: boolean;
      chatEnabled?: boolean;
      onlineCheckoutEnabled?: boolean;
    };
  };
}

export interface ResolvedCustomerAction {
  action: UniversalAction;
  subtype: string | null;
  destination: CustomerDestination;
  destinationOrigin: DestinationOrigin;
  paymentMode: PaymentMode;
  // false when the offering's status, or a capability the action needs, rules
  // the action out. true with destination "none" just means nothing applies.
  available: boolean;
  reason: UnavailableReason | null;
}

const ACTION_MAP: Record<string, UniversalAction> = {
  purchase: "PURCHASE",
  order: "ORDER",
  booking: "BOOKING",
  viewing: "BOOKING",
  ticket: "TICKET",
  quote: "QUOTE",
  register: "REGISTER",
  info: "INFORMATION",
  contact: "CONTACT",
  chat: "CHAT",
  external: "EXTERNAL",
};

export function toUniversalAction(action: string): UniversalAction {
  return typeof action === "string" && Object.prototype.hasOwnProperty.call(ACTION_MAP, action)
    ? ACTION_MAP[action]
    : "INFORMATION";
}

// Subtype is contextual metadata derived from the preset id's shape — never
// stored, and there is no per-preset table, so new presets need no change here:
//   <verb>_<noun…>  →  noun, minus filler words and a trailing noun that just
//   names the action. Anything not shaped like that yields null.
const VERBS = new Set([
  "book", "buy", "request", "reserve", "get", "schedule", "order", "place", "shop", "view", "learn",
  "enroll", "register", "join", "become", "send", "contact", "make", "use", "gift", "renew", "redeem",
]);
const FILLER = new Set(["a", "an", "the", "your", "now", "more", "yours", "spot", "details"]);

const singular = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

export function deriveSubtype(presetId: string | null | undefined, action: UniversalAction): string | null {
  if (typeof presetId !== "string" || !presetId) return null;
  const tokens = presetId.toLowerCase().split("_");
  if (!VERBS.has(tokens[0])) return null;
  const rest = tokens.slice(1).filter((t) => t && !FILLER.has(t));
  if (rest.length > 0 && singular(rest[rest.length - 1]) === action.toLowerCase()) rest.pop();
  return rest.length > 0 ? rest.join("_") : null;
}

// Descriptive only. REQUIRED = the existing destination workflow requires
// payment; this module never initiates, alters or gates it. OPTIONAL is
// reserved for future restaurant/booking payment phases and is not emitted yet.
const PAYMENT_MODE: Record<CustomerDestination, PaymentMode> = {
  music_storefront: "REQUIRED",
  ticket_flow: "REQUIRED",
  product_checkout: "REQUIRED",
  external_link: "NONE",
  restaurant_order_page: "NONE",
  booking_page: "NONE",
  whatsapp: "NONE",
  quote_form: "NONE",
  chat: "NONE",
  none: "NONE",
};

export function resolveCustomerAction(input: CustomerActionInput): ResolvedCustomerAction {
  const action = toUniversalAction(input.cta?.action);
  const subtype = input.sourceSubtype || deriveSubtype(input.cta?.presetId, action) || (input.cta?.action === "viewing" ? "viewing" : null);
  const base = { action, subtype };

  const done = (destination: CustomerDestination, destinationOrigin: DestinationOrigin): ResolvedCustomerAction => ({
    ...base,
    destination,
    destinationOrigin,
    paymentMode: PAYMENT_MODE[destination],
    available: true,
    reason: null,
  });
  const blocked = (reason: UnavailableReason): ResolvedCustomerAction => ({
    ...base,
    destination: "none",
    destinationOrigin: "none",
    paymentMode: "NONE",
    available: false,
    reason,
  });

  // 1. STATUS ALWAYS WINS — before any link, workflow or payment destination.
  const status = input.status ?? "available";
  if (status !== "available") return blocked(status);

  const profile = input.profile ?? {};
  const caps = profile.capabilities ?? {};

  // 2. The item's own link (today's products.landing_url) beats every native
  //    route, for every action — exactly the current behavior.
  if (input.hasLandingUrl) return done("external_link", "creator_link");

  // 3. Existing specialized workflows own their own surfaces.
  if (input.source === "event" && caps.hasTicketing) return done("ticket_flow", "native");
  if (profile.isMusic || input.source === "track" || input.source === "release") {
    return done("music_storefront", "native");
  }

  // 4. Capability routes — only for an explicit creator choice, so an
  //    unconfigured (NULL/NULL) item never gains a new destination.
  if (input.cta?.explicit) {
    switch (action) {
      case "BOOKING":
        return caps.bookingsEnabled ? done("booking_page", "native") : blocked("capability_disabled");
      case "ORDER":
        return caps.restaurantOrdering ? done("restaurant_order_page", "native") : blocked("capability_disabled");
      case "QUOTE":
        return caps.quotesEnabled ? done("quote_form", "native") : blocked("capability_disabled");
      case "CHAT":
        return caps.chatEnabled ? done("chat", "native") : blocked("capability_disabled");
      case "CONTACT":
        return caps.hasWhatsapp ? done("whatsapp", "native") : blocked("capability_disabled");
      case "PURCHASE":
        if (!caps.onlineCheckoutEnabled) return blocked("capability_disabled");
        if (profile.isDemo) return blocked("demo_profile");
        if ((profile.currency || "USD") !== "XAF") return blocked("currency_unsupported");
        return done("product_checkout", "native");
      default:
        break; // TICKET (non-event), REGISTER, EXTERNAL, INFORMATION: no route
    }
  }

  return done("none", "none");
}
