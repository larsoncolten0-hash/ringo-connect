// Focused checks for the Universal Smart CTA (src/lib/cta.ts). No network, no database.
//   Run:  node scripts/tests/cta.test.mjs
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const cta = jiti(path.join(REPO, "src/lib/cta.ts"));
const { translations } = jiti(path.join(REPO, "src/lib/i18n/translations.ts"));
const { CATEGORIES } = jiti(path.join(REPO, "src/lib/categories.ts"));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const base = { category: "beauty_wellness", isMusic: false, hasLandingUrl: false, bookingEnabled: false };
const rec = (c) => cta.getRecommendedCta(c);

// --- category defaults ---------------------------------------------------
const expectRec = {
  music_entertainment: ["purchase", "buy_now"],
  business_ecommerce: ["purchase", "buy_now"],
  restaurant_food: ["order", "order_now"],
  beauty_wellness: ["booking", "book_now"],
  health_medical: ["booking", "book_appointment"],
  professional_services: ["booking", "book_consultation"],
  transport_logistics: ["booking", "book_now"],
  travel_hospitality: ["booking", "book_now"],
  real_estate: ["viewing", "request_viewing"],
  events_experiences: ["ticket", "get_tickets"],
  education_training: ["register", "enroll_now"],
  freelancers_creators: ["quote", "request_quote"],
  construction_home_services: ["quote", "request_quote"],
  other: ["info", "view_details"],
};
for (const [cat, [action, preset]] of Object.entries(expectRec)) {
  const r = rec(cat);
  check(`recommended ${cat}`, r.action === action && r.recommended === preset, JSON.stringify(r));
}
check("null category → informational, never transactional", rec(null).action === "info" && rec(undefined).action === "info");
check("music never recommends Listen/preview wording", !Object.keys(cta.CTA_PRESETS).some((k) => /listen|play/.test(k)));
check("every real category resolves without throwing", CATEGORIES.every((c) => rec(c.id).alternatives.length > 0));

// --- same-action alternatives only --------------------------------------
for (const c of CATEGORIES) {
  const r = rec(c.id);
  check(`alternatives share one action: ${c.id}`, r.alternatives.every((id) => cta.CTA_PRESETS[id] === r.action), r.alternatives.join());
}

// --- NULL/NULL = today's behavior (label null → caller keeps its wording) ---
for (const extra of [{}, { hasLandingUrl: true }, { isMusic: true }, { bookingEnabled: true }]) {
  const r = cta.resolveProductCta({ ...base, ...extra, ctaPreset: null, ctaLabel: null });
  check(`NULL/NULL keeps existing label ${JSON.stringify(extra)}`, r.label === null);
  check(`NULL/NULL never adds a booking destination ${JSON.stringify(extra)}`, r.destination !== "booking_page");
}
check("undefined columns (pre-migration row) behave like NULL", cta.resolveProductCta({ ...base, ctaPreset: undefined, ctaLabel: undefined }).label === null);

// --- precedence & override safety ---------------------------------------
let r = cta.resolveProductCta({ ...base, hasLandingUrl: true, ctaPreset: "reserve_now", ctaLabel: "Reserve My Haircut" });
check("custom label beats preset", r.label?.kind === "custom" && r.label.text === "Reserve My Haircut");
check("custom label doesn't change action", r.action === "booking");
check("custom label doesn't change destination (external link)", r.destination === "external");
r = cta.resolveProductCta({ ...base, isMusic: true, category: "music_entertainment", ctaLabel: "Purchase Track" });
check("music custom label: action stays purchase, destination stays storefront", r.action === "purchase" && r.destination === "music_storefront");
r = cta.resolveProductCta({ ...base, ctaPreset: "book_now" });
check("preset used when no custom", r.label?.kind === "preset" && r.label.id === "book_now");

