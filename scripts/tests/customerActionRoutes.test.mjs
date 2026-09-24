// Phase 3 checks: resolved destination → existing Ringo workflow (src/lib/customerActionRoutes.ts),
// the restaurant order-page route through the CTA engine (src/lib/cta.ts), and the guarantee that no
// unresolved / unsupported destination is ever redirected to WhatsApp. No network, no database.
//   Run:  node scripts/tests/customerActionRoutes.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const routes = jiti(path.join(REPO, "src/lib/customerActionRoutes.ts"));
const cta = jiti(path.join(REPO, "src/lib/cta.ts"));
const R = jiti(path.join(REPO, "src/lib/customerAction.ts"));
const { CATEGORIES, profileHasCategory } = jiti(path.join(REPO, "src/lib/categories.ts"));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const ctx = { username: "chez-ali", productId: "p-1", landingUrl: "https://shop.example/x" };
const eng = (over) => cta.resolveProductCta({ category: "restaurant_food", isMusic: false, hasLandingUrl: false, bookingEnabled: false, restaurantOrdering: true, ctaPreset: "order_now", ctaLabel: null, ...over });

// ---------------------------------------------------------------- routes map (destination → existing workflow)
check("external → the item's own link, opens outside Ringo", JSON.stringify(routes.customerActionRoute("external", ctx)) === JSON.stringify({ href: "https://shop.example/x", external: true }));
check("external_link (resolver name) → same", routes.customerActionRoute("external_link", ctx)?.href === "https://shop.example/x");
check("external without a link → no route", routes.customerActionRoute("external", { ...ctx, landingUrl: null }) === null && routes.customerActionRoute("external", { ...ctx, landingUrl: "" }) === null);
check("music_storefront → existing storefront handoff", JSON.stringify(routes.customerActionRoute("music_storefront", ctx)) === JSON.stringify({ href: "/m/chez-ali?add=merch:p-1", external: false }));
check("booking_page → existing booking form", JSON.stringify(routes.customerActionRoute("booking_page", ctx)) === JSON.stringify({ href: "/chez-ali/book", external: false }));
check("restaurant_order_page → existing restaurant order page (page, not a product)", JSON.stringify(routes.customerActionRoute("restaurant_order_page", ctx)) === JSON.stringify({ href: "/r/chez-ali", external: false }));
check("product_checkout → the generic product checkout page (a Ringo page)", JSON.stringify(routes.customerActionRoute("product_checkout", ctx)) === JSON.stringify({ href: "/chez-ali/item/p-1/checkout", external: false }));
for (const d of ["ticket_flow", "quote_form", "chat", "whatsapp", "none", "", "toString", "__proto__", "anything-else"]) {
  check(`unsupported destination "${d}" → no route (never WhatsApp)`, routes.customerActionRoute(d, ctx) === null);
}
{
  const src = fs.readFileSync(path.join(REPO, "src/lib/customerActionRoutes.ts"), "utf8");
  check("routes map has no import statements", !/^\s*import\s/m.test(src));
  check("routes map never builds a wa.me / WhatsApp URL", !/wa\.me|api\.whatsapp|whatsapp:/i.test(src.replace(/\/\/.*$/gm, "")));
}

