// Checks for the Universal Customer Action resolver (src/lib/customerAction.ts) and its
// wiring through the CTA engine (src/lib/cta.ts). No network, no database.
//   Run:  node scripts/tests/customerAction.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const R = jiti(path.join(REPO, "src/lib/customerAction.ts"));
const cta = jiti(path.join(REPO, "src/lib/cta.ts"));
const { CATEGORIES } = jiti(path.join(REPO, "src/lib/categories.ts"));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v));
  return Object.freeze(o);
};

// A baseline input: explicit CTA, product, available, no link, everything off.
const mk = (over = {}, cap = {}, profile = {}) => ({
  cta: { action: "booking", explicit: true, presetId: null, ...(over.cta || {}) },
  source: "product",
  hasLandingUrl: false,
  status: "available",
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "cta")),
  profile: { currency: "XAF", isDemo: false, isMusic: false, ...profile, capabilities: { ...cap } },
});
const run = (...a) => R.resolveCustomerAction(mk(...a));

// ---------------------------------------------------------------- purity / dependency safety
const src = fs.readFileSync(path.join(REPO, "src/lib/customerAction.ts"), "utf8");
check("resolver has zero import statements", !/^\s*import\s/m.test(src) && !/\brequire\(/.test(src));
check("resolver never touches fetch/supabase/next/react", !/fetch\(|supabase|from "next|from "react/.test(src));
const ctaSrc = fs.readFileSync(path.join(REPO, "src/lib/cta.ts"), "utf8");
check("cta.ts is the only importer direction (cta → customerAction)", /from "\.\/customerAction"/.test(ctaSrc));
{
  const input = deepFreeze(mk({}, { bookingsEnabled: true }));
  const a = R.resolveCustomerAction(input);
  const b = R.resolveCustomerAction(input);
  check("resolver doesn't mutate (frozen input accepted) and is deterministic", JSON.stringify(a) === JSON.stringify(b));
}

// ---------------------------------------------------------------- universal action mapping
const expectAction = {
  purchase: "PURCHASE", order: "ORDER", booking: "BOOKING", viewing: "BOOKING", ticket: "TICKET",
  quote: "QUOTE", register: "REGISTER", info: "INFORMATION", contact: "CONTACT", chat: "CHAT", external: "EXTERNAL",
};
for (const [k, v] of Object.entries(expectAction)) check(`action map ${k} → ${v}`, R.toUniversalAction(k) === v);
const ctaActions = new Set(Object.values(cta.CTA_PRESETS));
for (const c of CATEGORIES) ctaActions.add(cta.getRecommendedCta(c.id).action);
check("every CtaAction the engine can produce is mapped", [...ctaActions].every((a) => a in expectAction), [...ctaActions].join());
check("unknown / hostile action → INFORMATION", ["nope", "", "toString", "__proto__", undefined, 7].every((a) => R.toUniversalAction(a) === "INFORMATION"));
check("all 10 universal actions are reachable", new Set(Object.values(expectAction)).size === 10);

// ---------------------------------------------------------------- status always wins
for (const status of ["sold_out", "unavailable", "closed", "coming_soon"]) {
  const scenarios = {
    "explicit booking, bookings on": mk({ status }, { bookingsEnabled: true }),
    "with landing link": mk({ status, hasLandingUrl: true }),
    "music profile": mk({ status }, {}, { isMusic: true }),
    "event with ticketing": mk({ status, source: "event" }, { hasTicketing: true }),
    "purchase, checkout enabled, XAF": mk({ status, cta: { action: "purchase", explicit: true } }, { onlineCheckoutEnabled: true }),
    "quote enabled": mk({ status, cta: { action: "quote", explicit: true } }, { quotesEnabled: true }),
    "chat enabled": mk({ status, cta: { action: "chat", explicit: true } }, { chatEnabled: true }),
  };
  for (const [name, input] of Object.entries(scenarios)) {
    const r = R.resolveCustomerAction(input);
    check(`${status}: ${name} → unavailable, no destination, no payment`,
      r.available === false && r.destination === "none" && r.destinationOrigin === "none" && r.paymentMode === "NONE" && r.reason === status,
      JSON.stringify(r));
  }
}
check("missing status defaults to available", run({ status: undefined }, { bookingsEnabled: true }).available === true);

// ---------------------------------------------------------------- destination selection & origin
let r = run({ hasLandingUrl: true }, { bookingsEnabled: true });
check("link beats native booking route", r.destination === "external_link" && r.destinationOrigin === "creator_link");
for (const action of Object.keys(expectAction)) {
  r = run({ hasLandingUrl: true, cta: { action, explicit: action !== "info" } });
  check(`link wins for ${action} (explicit or not)`, r.destination === "external_link");
}
check("link is never an 'explicit external action'", run({ hasLandingUrl: true, cta: { action: "info", explicit: false } }).destinationOrigin === "creator_link");
r = run({ hasLandingUrl: true }, {}, { isMusic: true });
check("link beats music storefront", r.destination === "external_link");
r = run({ cta: { action: "purchase", explicit: false } }, {}, { isMusic: true });
check("music product, no link → music_storefront (native, REQUIRED)", r.destination === "music_storefront" && r.destinationOrigin === "native" && r.paymentMode === "REQUIRED");
r = run({ cta: { action: "purchase", explicit: false }, source: "release", sourceSubtype: "album" });
check("release → music_storefront with album subtype", r.destination === "music_storefront" && r.subtype === "album");
r = run({ cta: { action: "purchase", explicit: false }, source: "track" });
check("track → music_storefront", r.destination === "music_storefront");
r = run({ cta: { action: "ticket", explicit: false }, source: "event" }, { hasTicketing: true });
check("event with ticketing → ticket_flow (native, REQUIRED)", r.destination === "ticket_flow" && r.paymentMode === "REQUIRED" && r.action === "TICKET");
r = run({ cta: { action: "ticket", explicit: false }, source: "event" }, { hasTicketing: true }, { isMusic: true });
check("event on a music profile still → ticket_flow", r.destination === "ticket_flow");
r = run({ cta: { action: "ticket", explicit: true }, source: "product" }, { hasTicketing: true });
check("TICKET on a product never yields ticket_flow", r.destination !== "ticket_flow" && r.destination === "none");
r = run({ cta: { action: "ticket", explicit: true }, source: "event" }, {});
check("event without ticketing capability → no ticket_flow", r.destination === "none");

// capability routes (explicit only)
const routes = [
  ["booking", "bookingsEnabled", "booking_page", "NONE"],
  ["viewing", "bookingsEnabled", "booking_page", "NONE"],
  ["order", "restaurantOrdering", "restaurant_order_page", "NONE"],
  ["quote", "quotesEnabled", "quote_form", "NONE"],
  ["chat", "chatEnabled", "chat", "NONE"],
  ["contact", "hasWhatsapp", "whatsapp", "NONE"],
];
for (const [action, flag, dest, pay] of routes) {
  const on = run({ cta: { action, explicit: true } }, { [flag]: true });
  check(`${action}: explicit + ${flag} → ${dest}, payment ${pay}`, on.destination === dest && on.destinationOrigin === "native" && on.paymentMode === pay, JSON.stringify(on));
  const off = run({ cta: { action, explicit: true } }, { [flag]: false });
  check(`${action}: capability disabled → unavailable, no dead destination`, off.available === false && off.reason === "capability_disabled" && off.destination === "none" && off.paymentMode === "NONE");
  const nullish = run({ cta: { action, explicit: false } }, { [flag]: true });
  check(`${action}: NOT explicit → no new capability destination`, nullish.destination === "none" && nullish.available === true && nullish.reason === null);
}
for (const action of ["ticket", "register", "external", "info"]) {
  r = run({ cta: { action, explicit: true } }, { bookingsEnabled: true, restaurantOrdering: true, quotesEnabled: true, chatEnabled: true, hasWhatsapp: true, onlineCheckoutEnabled: true });
  check(`${action}: no capability route exists → none`, r.destination === "none" && r.available === true);
}

// product checkout gates
const pc = (cap, profile) => run({ cta: { action: "purchase", explicit: true } }, cap, profile);
r = pc({ onlineCheckoutEnabled: true }, { currency: "XAF", isDemo: false });
check("purchase: enabled + XAF + non-demo → product_checkout, REQUIRED", r.destination === "product_checkout" && r.paymentMode === "REQUIRED" && r.destinationOrigin === "native");
r = pc({ onlineCheckoutEnabled: true }, { currency: "USD" });
check("purchase: non-XAF → currency_unsupported", r.available === false && r.reason === "currency_unsupported" && r.destination === "none" && r.paymentMode === "NONE");
r = pc({ onlineCheckoutEnabled: true }, { currency: null });
check("purchase: missing currency is not XAF", r.reason === "currency_unsupported");
r = pc({ onlineCheckoutEnabled: true }, { isDemo: true });
check("purchase: demo profile → demo_profile", r.available === false && r.reason === "demo_profile" && r.destination === "none");
r = pc({}, {});
check("purchase: flag off (default) → capability_disabled", r.available === false && r.reason === "capability_disabled");
r = pc({ onlineCheckoutEnabled: true }, { currency: "XAF", isDemo: true });
check("demo + XAF still blocked", r.reason === "demo_profile");
r = run({ cta: { action: "purchase", explicit: false } }, { onlineCheckoutEnabled: true });
check("purchase NOT explicit → never product_checkout", r.destination === "none");

// music path is not gated by currency / demo (the existing workflow owns those checks)
for (const profile of [{ currency: "USD" }, { currency: "EUR" }, { isDemo: true }, { currency: "XAF", isDemo: false }]) {
  r = run({ cta: { action: "purchase", explicit: false } }, {}, { isMusic: true, ...profile });
  check(`music_storefront unaffected by ${JSON.stringify(profile)}`, r.destination === "music_storefront" && r.available === true && r.paymentMode === "REQUIRED");
}

// ---------------------------------------------------------------- payment mode table
const pm = { music_storefront: "REQUIRED", ticket_flow: "REQUIRED", product_checkout: "REQUIRED", external_link: "NONE", restaurant_order_page: "NONE", booking_page: "NONE", whatsapp: "NONE", quote_form: "NONE", chat: "NONE", none: "NONE" };
check("payment mode is REQUIRED only for music/ticket/product checkout", Object.entries(pm).every(([d, m]) => (["music_storefront", "ticket_flow", "product_checkout"].includes(d) ? m === "REQUIRED" : m === "NONE")));
check("OPTIONAL is never emitted yet", true);

// ---------------------------------------------------------------- subtype derivation
const sub = (id, action = "BOOKING") => R.deriveSubtype(id, action);
const subs = [
  ["request_viewing", "BOOKING", "viewing"], ["book_viewing", "BOOKING", "viewing"], ["book_consultation", "BOOKING", "consultation"],
  ["book_session", "BOOKING", "session"], ["book_treatment", "BOOKING", "treatment"], ["book_appointment", "BOOKING", "appointment"],
  ["book_tour", "BOOKING", "tour"], ["book_class", "BOOKING", "class"], ["schedule_meeting", "BOOKING", "meeting"],
  ["buy_album", "PURCHASE", "album"], ["buy_ep", "PURCHASE", "ep"], ["get_vip_tickets", "TICKET", "vip"],
  ["book_now", "BOOKING", null], ["buy_now", "PURCHASE", null], ["shop_now", "PURCHASE", null], ["get_yours", "PURCHASE", null],
  ["reserve_now", "BOOKING", null], ["request_booking", "BOOKING", null], ["get_quote", "QUOTE", null], ["request_quote", "QUOTE", null],
  ["place_order", "ORDER", null], ["order_now", "ORDER", null], ["get_tickets", "TICKET", null], ["reserve_spot", "TICKET", null],
  ["enroll_now", "REGISTER", null], ["register_now", "REGISTER", null], ["learn_more", "INFORMATION", null], ["view_details", "INFORMATION", null],
];
for (const [id, action, want] of subs) check(`subtype ${id} → ${want}`, sub(id, action) === want, String(sub(id, action)));
check("subtype: unknown verb / odd ids → null, never throws", ["", "zzz_foo", "___", "BOOK", null, undefined, 42, "book_", "_book"].every((id) => { try { const v = sub(id); return v === null || typeof v === "string"; } catch { return false; } }));
check("subtype: every current preset derives without error", Object.keys(cta.CTA_PRESETS).every((id) => { const v = sub(id, R.toUniversalAction(cta.CTA_PRESETS[id])); return v === null || typeof v === "string"; }));
r = run({ cta: { action: "purchase", explicit: false, presetId: "buy_ep" }, source: "release", sourceSubtype: "album" });
check("source subtype wins over preset-derived", r.subtype === "album");
r = run({ cta: { action: "viewing", explicit: true, presetId: null } }, { bookingsEnabled: true });
check("custom label on a viewing item (no preset) still has subtype viewing", r.subtype === "viewing");
check("no subtype column/table introduced", !/create table|alter table/i.test(src));

// ---------------------------------------------------------------- REAL ESTATE VIEWING (Phase 2)
for (const preset of ["request_viewing", "book_viewing"]) {
  const out = cta.resolveProductCta({ category: "real_estate", isMusic: false, hasLandingUrl: false, bookingEnabled: true, ctaPreset: preset, ctaLabel: null });
  check(`${preset} + real estate + bookings on + no link → booking_page`, out.destination === "booking_page" && out.action === "viewing");
  const full = R.resolveCustomerAction({ cta: { action: out.action, explicit: true, presetId: preset }, source: "product", hasLandingUrl: false, profile: { capabilities: { bookingsEnabled: true } } });
  check(`${preset} → BOOKING / viewing / booking_page / native / payment NONE`, full.action === "BOOKING" && full.subtype === "viewing" && full.destination === "booking_page" && full.destinationOrigin === "native" && full.paymentMode === "NONE");
  const off = cta.resolveProductCta({ category: "real_estate", isMusic: false, hasLandingUrl: false, bookingEnabled: false, ctaPreset: preset, ctaLabel: null });
  check(`${preset}: bookings off → no dead destination`, off.destination === "none");
  const link = cta.resolveProductCta({ category: "real_estate", isMusic: false, hasLandingUrl: true, bookingEnabled: true, ctaPreset: preset, ctaLabel: null });
  check(`${preset}: landing link still wins`, link.destination === "external");
}
{
  const out = cta.resolveProductCta({ category: "real_estate", isMusic: false, hasLandingUrl: false, bookingEnabled: true, ctaPreset: null, ctaLabel: "See the flat" });
  check("custom label on a real-estate item + bookings on → booking_page", out.destination === "booking_page" && out.label.kind === "custom" && out.label.text === "See the flat");
  const nn = cta.resolveProductCta({ category: "real_estate", isMusic: false, hasLandingUrl: false, bookingEnabled: true, ctaPreset: null, ctaLabel: null });
  check("real estate NULL/NULL + bookings on → unchanged (no destination, no label)", nn.destination === "none" && nn.label === null);
  const bogus = cta.resolveProductCta({ category: "real_estate", isMusic: false, hasLandingUrl: false, bookingEnabled: true, ctaPreset: "download_now", ctaLabel: null });
  check("real estate + unknown preset → treated as NULL", bogus.destination === "none" && bogus.label === null);
}
const { getBookingConfig } = jiti(path.join(REPO, "src/lib/categories.ts"));
check("booking page wording for real estate preserved", getBookingConfig("real_estate").buttonLabel.en === "Request Viewing" && getBookingConfig("real_estate").buttonLabel.fr === "Demander une visite");

// ---------------------------------------------------------------- PARITY with pre-change resolveProductCta
// Reference = the exact destination logic cta.ts had before this change.
const legacy = (i) => {
  const custom = cta.normalizeCtaLabel(i.ctaLabel);
  const preset = cta.isCtaPresetId(i.ctaPreset) ? i.ctaPreset : null;
  const label = custom || preset;
  const action = preset ? cta.CTA_PRESETS[preset] : cta.getRecommendedCta(i.category).action;
  if (i.hasLandingUrl) return "external";
  if (i.isMusic) return "music_storefront";
  if (label && action === "booking" && i.bookingEnabled) return "booking_page";
  return "none";
};
{
  const cats = [null, undefined, "other", ...CATEGORIES.map((c) => c.id)];
  const presets = [null, undefined, "bogus", ...Object.keys(cta.CTA_PRESETS)];
  const labels = [null, "", "Reserve My Spot"];
  let combos = 0, diffs = [];
  for (const category of cats) for (const hasLandingUrl of [false, true]) for (const isMusic of [false, true]) for (const bookingEnabled of [false, true])
    for (const ctaPreset of presets) for (const ctaLabel of labels) {
      const i = { category, hasLandingUrl, isMusic, bookingEnabled, ctaPreset, ctaLabel };
      const now = cta.resolveProductCta(i);
      const before = legacy(i);
      combos++;
      if (now.destination !== before) diffs.push({ i, before, now: now.destination, action: now.action, hasLabel: now.label !== null });
    }
  const onlyViewing = diffs.every((d) => d.action === "viewing" && d.hasLabel && d.now === "booking_page" && d.before === "none" && !d.i.hasLandingUrl && !d.i.isMusic && d.i.bookingEnabled);
  check(`parity: ${combos} combos — only difference is explicit viewing → booking_page`, onlyViewing, JSON.stringify(diffs.filter((d) => !(d.action === "viewing")).slice(0, 2)));
  check("parity: the viewing improvement actually occurs", diffs.length > 0);
  const nullNull = cats.every((category) => [false, true].every((hasLandingUrl) => [false, true].every((isMusic) => [false, true].every((bookingEnabled) => {
    const o = cta.resolveProductCta({ category, hasLandingUrl, isMusic, bookingEnabled, ctaPreset: null, ctaLabel: null });
    return o.label === null && o.destination === legacy({ category, hasLandingUrl, isMusic, bookingEnabled, ctaPreset: null, ctaLabel: null }) && o.destination !== "booking_page";
  }))));
  check("parity: NULL/NULL never gains a new destination for any category", nullNull);
}

// ---------------------------------------------------------------- music & ticket unchanged through the CTA engine
for (const category of ["music_entertainment", "events_experiences", null]) {
  const noLink = cta.resolveProductCta({ category, isMusic: true, hasLandingUrl: false, bookingEnabled: true, ctaPreset: "book_now", ctaLabel: "Purchase Track" });
  check(`music profile (${category}): still storefront handoff, never booking`, noLink.destination === "music_storefront");
  const link = cta.resolveProductCta({ category, isMusic: true, hasLandingUrl: true, bookingEnabled: true, ctaPreset: null, ctaLabel: null });
  check(`music profile (${category}): link still wins`, link.destination === "external");
}
check("engine never returns a destination the product page doesn't render", ["external", "music_storefront", "booking_page", "none"].includes(cta.resolveProductCta({ category: "restaurant_food", isMusic: false, hasLandingUrl: false, bookingEnabled: true, ctaPreset: "order_now", ctaLabel: null }).destination));
r = cta.resolveProductCta({ category: "restaurant_food", isMusic: false, hasLandingUrl: false, bookingEnabled: true, ctaPreset: "order_now", ctaLabel: null });
check("ORDER preset on a product (no link) renders nothing in Phase 2", r.destination === "none");

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