// --- unknown / malicious values fall back safely ------------------------
r = cta.resolveProductCta({ ...base, ctaPreset: "download_now" });
check("unknown preset ignored", r.label === null);
check("prototype key rejected as preset", cta.isCtaPresetId("toString") === false && cta.isCtaPresetId("__proto__") === false);
check("blank/space custom label ignored", cta.resolveProductCta({ ...base, ctaLabel: "   " }).label === null);
check("non-string custom label ignored", cta.normalizeCtaLabel(42) === null && cta.normalizeCtaLabel({}) === null);
check("custom label capped", cta.normalizeCtaLabel("x".repeat(200)).length === cta.CTA_LABEL_MAX_LENGTH);
check("custom label whitespace collapsed", cta.normalizeCtaLabel("  Reserve   my\n spot ") === "Reserve my spot");
check("custom label cap is code-point safe", Array.from(cta.normalizeCtaLabel("😀".repeat(50))).length === cta.CTA_LABEL_MAX_LENGTH);

// --- no dead CTAs --------------------------------------------------------
r = cta.resolveProductCta({ ...base, category: "business_ecommerce", ctaPreset: "buy_now" });
check("purchase preset, no link, non-music → no destination", r.destination === "none");
r = cta.resolveProductCta({ ...base, ctaPreset: "book_now", bookingEnabled: false });
check("booking preset, bookings off, no link → no destination", r.destination === "none");
r = cta.resolveProductCta({ ...base, ctaPreset: "book_now", bookingEnabled: true });
check("booking preset, bookings on, no link → booking page", r.destination === "booking_page");
r = cta.resolveProductCta({ ...base, category: "real_estate", ctaPreset: "request_quote", bookingEnabled: true });
check("non-booking preset never routes to booking page", r.destination === "none");
r = cta.resolveProductCta({ ...base, category: "business_ecommerce", ctaLabel: "Get Yours", bookingEnabled: true });
check("custom label on a purchase category never routes to booking page", r.destination === "none");
r = cta.resolveProductCta({ ...base, hasLandingUrl: true, ctaPreset: "book_now", bookingEnabled: true });
check("existing link wins over booking page", r.destination === "external");

// --- real-estate viewing routes to the existing booking page (customerAction wiring) ---
r = cta.resolveProductCta({ ...base, category: "real_estate", ctaPreset: "request_viewing", bookingEnabled: true });
check("viewing preset, bookings on, no link → booking page", r.destination === "booking_page" && r.action === "viewing");
r = cta.resolveProductCta({ ...base, category: "real_estate", ctaPreset: "request_viewing", bookingEnabled: false });
check("viewing preset, bookings off → no destination", r.destination === "none");
r = cta.resolveProductCta({ ...base, category: "real_estate", ctaPreset: "request_viewing", bookingEnabled: true, hasLandingUrl: true });
check("viewing preset with a link → link still wins", r.destination === "external");
r = cta.resolveProductCta({ ...base, category: "real_estate", bookingEnabled: true });
check("real estate NULL/NULL + bookings on → unchanged", r.destination === "none" && r.label === null);

// --- English / French parity --------------------------------------------
const presetIds = Object.keys(cta.CTA_PRESETS);
for (const lang of ["en", "fr"]) {
  const labels = translations[lang].cta.labels;
  check(`${lang}: a label exists for every preset`, presetIds.every((id) => typeof labels[id] === "string" && labels[id].trim()));
  check(`${lang}: no orphan labels`, Object.keys(labels).every((id) => presetIds.includes(id)));
}
check("en/fr cta keys identical", JSON.stringify(Object.keys(translations.en.cta).sort()) === JSON.stringify(Object.keys(translations.fr.cta).sort()));
check("fr labels differ from en (no English left behind)", presetIds.every((id) => translations.fr.cta.labels[id] !== translations.en.cta.labels[id]));
check("fr labels unique (distinguishable options)", new Set(presetIds.map((id) => translations.fr.cta.labels[id])).size === presetIds.length);
check("en labels unique", new Set(presetIds.map((id) => translations.en.cta.labels[id])).size === presetIds.length);

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