// ---------------------------------------------------------------- restaurant ordering through the CTA engine
check("restaurant + ordering on + explicit order, no link → restaurant_order_page", eng({}).destination === "restaurant_order_page");
check("custom label counts as explicit", eng({ ctaPreset: null, ctaLabel: "Commander ici" }).destination === "restaurant_order_page");
check("ordering disabled → no destination", eng({ restaurantOrdering: false }).destination === "none");
check("restaurantOrdering omitted (old callers) → no destination", eng({ restaurantOrdering: undefined }).destination === "none");
check("NULL/NULL restaurant product → unchanged (no destination, no label)", (() => { const o = eng({ ctaPreset: null, ctaLabel: null }); return o.destination === "none" && o.label === null; })());
check("landing URL still wins over the order page", eng({ hasLandingUrl: true }).destination === "external");
check("music profile still wins", eng({ isMusic: true, category: "music_entertainment" }).destination === "music_storefront");
check("a non-order action never routes to the order page", ["book_now", "request_quote", "get_tickets", "enroll_now", "buy_now", "learn_more"].every((ctaPreset) => eng({ ctaPreset, category: "restaurant_food" }).destination !== "restaurant_order_page"));
{
  // The capability the item page and the editor compute: restaurant profile (primary OR extra category), ordering not switched off.
  const ordering = (p) => profileHasCategory(p, "restaurant_food") && p.ordering_enabled !== false;
  check("capability: restaurant, ordering default (null/undefined) → on", ordering({ category: "restaurant_food" }) && ordering({ category: "restaurant_food", ordering_enabled: null }) && ordering({ category: "restaurant_food", ordering_enabled: true }));
  check("capability: restaurant as an extra category → on", ordering({ category: "music_entertainment", categories: ["music_entertainment", "restaurant_food"] }));
  check("capability: ordering_enabled = false → off", !ordering({ category: "restaurant_food", ordering_enabled: false }));
  check("capability: non-restaurant categories never route to restaurant ordering", CATEGORIES.filter((c) => c.id !== "restaurant_food").every((c) => !ordering({ category: c.id, categories: [c.id] })));
  const pdv = fs.readFileSync(path.join(REPO, "src/components/catalog/ProductDetailView.tsx"), "utf8");
  const card = fs.readFileSync(path.join(REPO, "src/components/editor/CatalogCard.tsx"), "utf8");
  check("item page computes exactly that capability", pdv.includes('profileHasCategory(profile, "restaurant_food") && profile.ordering_enabled !== false'));
  check("editor computes exactly that capability", card.includes('profileHasCategory(draft, "restaurant_food") && draft.ordering_enabled !== false'));
  check("item page checks sold out before any route", /const route = soldOut \? null : customerActionRoute\(/.test(pdv));
}

// ---------------------------------------------------------------- booking (Phase 2 behavior intact)
{
  const b = (over) => cta.resolveProductCta({ category: "beauty_wellness", isMusic: false, hasLandingUrl: false, bookingEnabled: true, ctaPreset: "book_now", ctaLabel: null, ...over });
  check("booking: explicit + bookings on → booking page", b({}).destination === "booking_page");
  check("booking: bookings disabled → no destination", b({ bookingEnabled: false }).destination === "none");
  check("booking: landing URL precedence", b({ hasLandingUrl: true }).destination === "external");
  check("booking: NULL/NULL unchanged", (() => { const o = b({ ctaPreset: null, ctaLabel: null }); return o.destination === "none" && o.label === null; })());
  for (const ctaPreset of ["book_consultation", "book_appointment", "book_treatment", "reserve_now", "request_booking", "book_tour"]) {
    check(`booking: ${ctaPreset} → booking page`, b({ ctaPreset }).destination === "booking_page");
  }
  const rv = (over) => cta.resolveProductCta({ category: "real_estate", isMusic: false, hasLandingUrl: false, bookingEnabled: true, ctaPreset: "request_viewing", ctaLabel: null, ...over });
  check("real-estate viewing → booking page", rv({}).destination === "booking_page" && rv({}).action === "viewing");
  check("real-estate book_viewing → booking page", rv({ ctaPreset: "book_viewing" }).destination === "booking_page");
  check("real-estate viewing, bookings off → none", rv({ bookingEnabled: false }).destination === "none");
  check("real-estate viewing, landing URL wins", rv({ hasLandingUrl: true }).destination === "external");
}

// ---------------------------------------------------------------- music + tickets
{
  const m = cta.resolveProductCta({ category: "music_entertainment", isMusic: true, hasLandingUrl: false, bookingEnabled: true, restaurantOrdering: true, ctaPreset: "buy_now", ctaLabel: null });
  check("music purchase → storefront (never booking / restaurant)", m.destination === "music_storefront");
  const mr = R.resolveCustomerAction({ cta: { action: "purchase", explicit: false }, source: "product", hasLandingUrl: false, profile: { isMusic: true } });
  check("music purchase payment mode stays REQUIRED (existing music payment)", mr.destination === "music_storefront" && mr.paymentMode === "REQUIRED");
  const tk = R.resolveCustomerAction({ cta: { action: "ticket", explicit: false }, source: "event", hasLandingUrl: false, profile: { isMusic: true, capabilities: { hasTicketing: true } } });
  check("event ticket → ticket_flow, payment REQUIRED", tk.destination === "ticket_flow" && tk.paymentMode === "REQUIRED");
  check("ticket_flow has no product route (existing ticket pages own it; no new checkout)", routes.customerActionRoute("ticket_flow", ctx) === null);
  for (const category of ["events_experiences", "music_entertainment", null]) {
    const p = cta.resolveProductCta({ category, isMusic: false, hasLandingUrl: false, bookingEnabled: true, restaurantOrdering: true, ctaPreset: "get_tickets", ctaLabel: null });
    check(`product-source TICKET (${category}) never becomes a checkout / route`, p.destination === "none");
  }
}

// ---------------------------------------------------------------- unsupported destinations never open WhatsApp
{
  const flags = { hasWhatsapp: true, bookingsEnabled: false, restaurantOrdering: false, hasTicketing: false, quotesEnabled: false, chatEnabled: false, onlineCheckoutEnabled: false };
  for (const action of ["quote", "chat", "purchase", "ticket", "register", "order", "booking"]) {
    const x = R.resolveCustomerAction({ cta: { action, explicit: true }, source: "product", hasLandingUrl: false, profile: { currency: "XAF", capabilities: flags } });
    check(`${action} with nothing native on + WhatsApp number → not WhatsApp, no route`, x.destination !== "whatsapp" && routes.customerActionRoute(x.destination, ctx) === null, JSON.stringify(x));
  }
  for (const action of ["quote", "chat"]) {
    const enabled = R.resolveCustomerAction({ cta: { action, explicit: true }, source: "product", hasLandingUrl: false, profile: { currency: "XAF", capabilities: { ...flags, quotesEnabled: true, chatEnabled: true, onlineCheckoutEnabled: true } } });
    check(`${action}: even if a future workflow resolves, the product page has no route for it`, routes.customerActionRoute(enabled.destination, ctx) === null, enabled.destination);
  }
  {
    // purchase is the one that now has a real destination — and only when checkout is available
    const enabled = R.resolveCustomerAction({ cta: { action: "purchase", explicit: true }, source: "product", hasLandingUrl: false, profile: { currency: "XAF", capabilities: { ...flags, onlineCheckoutEnabled: true } } });
    check("purchase + checkout available → product_checkout with its own route", enabled.destination === "product_checkout" && routes.customerActionRoute(enabled.destination, ctx)?.href === "/chez-ali/item/p-1/checkout");
    const off = R.resolveCustomerAction({ cta: { action: "purchase", explicit: true }, source: "product", hasLandingUrl: false, profile: { currency: "XAF", capabilities: { ...flags, onlineCheckoutEnabled: false } } });
    check("purchase + checkout NOT available → no route, and never WhatsApp", off.destination === "none" && routes.customerActionRoute(off.destination, ctx) === null);
  }
  for (const category of ["freelancers_creators", "construction_home_services", "business_ecommerce", null]) {
    const p = cta.resolveProductCta({ category, isMusic: false, hasLandingUrl: false, bookingEnabled: false, restaurantOrdering: false, hasWhatsapp: true, ctaPreset: null, ctaLabel: "Custom" });
    check(`engine (${category}) ignores a WhatsApp number`, p.destination === "none");
  }
  const pdv = fs.readFileSync(path.join(REPO, "src/components/catalog/ProductDetailView.tsx"), "utf8");
  const ctaSrc = fs.readFileSync(path.join(REPO, "src/lib/cta.ts"), "utf8");
  check("item page has no WhatsApp-as-CTA branch", !/destination === "whatsapp"|primaryIsWhatsapp|hasWhatsapp/.test(pdv));
  check("cta.ts has no WhatsApp input or destination", !/hasWhatsapp|"whatsapp"/.test(ctaSrc));
}

// ---------------------------------------------------------------- status is authoritative
for (const status of ["sold_out", "unavailable", "coming_soon", "closed"]) {
  for (const [action, caps] of [["booking", { bookingsEnabled: true }], ["order", { restaurantOrdering: true }], ["purchase", {}], ["ticket", { hasTicketing: true }]]) {
    const x = R.resolveCustomerAction({ cta: { action, explicit: true }, source: action === "ticket" ? "event" : "product", status, hasLandingUrl: true, profile: { isMusic: action === "purchase", capabilities: caps } });
    check(`${status}: ${action} → unavailable, no destination, no route, no payment`, x.available === false && x.destination === "none" && x.paymentMode === "NONE" && routes.customerActionRoute(x.destination, ctx) === null);
  }
}

// ---------------------------------------------------------------- exhaustive: only the intended destinations, only in the intended cases
{
  const allowed = ["external", "music_storefront", "booking_page", "restaurant_order_page", "none"];
  let combos = 0, outside = 0, wrongOrder = 0;
  const legacy = (i) => {
    const custom = cta.normalizeCtaLabel(i.ctaLabel);
    const preset = cta.isCtaPresetId(i.ctaPreset) ? i.ctaPreset : null;
    const label = custom || preset;
    const action = preset ? cta.CTA_PRESETS[preset] : cta.getRecommendedCta(i.category).action;
    if (i.hasLandingUrl) return "external";
    if (i.isMusic) return "music_storefront";
    if (label && (action === "booking" || action === "viewing") && i.bookingEnabled) return "booking_page";
    return "none";
  };
  let differOnlyByOrder = true;
  for (const category of [null, ...CATEGORIES.map((c) => c.id)]) for (const hasLandingUrl of [false, true]) for (const isMusic of [false, true]) for (const bookingEnabled of [false, true]) for (const restaurantOrdering of [false, true])
    for (const ctaPreset of [null, "bogus", ...Object.keys(cta.CTA_PRESETS)]) for (const ctaLabel of [null, "Custom"]) {
      const i = { category, hasLandingUrl, isMusic, bookingEnabled, restaurantOrdering, ctaPreset, ctaLabel };
      const o = cta.resolveProductCta(i);
      combos++;
      if (!allowed.includes(o.destination)) outside++;
      if (o.destination === "restaurant_order_page" && !(o.action === "order" && o.label && restaurantOrdering && !hasLandingUrl && !isMusic)) wrongOrder++;
      const before = legacy(i);
      if (o.destination !== before && !(o.destination === "restaurant_order_page" && before === "none")) differOnlyByOrder = false;
    }
  check(`engine destinations are only external / music_storefront / booking_page / restaurant_order_page / none (${combos} combos)`, outside === 0, String(outside));
  check("restaurant_order_page only for an explicit order action, ordering on, no link, not music", wrongOrder === 0, String(wrongOrder));
  check("parity with Phase 1–2: the ONLY new destination is restaurant_order_page (order action, otherwise none)", differOnlyByOrder);
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
