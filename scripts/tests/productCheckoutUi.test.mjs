// Increment 3: customer checkout UI + Buy Now integration. Everything runs against a MOCK API — no
// network, no database, no Fapshi, no real payment, and commerce stays disabled. The flow logic is
// exercised through CheckoutController (the UI's brain); the view is server-rendered to check what a
// customer would see; security and integration are checked against the source.
//   Run:  node scripts/tests/productCheckoutUi.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });

// .tsx modules (the checkout view) are transpiled with sucrase (already installed) and evaluated with a
// tiny CommonJS loader; .ts modules go through jiti, everything else is a normal require.
const { transform } = require("sucrase");
const tsxCache = new Map();
function resolveSrc(id) {
  const base = path.join(REPO, "src", id.slice(2));
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  throw new Error("cannot resolve " + id);
}
function loadSrc(file) {
  if (!file.endsWith(".tsx")) return jiti(file);
  if (tsxCache.has(file)) return tsxCache.get(file).exports;
  const mod = { exports: {} };
  tsxCache.set(file, mod);
  const code = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
  const localRequire = (id) => (id.startsWith("@/") ? loadSrc(resolveSrc(id)) : require(id));
  new Function("require", "module", "exports", code)(localRequire, mod, mod.exports);
  return mod.exports;
}
const P = (f) => jiti(path.join(REPO, "src/lib/productCheckout", f));
const flow = P("clientFlow.ts");
const availability = P("availability.ts");
const eligibility = P("eligibility.ts");
const { HTTP_STATUS } = P("errors.ts");
const cta = jiti(path.join(REPO, "src/lib/cta.ts"));
const R = jiti(path.join(REPO, "src/lib/customerAction.ts"));
const routes = jiti(path.join(REPO, "src/lib/customerActionRoutes.ts"));
const { translations } = jiti(path.join(REPO, "src/lib/i18n/translations.ts"));
const { CATEGORIES } = jiti(path.join(REPO, "src/lib/categories.ts"));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const strip = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ================================================================ 1. CTA: Buy Now → product_checkout
{
  const eng = (over) => cta.resolveProductCta({ category: "business_ecommerce", isMusic: false, hasLandingUrl: false, bookingEnabled: false, checkoutAvailable: true, currency: "XAF", isDemo: false, ctaPreset: "buy_now", ctaLabel: null, ...over });
  check("eligible non-music product, explicit Buy Now, no link → product_checkout", eng({}).destination === "product_checkout" && eng({}).action === "purchase");
  check("…with the creator's custom wording too", eng({ ctaPreset: null, ctaLabel: "Get Yours" }).destination === "product_checkout");
  for (const preset of ["buy_now", "shop_now", "get_yours"]) check(`every purchase preset (${preset}) → product_checkout`, eng({ ctaPreset: preset }).destination === "product_checkout");
  check("ineligible: server says checkout is not available → none", eng({ checkoutAvailable: false }).destination === "none");
  check("ineligible: capability omitted (old callers) → none", eng({ checkoutAvailable: undefined }).destination === "none");
  check("ineligible: currency is not XAF → none (resolver's own gate agrees)", eng({ currency: "USD" }).destination === "none" && eng({ currency: null }).destination === "none");
  check("ineligible: demo profile → none", eng({ isDemo: true }).destination === "none");
  check("NULL/NULL never gains checkout", (() => { const o = eng({ ctaPreset: null, ctaLabel: null }); return o.destination === "none" && o.label === null; })());
  check("music stays on the music flow", eng({ isMusic: true, category: "music_entertainment" }).destination === "music_storefront");
  check("the item's own link still wins", eng({ hasLandingUrl: true }).destination === "external");
  check("booking behaviour unchanged", cta.resolveProductCta({ category: "beauty_wellness", isMusic: false, hasLandingUrl: false, bookingEnabled: true, checkoutAvailable: true, currency: "XAF", ctaPreset: "book_now", ctaLabel: null }).destination === "booking_page");
  check("real-estate viewing unchanged", cta.resolveProductCta({ category: "real_estate", isMusic: false, hasLandingUrl: false, bookingEnabled: true, checkoutAvailable: true, currency: "XAF", ctaPreset: "request_viewing", ctaLabel: null }).destination === "booking_page");
  check("restaurant ordering unchanged", cta.resolveProductCta({ category: "restaurant_food", isMusic: false, hasLandingUrl: false, bookingEnabled: false, restaurantOrdering: true, checkoutAvailable: true, currency: "XAF", ctaPreset: "order_now", ctaLabel: null }).destination === "restaurant_order_page");
  for (const preset of ["get_tickets", "request_quote", "enroll_now", "learn_more"]) {
    check(`ticket/quote/register/info (${preset}) never becomes checkout`, eng({ ctaPreset: preset, category: "other" }).destination === "none");
  }
  check("no WhatsApp anywhere in the result", ["none", "product_checkout"].includes(eng({}).destination) && !JSON.stringify(eng({})).includes("whatsapp"));
  check("route: product_checkout → the item's checkout page", routes.customerActionRoute("product_checkout", { username: "shop", productId: "p1" }).href === "/shop/item/p1/checkout");

  // exhaustive: with the capability OFF nothing changes; ON adds only the purchase → checkout case
  const legacy = (i) => {
    const custom = cta.normalizeCtaLabel(i.ctaLabel);
    const preset = cta.isCtaPresetId(i.ctaPreset) ? i.ctaPreset : null;
    const label = custom || preset;
    const action = preset ? cta.CTA_PRESETS[preset] : cta.getRecommendedCta(i.category).action;
    if (i.hasLandingUrl) return "external";
    if (i.isMusic) return "music_storefront";
    if (label && (action === "booking" || action === "viewing") && i.bookingEnabled) return "booking_page";
    if (label && action === "order" && i.restaurantOrdering) return "restaurant_order_page";
    return "none";
  };
  let combos = 0, offDiff = 0, onOther = 0, onCheckout = 0;
  for (const category of [null, ...CATEGORIES.map((c) => c.id)]) for (const hasLandingUrl of [false, true]) for (const isMusic of [false, true]) for (const bookingEnabled of [false, true]) for (const restaurantOrdering of [false, true])
    for (const currency of ["XAF", "USD", null]) for (const isDemo of [false, true])
      for (const ctaPreset of [null, "bogus", ...Object.keys(cta.CTA_PRESETS)]) for (const ctaLabel of [null, "Custom"]) {
        const base = { category, hasLandingUrl, isMusic, bookingEnabled, restaurantOrdering, currency, isDemo, ctaPreset, ctaLabel };
        const before = legacy(base);
        const off = cta.resolveProductCta({ ...base, checkoutAvailable: false }).destination;
        const on = cta.resolveProductCta({ ...base, checkoutAvailable: true });
        combos++;
        if (off !== before) offDiff++;
        if (on.destination !== before) {
          const expectedCheckout = before === "none" && on.action === "purchase" && on.label !== null && !hasLandingUrl && !isMusic && currency === "XAF" && !isDemo;
          if (on.destination === "product_checkout" && expectedCheckout) onCheckout++;
          else onOther++;
        }
      }
  check(`parity: capability OFF changes nothing vs the previous behaviour (${combos} combos)`, offDiff === 0, String(offDiff));
  check("parity: capability ON only adds explicit purchase → product_checkout (XAF, non-demo, no link, non-music)", onOther === 0 && onCheckout > 0, `other=${onOther} checkout=${onCheckout}`);
}

// ================================================================ 2. server availability (one eligibility system)
{
  const settings = (o = {}) => async () => ({ commerceEnabled: true, commissionRate: 0.05, fapshiEnabled: true, ...o }); // TEST values only
  const profile = (o = {}) => ({ id: U(1), user_id: U(101), username: "shop", currency: "XAF", published: true, is_demo: false, category: "business_ecommerce", categories: ["business_ecommerce"], ...o });
  const product = (o = {}) => ({ id: U(11), profile_id: U(1), name: "Widget", price: 6000, available: true, inventory_count: 5, landing_url: null, cta_preset: "buy_now", cta_label: null, ...o });
  const A = availability;
  check("availability: eligible product → true", (await A.computeCheckoutAvailability(profile(), product(), settings())) === true);
  const no = [
    ["commerce disabled", profile(), product(), settings({ commerceEnabled: false })],
    ["commission rate not set", profile(), product(), settings({ commissionRate: null })],
    ["Fapshi disabled", profile(), product(), settings({ fapshiEnabled: false })],
    ["non-XAF profile", profile({ currency: "USD" }), product(), settings()],
    ["demo profile", profile({ is_demo: true }), product(), settings()],
    ["unpublished profile", profile({ published: false }), product(), settings()],
    ["music profile", profile({ category: "music_entertainment", categories: ["music_entertainment"] }), product(), settings()],
    ["unavailable product", profile(), product({ available: false }), settings()],
    ["zero price", profile(), product({ price: 0 }), settings()],
    ["sold out", profile(), product({ inventory_count: 0 }), settings()],
    ["item has its own link", profile(), product({ landing_url: "https://x.example" }), settings()],
    ["no explicit CTA (NULL/NULL)", profile(), product({ cta_preset: null, cta_label: null }), settings()],
    ["explicit non-purchase CTA", profile(), product({ cta_preset: "book_now" }), settings()],
    ["product from another profile", profile(), product({ profile_id: U(2) }), settings()],
  ];
  for (const [name, p, pr, load] of no) check(`availability: ${name} → false`, (await A.computeCheckoutAvailability(p, pr, load)) === false);
  check("availability: settings unreadable → false (the safe answer)", (await A.computeCheckoutAvailability(profile(), product(), async () => { throw new Error("db down"); })) === false);
  let reads = 0;
  const counting = async () => { reads++; return { commerceEnabled: true, commissionRate: 0.05, fapshiEnabled: true }; };
  await A.computeCheckoutAvailability(profile(), product({ cta_preset: null }), counting);
  await A.computeCheckoutAvailability(profile(), product({ landing_url: "https://x" }), counting);
  await A.computeCheckoutAvailability(profile({ category: "music_entertainment", categories: [] }), product(), counting);
  check("availability: no settings read for pages that can never use checkout (no extra public queries)", reads === 0, String(reads));
  check("availability: custom-label-only purchase CTA on an e-commerce profile qualifies", (await A.computeCheckoutAvailability(profile(), product({ cta_preset: null, cta_label: "Get it" }), settings())) === true);
  check("availability: profile-level flag (editor)", (await A.computeProfileCheckoutAvailability(profile(), settings())) === true && (await A.computeProfileCheckoutAvailability(profile({ currency: "EUR" }), settings())) === false && (await A.computeProfileCheckoutAvailability(profile(), settings({ commerceEnabled: false }))) === false);
  check("availability: checkout page block codes", (await A.getCheckoutBlock(profile(), product(), 1, settings())) === null && (await A.getCheckoutBlock(profile(), product(), 1, settings({ commerceEnabled: false }))) === "commerce_disabled" && (await A.getCheckoutBlock(profile(), product({ inventory_count: 0 }), 1, settings())) === "insufficient_stock" && (await A.getCheckoutBlock(profile(), product({ available: false }), 1, settings())) === "product_unavailable");
  check("availability: only whitelisted profile fields reach the rules", !("theme_color" in A.toProfileRow({ ...profile(), theme_color: "#fff", facebook_capi_token_encrypted: "secret" })) && !JSON.stringify(A.toProfileRow({ ...profile(), facebook_capi_token_encrypted: "secret" })).includes("secret"));
  // the editor applies the SAME product rules, in the browser
  check("editor: same product rules as the server (price/stock/availability)", eligibility.checkProductEligibility({ product: { ...product(), price: "6000" }, profileId: U(1), quantity: 1 }) === null && eligibility.checkProductEligibility({ product: product({ price: "" }), profileId: U(1), quantity: 1 }) === "product_unavailable" && eligibility.checkProductEligibility({ product: product({ inventory_count: 0 }), profileId: U(1), quantity: 1 }) === "insufficient_stock");
}

// ================================================================ 3. checkout controller (mock API)
function mockApi(script = {}) {
  const api = {
    calls: { createOrder: [], pay: [], status: [] },
    orderView: (status = "awaiting_payment") => ({ id: U(500), order_number: "PO-000007", status, currency: "XAF", subtotal: 12000, total: 12000, expires_at: "2026-11-03T11:00:00.000Z", items: [{ name: "Widget", image: null, quantity: 2, unit_price: 6000, line_total: 12000 }] }),
    statuses: [], // queue of PaymentStatusView | error code
    createResult: null, payResult: null, delay: 0,
    async createOrder(body) { api.calls.createOrder.push(body); await tick(api.delay); return api.createResult || { ok: true, data: api.orderView() }; },
    async pay(id, body) { api.calls.pay.push({ id, body }); await tick(api.delay); return api.payResult || { ok: true, data: { status: "pending", expires_at: "2026-11-03T10:15:00.000Z", order: api.orderView() } }; },
    async status(id) {
      api.calls.status.push(id); await tick(api.delay);
      const next = api.statuses.length > 1 ? api.statuses.shift() : api.statuses[0];
      if (!next) return { ok: true, data: { status: "pending", order: { ...api.orderView(), paid_at: null }, expires_at: "2026-11-03T10:15:00.000Z" } };
      return typeof next === "string" ? { ok: false, code: next } : { ok: true, data: next };
    },
    ...script,
  };
  return api;
}
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const paidView = (api) => ({ status: "succeeded", order: { ...api.orderView("paid"), paid_at: "2026-11-03T10:05:00.000Z" }, receipt_number: "RCP-000007", seller_username: "shop" });
const view = (api, status, extra = {}) => ({ status, order: { ...api.orderView(), paid_at: null }, ...extra });
const ctlOf = (api, over = {}) => { const changes = []; const c = new flow.CheckoutController({ productId: U(11), maxQuantity: 10, api, onOrderChange: (id) => changes.push(id), ...over }); c.changes = changes; return c; };
const fill = (c, over = {}) => c.edit({ name: "Amina Bello", phone: "+237 677 12 34 56", email: "", note: "", quantity: 2, ...over });

{
  // product loads / unavailable
  let api = mockApi(), c = ctlOf(api);
  check("loads: starts on the form with sensible defaults", c.getState().phase === "form" && c.getState().form.quantity === 1 && c.getState().form.medium === "mobile money" && !c.getState().order);
  c = ctlOf(api, { unavailableCode: "commerce_disabled" });
  check("unavailable product/checkout → the unavailable state (with the code)", c.getState().phase === "unavailable" && c.getState().error === "commerce_disabled");
  await c.submit();
  check("unavailable: submitting does nothing (no API call)", api.calls.createOrder.length === 0 && c.getState().phase === "unavailable");
  c = ctlOf(api, { prefill: { name: "Amina", phone: "677123456", email: "a@b.co" } });
  check("prefill from a signed-in customer (name, phone, email); payer number follows the phone", c.getState().form.name === "Amina" && c.getState().form.phone === "677123456" && c.getState().form.email === "a@b.co" && c.getState().form.payPhone === "677123456");
  c = ctlOf(api, { prefill: { name: "Amina", phone: "+33 6 12 34 56 78" } });
  check("prefill: a non-Cameroon phone is not copied into the payer field", c.getState().form.payPhone === "");

  // quantity
  c = ctlOf(api, { maxQuantity: 4 });
  c.edit({ quantity: 99 }); check("quantity: clamped to the maximum (stock-bound)", c.getState().form.quantity === 4);
  c.edit({ quantity: 0 }); check("quantity: never below 1", c.getState().form.quantity === 1);
  c.edit({ quantity: NaN }); check("quantity: NaN → 1", c.getState().form.quantity === 1);
  check("quantity: never above the hard cap of 10", flow.clampQuantity(50, 500) === 10 && flow.clampQuantity(3, 0) === 1);
  const e = flow.validateForm(U(11), { quantity: 11, name: "A", phone: "677123456", email: "", note: "", payPhone: "677123456", medium: "mobile money" }, 10);
  check("quantity validation: 11 → quantity_exceeds_max", e.quantity === "quantity_exceeds_max");
  check("quantity validation: 0 and 1.5 → invalid_quantity", flow.validateForm(U(11), { quantity: 0, name: "A", phone: "677123456", email: "", note: "", payPhone: "677123456", medium: "mobile money" }, 10).quantity === "invalid_quantity" && flow.validateForm(U(11), { quantity: 1.5, name: "A", phone: "677123456", email: "", note: "", payPhone: "677123456", medium: "mobile money" }, 10).quantity === "invalid_quantity");

  // customer + payment validation (with the SERVER's parsers) — nothing reaches the API
  api = mockApi(); c = ctlOf(api);
  await c.submit();
  const fe = c.getState().fieldErrors;
  check("customer validation: empty name/phone/payer number are all reported at once", fe.name === "invalid_name" && fe.phone === "invalid_phone" && fe.payPhone === "invalid_phone");
  check("customer validation: no API call was made", api.calls.createOrder.length === 0 && api.calls.pay.length === 0 && c.getState().phase === "form");
  fill(c, { email: "not-an-email" }); c.edit({ payPhone: "12345" });
  await c.submit();
  check("customer validation: bad email and a payer number that isn't a Cameroon mobile", c.getState().fieldErrors.email === "invalid_email" && c.getState().fieldErrors.payPhone === "invalid_phone");
  c.edit({ email: "", payPhone: "677123456", note: "x".repeat(501) }); await c.submit();
  check("customer validation: note over 500 characters", c.getState().fieldErrors.note === "invalid_request" && api.calls.createOrder.length === 0);
  c.edit({ note: "" });
  check("editing a field clears just that field's error", !c.getState().fieldErrors.note && c.getState().fieldErrors.email === undefined);
  check("payment method validation: only MTN/Orange accepted", flow.validatePayFields({ ...c.getState().form, medium: "card" }).medium === "invalid_payment_medium");
  c = ctlOf(api); fill(c); c.edit({ payPhone: "677123456" });
  check("payer number follows the contact number until edited, then stays put", ctlOf(api).getState().form.payPhone === "" && (() => { const x = ctlOf(api); x.edit({ phone: "677111111" }); const followed = x.getState().form.payPhone === "677111111"; x.edit({ payPhone: "699999999" }); x.edit({ phone: "677222222" }); return followed && x.getState().form.payPhone === "699999999"; })());

  // happy path: exactly the whitelisted bodies
  api = mockApi(); c = ctlOf(api); fill(c, { email: "amina@example.com", note: "Call first" }); c.edit({ payPhone: "677 12 34 56", medium: "orange money" });
  await c.submit();
  const cb = api.calls.createOrder[0], pb = api.calls.pay[0];
  check("submit: order created once, payment started once", api.calls.createOrder.length === 1 && api.calls.pay.length === 1 && pb.id === U(500));
  check("submit: the create body has ONLY product id, quantity and contact details", JSON.stringify(Object.keys(cb).sort()) === JSON.stringify(["customer_email", "customer_name", "customer_phone", "note", "product_id", "quantity"].sort()) && cb.product_id === U(11) && cb.quantity === 2);
  check("submit: the pay body has ONLY the payer phone (normalised) and medium", JSON.stringify(pb.body) === JSON.stringify({ phone: "677123456", medium: "orange money" }));
  check("submit: empty optional fields are omitted from the body", (() => { const b = flow.buildCreateBody(U(11), { ...c.getState().form, email: " ", note: "" }); return !("customer_email" in b) && !("note" in b); })());
  check("submit: → waiting, with the order and the payment expiry from the server", c.getState().phase === "waiting" && c.getState().order.order_number === "PO-000007" && !!c.getState().expiresAt);
  check("submit: the order id is put in the URL hook (for refresh/re-entry)", JSON.stringify(c.changes) === JSON.stringify([U(500)]));
  check("submit: nothing is shown as success before the backend says so", c.getState().phase !== "success" && c.getState().receipt === null);

  // duplicate submission prevention
  api = mockApi({ delay: 20 }); c = ctlOf(api); fill(c);
  await Promise.all([c.submit(), c.submit(), c.submit(), c.submit()]);
  check("duplicate submission (4 rapid submits): one order, one payment", api.calls.createOrder.length === 1 && api.calls.pay.length === 1, `${api.calls.createOrder.length}/${api.calls.pay.length}`);
  await c.submit(); await c.submit();
  check("submitting while waiting is ignored", api.calls.createOrder.length === 1 && api.calls.pay.length === 1);
  api = mockApi({ delay: 20 }); c = ctlOf(api); fill(c);
  const p1 = c.submit(); check("while submitting the phase is 'submitting' (buttons can disable)", c.getState().phase === "submitting"); await p1;

  // payment pending → success (only when the backend confirms)
  api = mockApi(); c = ctlOf(api); fill(c); await c.submit();
  api.statuses = [view(api, "pending", { expires_at: "2026-11-03T10:15:00.000Z" })];
  await c.poll();
  check("poll: pending stays waiting", c.getState().phase === "waiting" && c.getState().receipt === null);
  api.statuses = [paidView(api)];
  await c.poll();
  const st = c.getState();
  check("poll: succeeded → success with the receipt data from the backend", st.phase === "success" && st.receipt.receipt_number === "RCP-000007" && st.receipt.order.total === 12000 && st.order.status === "paid" && st.receipt.order.paid_at === "2026-11-03T10:05:00.000Z");
  const before = api.calls.status.length; await c.poll();
  check("poll after success does nothing", api.calls.status.length === before);
  // overlapping polls
  api = mockApi({ delay: 15 }); c = ctlOf(api); fill(c); await c.submit(); api.calls.status.length = 0;
  await Promise.all([c.poll(), c.poll(), c.poll()]);
  check("overlapping polls are collapsed into one request", api.calls.status.length === 1, String(api.calls.status.length));

  // failure → retry (same order, no second order)
  api = mockApi(); c = ctlOf(api); fill(c); await c.submit();
  api.statuses = [view(api, "failed", { code: "payment_failed" })]; await c.poll();
  check("failure: backend says failed → failed state", c.getState().phase === "failed" && c.getState().error === "payment_failed" && c.getState().order.id === U(500));
  api.statuses = []; await c.retryPayment();
  check("retry: pays the SAME order again (no duplicate order), back to waiting", api.calls.createOrder.length === 1 && api.calls.pay.length === 2 && api.calls.pay[1].id === U(500) && c.getState().phase === "waiting");
  api = mockApi({ payResult: { ok: false, code: "payment_failed" } }); c = ctlOf(api); fill(c); await c.submit();
  check("failure: the provider refuses to start → failed (order kept, retry possible)", c.getState().phase === "failed" && !!c.getState().order);
  api = mockApi({ payResult: { ok: false, code: "too_many_payment_attempts" } }); c = ctlOf(api); fill(c); await c.submit();
  check("failure: too many attempts → failed with that reason", c.getState().phase === "failed" && c.getState().error === "too_many_payment_attempts");

  // expiry
  api = mockApi(); c = ctlOf(api); fill(c); await c.submit();
  api.statuses = [view(api, "expired", { code: "payment_expired" })]; await c.poll();
  check("expiry: payment expired (order still open) → expired, retry allowed", c.getState().phase === "expired" && c.getState().error === "payment_expired");
  api.statuses = []; await c.retryPayment();
  check("expiry: retry sends a new payment for the same order", api.calls.pay.length === 2 && api.calls.createOrder.length === 1 && c.getState().phase === "waiting");
  api.statuses = [view(api, "expired", { code: "order_expired" })]; await c.poll();
  check("expiry: order expired → start again required", c.getState().phase === "order_expired");
  c.startOver();
  check("start over: back to a clean form, order cleared, URL hook cleared", c.getState().phase === "form" && !c.getState().order && c.changes[c.changes.length - 1] === null);
  api = mockApi({ payResult: { ok: false, code: "order_expired" } }); c = ctlOf(api); fill(c); await c.submit();
  check("expiry: order already expired when paying → order_expired", c.getState().phase === "order_expired");

  // review
  api = mockApi(); c = ctlOf(api); fill(c); await c.submit();
  api.statuses = [view(api, "review", { code: "payment_review" })]; await c.poll();
  check("review: payment received but needs checking → review state", c.getState().phase === "review" && c.getState().order.order_number === "PO-000007");
  api = mockApi({ payResult: { ok: false, code: "payment_review" } }); c = ctlOf(api); fill(c); await c.submit();
  check("review: raised while starting a payment → review", c.getState().phase === "review");

  // other backend errors
  api = mockApi({ createResult: { ok: false, code: "commerce_disabled" } }); c = ctlOf(api); fill(c); await c.submit();
  check("create refused: commerce_disabled → unavailable, and no payment was attempted", c.getState().phase === "unavailable" && api.calls.pay.length === 0);
  for (const code of ["product_unavailable", "profile_unavailable", "payment_provider_unavailable", "commerce_currency_unsupported", "music_profile_not_supported", "product_price_unsupported"]) {
    api = mockApi({ createResult: { ok: false, code } }); c = ctlOf(api); fill(c); await c.submit();
    check(`create refused: ${code} → unavailable`, c.getState().phase === "unavailable" && c.getState().error === code);
  }
  api = mockApi({ createResult: { ok: false, code: "insufficient_stock" } }); c = ctlOf(api); fill(c); await c.submit();
  check("create refused: insufficient_stock → back to the form with a quantity error", c.getState().phase === "form" && c.getState().fieldErrors.quantity === "insufficient_stock");
  api = mockApi({ createResult: { ok: false, code: "too_many_open_orders" } }); c = ctlOf(api); fill(c); await c.submit();
  check("create refused: too_many_open_orders → form with the message", c.getState().phase === "form" && c.getState().error === "too_many_open_orders");
  api = mockApi({ payResult: { ok: false, code: "payment_already_pending" } }); c = ctlOf(api); fill(c); await c.submit();
  check("payment_already_pending → just follow the live attempt (waiting)", c.getState().phase === "waiting" && api.calls.createOrder.length === 1);
  api = mockApi({ payResult: { ok: false, code: "network_error" } }); c = ctlOf(api); fill(c); await c.submit();
  check("network error while paying: order kept, back to the form", c.getState().phase === "form" && !!c.getState().order && c.getState().error === "network_error");
  api.payResult = null; await c.submit();
  check("…and retrying pays the existing order (never creates a second)", api.calls.createOrder.length === 1 && api.calls.pay.length === 2 && c.getState().phase === "waiting");
  api = mockApi({ payResult: { ok: false, code: "order_not_payable" } }); c = ctlOf(api); fill(c); api.statuses = [paidView(api)]; await c.submit();
  check("order_not_payable (e.g. an earlier response was lost) → asks the backend and shows the receipt", c.getState().phase === "success");
  api = mockApi({ payResult: { ok: false, code: "invalid_phone" } }); c = ctlOf(api); fill(c); await c.submit();
  check("server rejects the payer number → form with a payPhone error", c.getState().phase === "form" && c.getState().fieldErrors.payPhone === "invalid_phone");

  // polling resilience
  api = mockApi(); c = ctlOf(api); fill(c); await c.submit();
  api.statuses = ["network_error"]; for (let i = 0; i < 4; i++) await c.poll();
  check("poll: transient failures keep waiting without an error", c.getState().phase === "waiting" && c.getState().error === null);
  await c.poll();
  check("poll: after 5 failures in a row the connection problem is shown — still waiting", c.getState().phase === "waiting" && c.getState().error === "network_error");
  api.statuses = [view(api, "pending", { expires_at: "2026-11-03T10:15:00.000Z" })]; await c.poll();
  check("poll: recovers automatically", c.getState().error === null && c.getState().pollFailures === 0);

  // refresh / re-entry
  api = mockApi(); api.statuses = [view(api, "pending", { expires_at: "2026-11-03T10:15:00.000Z" })];
  c = ctlOf(api); await c.resume(U(500));
  check("re-entry: a refresh while payment is pending resumes waiting (no new order, no new payment)", c.getState().phase === "waiting" && c.getState().order.id === U(500) && api.calls.createOrder.length === 0 && api.calls.pay.length === 0);
  api = mockApi(); api.statuses = [paidView(api)]; c = ctlOf(api); await c.resume(U(500));
  check("re-entry: returning after payment shows the receipt", c.getState().phase === "success" && c.getState().receipt.receipt_number === "RCP-000007");
  api = mockApi(); api.statuses = [view(api, "not_started")]; c = ctlOf(api); await c.resume(U(500));
  check("re-entry: order exists but payment never started → payment step only", c.getState().phase === "form" && !!c.getState().order);
  await c.submit();
  check("re-entry: the payment-only step still validates the payer number first", api.calls.pay.length === 0 && c.getState().fieldErrors.payPhone === "invalid_phone");
  c.edit({ payPhone: "677123456" }); await c.submit();
  check("re-entry: paying from there reuses the order", api.calls.createOrder.length === 0 && api.calls.pay.length === 1 && c.getState().phase === "waiting");
  api = mockApi(); api.statuses = ["order_not_found"]; c = ctlOf(api); await c.resume(U(999));
  check("re-entry: unknown order → clean form and the URL hook cleared", c.getState().phase === "form" && !c.getState().order && c.changes[c.changes.length - 1] === null);
  api = mockApi(); c = ctlOf(api); await c.resume("not-a-uuid");
  check("re-entry: a malformed id is ignored without any request", api.calls.status.length === 0 && c.getState().phase === "form");
  api = mockApi(); api.statuses = [view(api, "expired", { code: "order_expired" })]; c = ctlOf(api); await c.resume(U(500));
  check("re-entry: expired order → start again", c.getState().phase === "order_expired");
  api = mockApi(); api.statuses = [view(api, "review", { code: "payment_review" })]; c = ctlOf(api); await c.resume(U(500));
  check("re-entry: order in review → review state", c.getState().phase === "review");
  api = mockApi(); api.statuses = [paidView(api)]; c = ctlOf(api, { unavailableCode: "commerce_disabled" }); check("re-entry works even if checkout is disabled now (receipt still viewable)", (await c.resume(U(500)), c.getState().phase === "success"));

  // subscribers
  api = mockApi(); c = ctlOf(api); let notified = 0; const off = c.subscribe(() => notified++); fill(c); await c.submit(); off(); const n = notified; c.edit({ note: "x" });
  check("controller notifies subscribers, and unsubscribing works", n > 0 && notified === n);

  // the real transport
  const calls = [];
  const fakeFetch = (status, json) => async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => json }; };
  let t = flow.createFetchApi(fakeFetch(201, { id: "o1" }));
  let r = await t.createOrder({ product_id: U(11), quantity: 1, customer_name: "A", customer_phone: "677123456" });
  check("transport: create → POST /api/products/orders with the JSON body", r.ok && calls[0].url === "/api/products/orders" && calls[0].init.method === "POST" && JSON.parse(calls[0].init.body).product_id === U(11));
  await t.pay(U(500), { phone: "677123456", medium: "mobile money" });
  check("transport: pay → POST /api/products/orders/{id}/pay", calls[1].url === `/api/products/orders/${U(500)}/pay` && calls[1].init.method === "POST");
  await t.status(U(500));
  check("transport: status → GET /api/products/orders/{id}/pay-status, never cached", calls[2].url === `/api/products/orders/${U(500)}/pay-status` && !calls[2].init.method && calls[2].init.cache === "no-store");
  r = await flow.createFetchApi(fakeFetch(503, { error: "commerce_disabled" })).createOrder({});
  check("transport: known error code passes through", !r.ok && r.code === "commerce_disabled");
  r = await flow.createFetchApi(fakeFetch(500, { error: "SQL: relation \"x\" does not exist" })).createOrder({});
  check("transport: unknown/server text never leaks (→ internal_error)", !r.ok && r.code === "internal_error");
  r = await flow.createFetchApi(fakeFetch(502, "not json")).createOrder({});
  check("transport: a non-JSON error body → internal_error", !r.ok && r.code === "internal_error");
  r = await flow.createFetchApi(async () => { throw new Error("offline"); }).createOrder({});
  check("transport: a network failure → network_error", !r.ok && r.code === "network_error");
}

// ================================================================ 4. what the customer sees (server-rendered view)
{
  const { renderToStaticMarkup } = require("react-dom/server");
  const React = require("react");
  const { LanguageProvider } = loadSrc(path.join(REPO, "src/components/LanguageProvider.tsx"));
  const ProductCheckout = loadSrc(path.join(REPO, "src/components/checkout/ProductCheckout.tsx"));
  const props = { product: { id: U(11), name: "Blue Widget", description: "A very nice widget", image: null, unitPrice: 6000, currency: "XAF", maxQuantity: 10, lowStock: 3 }, seller: { name: "Chez Ali", username: "ali" }, theme: { accent: "#D4A954", bg: "#0A0A0A", fg: "#FAFAFA" }, productHref: "/ali/item/p", sellerHref: "/ali" };
  const html = (over = {}) => renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(ProductCheckout.default, { ...props, ...over }))).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
  let h = html();
  check("view: shows what/how much/who — name, price, seller", h.includes("Blue Widget") && /6[\s  .,]?000/.test(h) && h.includes("Chez Ali") && h.includes("A very nice widget"));
  check("view: quantity, details form fields and both Mobile Money options", h.includes('inputMode="tel"') && (h.match(/<input/g) || []).length >= 4 && h.includes("MTN MoMo") && h.includes("Orange Money") && h.includes('role="radiogroup"'));
  check("view: the pay button shows the total and is enabled", /Payer|Pay/.test(h) && !/disabled=""[^>]*aria-busy/.test(h));
  check("view: low-stock hint shown", /3/.test(h) && /Plus que 3|Only 3 left/.test(h));
  check("view: no shipping/address/cart/coupon UI in V1", !/address|adresse|coupon|cart|panier|delivery|livraison|shipping|expédition/i.test(h.replace(/autoComplete="[^"]*"/g, "")));
  check("view: bilingual — the default (FR) renders French labels", /Nom complet/.test(h) && /Numéro de téléphone/.test(h) && /Paiement/.test(h));
  h = html({ unavailableCode: "commerce_disabled" });
  check("view: unavailable product → friendly message and a way back, no form", /n'est pas disponible/.test(h) && /Retour au produit/.test(h) && !h.includes('inputMode="tel"'));
  check("view: no raw error code is shown to the customer", !h.includes("commerce_disabled"));
  h = html({ unavailableCode: "product_unavailable" });
  check("view: product_unavailable has its own friendly message", /plus disponible/.test(h) && !h.includes("product_unavailable"));
  h = html({ prefill: { name: "Amina Bello", phone: "677123456", email: "amina@example.com" } });
  check("view: a signed-in customer's own details prefill the form", h.includes("Amina Bello") && h.includes("677123456") && h.includes("amina@example.com"));
  h = html({ initialOrderId: U(500) });
  check("view: with an order id it renders the safe 'resuming' shell (no form flash claiming success)", !/Paiement reçu|Payment received/.test(h));
  check("view: no internal ids, provider names other than Fapshi, or secrets leak into the markup", !/service_role|apikey|SUPABASE|fapshi_/i.test(h) && !h.includes("commission"));
}

// ================================================================ 4b. every phase, as the customer would see it
{
  const { renderToStaticMarkup } = require("react-dom/server");
  const React = require("react");
  const { LanguageProvider } = loadSrc(path.join(REPO, "src/components/LanguageProvider.tsx"));
  const ProductCheckout = loadSrc(path.join(REPO, "src/components/checkout/ProductCheckout.tsx"));
  const base = { product: { id: U(11), name: "Blue Widget", description: null, image: null, unitPrice: 6000, currency: "XAF", maxQuantity: 10, lowStock: null }, seller: { name: "Chez Ali", username: "ali" }, theme: { accent: "#D4A954", bg: "#0A0A0A", fg: "#FAFAFA" }, productHref: "/ali/item/p", sellerHref: "/ali" };
  const render = (controller) => renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(ProductCheckout.default, { ...base, controller }))).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
  const driven = async (setup) => { const api = mockApi(); const c = ctlOf(api); fill(c); c.edit({ payPhone: "677123456" }); await setup(api, c); return { api, c, html: render(c) }; };

  let r = await driven(async (api, c) => { await c.submit(); });
  check("phase waiting: 'confirm on your phone', dial hint, order reference and total", /Confirmez sur votre téléphone/.test(r.html) && /\*126#/.test(r.html) && /PO-000007/.test(r.html) && /12[\s  .,]?000/.test(r.html) && /vérifier maintenant/.test(r.html));
  check("phase waiting: no form and no pay bar while the request is out", !r.html.includes('inputMode="tel"') && !/Payer /.test(r.html.replace(/Paiement/g, "")));
  r = await driven(async (api, c) => { c.edit({ medium: "orange money" }); await c.submit(); });
  check("phase waiting: the Orange Money dial hint for Orange", /#150#/.test(r.html) && !/\*126#/.test(r.html));
  r = await driven(async (api, c) => { await c.submit(); api.statuses = [paidView(api)]; await c.poll(); });
  check("phase success: receipt with receipt no., order no., product × qty, amount, seller, date and Paid status", /Paiement reçu/.test(r.html) && /RCP-000007/.test(r.html) && /PO-000007/.test(r.html) && /Widget × 2/.test(r.html) && /Chez Ali/.test(r.html) && /Payé/.test(r.html) && /12[\s  .,]?000/.test(r.html) && /2026|nov/i.test(r.html));
  check("phase success: no pay button and no form any more, and a way back to the seller", !/Payer /.test(r.html.replace(/Paiement/g, "")) && !r.html.includes('inputMode="tel"') && /Retour à Chez Ali/.test(r.html) && r.html.includes('href="/ali"'));
  r = await driven(async (api, c) => { await c.submit(); api.statuses = [view(api, "failed", { code: "payment_failed" })]; await c.poll(); });
  check("phase failed: clear message, retry button, payment fields kept (no name/email form again)", /Le paiement n'a pas abouti/.test(r.html) && /Réessayer/.test(r.html) && /MTN MoMo/.test(r.html) && !/Nom complet/.test(r.html));
  r = await driven(async (api, c) => { await c.submit(); api.statuses = [view(api, "expired", { code: "payment_expired" })]; await c.poll(); });
  check("phase expired: 'request expired' with retry", /Demande de paiement expirée/.test(r.html) && /Réessayer/.test(r.html));
  r = await driven(async (api, c) => { await c.submit(); api.statuses = [view(api, "expired", { code: "order_expired" })]; await c.poll(); });
  check("phase order_expired: 'order expired' with start again, no pay button", /Votre commande a expiré/.test(r.html) && /Recommencer/.test(r.html) && !/Payer /.test(r.html.replace(/Paiement/g, "")));
  r = await driven(async (api, c) => { await c.submit(); api.statuses = [view(api, "review", { code: "payment_review" })]; await c.poll(); });
  check("phase review: 'we're checking your order' with the order number and a link to the seller", /Nous vérifions votre commande/.test(r.html) && /PO-000007/.test(r.html) && /Retour à Chez Ali/.test(r.html));
  r = await driven(async (api, c) => { await c.submit(); api.statuses = [paidView(api)]; await c.poll(); });
  check("nothing claims success while pending: a pending/failed/review render never shows the success title", ["waiting", "failed", "review"].every(() => true) && !/Paiement reçu/.test((await driven(async (api, c) => { await c.submit(); })).html) && !/Paiement reçu/.test((await driven(async (api, c) => { await c.submit(); api.statuses = [view(api, "review", { code: "payment_review" })]; await c.poll(); })).html));

  // form-level UI: payment-only re-entry, field errors, busy state
  const api2 = mockApi(); api2.statuses = [view(api2, "not_started")]; const c2 = ctlOf(api2); await c2.resume(U(500));
  let html2 = render(c2);
  check("re-entry (payment only): order summary + payment step, without the contact fields", /Blue Widget|Widget/.test(html2) && /MTN MoMo/.test(html2) && !/Nom complet/.test(html2) && !/Note pour le vendeur/.test(html2) && /PO-000007|Widget/.test(html2));
  const c3 = ctlOf(mockApi()); await c3.submit(); html2 = render(c3);
  check("field errors are shown in French, next to the fields, with alert semantics", /Veuillez saisir votre nom/.test(html2) && /numéro de téléphone valide/.test(html2) && /role="alert"/.test(html2));
  check("no raw error codes appear next to fields", !/invalid_name|invalid_phone/.test(html2));
  const slow = mockApi({ delay: 40 }); const c4 = ctlOf(slow); fill(c4); c4.edit({ payPhone: "677123456" }); const pending = c4.submit(); const busyHtml = render(c4); await pending;
  check("busy state: the pay button is disabled, shows progress and is aria-busy (no double submit from the UI)", /aria-busy="true"/.test(busyHtml) && /disabled=""/.test(busyHtml) && /Veuillez patienter/.test(busyHtml));
  const c5 = ctlOf(mockApi({ createResult: { ok: false, code: "insufficient_stock" } })); fill(c5); c5.edit({ payPhone: "677123456" }); await c5.submit();
  check("stock error is shown as a friendly message on the quantity", /stock est insuffisant/.test(render(c5)));
  const c6 = ctlOf(mockApi({ payResult: { ok: false, code: "network_error" } })); fill(c6); c6.edit({ payPhone: "677123456" }); await c6.submit();
  check("network error while paying: friendly message, order kept (payment-only form)", /Problème de connexion/.test(render(c6)) && !/Nom complet/.test(render(c6)));
}

// ================================================================ 4c. seller branding stays legible (any accent color)
{
  const K = P("contrast.ts");
  const accents = ["#D4A954", "#7C3AED", "#1E3A8A", "#166534", "#EC4899", "#FDE68A", "#111111", "#FFFFFF", "#FF0000", "#0000FF", "#00FF00", "#808080", "#0F766E", "#F97316"];
  check("branding: text on ANY accent is legible (>= 4.4:1 with the color chosen)", accents.every((a) => K.contrastRatio(K.onAccent(a), a) >= 4.4), accents.filter((a) => K.contrastRatio(K.onAccent(a), a) < 4.4).join());
  check("branding: dark accents get white text, light accents get dark text", K.onAccent("#1E3A8A") === "#FFFFFF" && K.onAccent("#166534") === "#FFFFFF" && K.onAccent("#7C3AED") === "#FFFFFF" && K.onAccent("#D4A954") === "#111111" && K.onAccent("#FDE68A") === "#111111");
  check("branding: an accent too dark to read as text on a dark page falls back to the normal text color", K.readableAccent("#1E3A8A", "#0A0A0A", "#FAFAFA") === "#FAFAFA" && K.readableAccent("#D4A954", "#0A0A0A", "#FAFAFA") === "#D4A954");
  check("branding: an accent too light to read as text on a light page falls back too", K.readableAccent("#FDE68A", "#FFFFFF", "#111111") === "#111111" && K.readableAccent("#1E3A8A", "#FFFFFF", "#111111") === "#1E3A8A");
  check("branding: malformed colors never throw and keep the previous look", K.onAccent("gold") === "#111111" && K.onAccent("") === "#111111" && K.readableAccent("gold", "#000000", "#fff") === "gold" && K.contrastRatio("x", "#000000") === 0);
  const comp = read("src/components/checkout/ProductCheckout.tsx");
  check("branding: the checkout view has no hard-coded text color on the accent, and uses the helpers", !/color: "#111"/.test(comp) && /onAccent\(accent\)/.test(comp) && /readableAccent\(accent, bg, fg\)/.test(comp));
  const { renderToStaticMarkup } = require("react-dom/server");
  const React = require("react");
  const { LanguageProvider } = loadSrc(path.join(REPO, "src/components/LanguageProvider.tsx"));
  const ProductCheckout = loadSrc(path.join(REPO, "src/components/checkout/ProductCheckout.tsx"));
  const base = { product: { id: U(11), name: "W", description: null, image: null, unitPrice: 6000, currency: "XAF", maxQuantity: 10, lowStock: null }, seller: { name: "S", username: "s" }, productHref: "/p", sellerHref: "/s" };
  const navy = renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(ProductCheckout.default, { ...base, theme: { accent: "#1E3A8A", bg: "#FFFFFF", fg: "#111111" } })));
  check("branding: on a navy brand the pay button renders white text on navy", /background-color:#1E3A8A;color:#FFFFFF/.test(navy) || /background-color:#1E3A8A;color:#fff/i.test(navy));
  const gold = renderToStaticMarkup(React.createElement(LanguageProvider, null, React.createElement(ProductCheckout.default, { ...base, theme: { accent: "#D4A954", bg: "#0A0A0A", fg: "#FAFAFA" } })));
  check("branding: the default gold look is unchanged (dark text on gold)", /background-color:#D4A954;color:#111111/.test(gold));
}

// ================================================================ 5. translations
{
  const en = translations.en.productCheckout, fr = translations.fr.productCheckout;
  const keysOf = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keysOf(v, pre + k + ".") : [pre + k]));
  check("i18n: EN and FR have identical checkout keys", JSON.stringify(keysOf(en).sort()) === JSON.stringify(keysOf(fr).sort()));
  const codes = [...Object.keys(HTTP_STATUS), "network_error", "generic"];
  check("i18n: every backend error code has a message in EN and FR", codes.every((c) => typeof en.errors[c] === "string" && en.errors[c].length > 5 && typeof fr.errors[c] === "string" && fr.errors[c].length > 5), codes.filter((c) => !en.errors[c] || !fr.errors[c]).join());
  check("i18n: messages are friendly — no SQL, stack, provider or code text", codes.every((c) => !/sql|stack|exception|fapshi|apikey|error code|_/i.test(en.errors[c] + fr.errors[c])), codes.filter((cc) => /sql|stack|exception|fapshi|apikey|_/i.test(en.errors[cc] + fr.errors[cc])).join());
  check("i18n: FR differs from EN for the important strings", ["waitingTitle", "successTitle", "failedTitle", "payButton"].every((k) => (typeof en[k] === "function" ? en[k]("X") !== fr[k]("X") : en[k] !== fr[k])));
  check("i18n: function strings work", en.payButton("6,000 XAF") === "Pay 6,000 XAF" && fr.payButton("6 000 FCFA") === "Payer 6 000 FCFA" && en.onlyLeft(3) === "Only 3 left" && /3/.test(fr.onlyLeft(3)));
  check("flow: friendlyCode maps unknown codes to the generic message", flow.friendlyCode("weird") === "generic" && flow.friendlyCode(null) === "generic" && flow.friendlyCode("order_expired") === "order_expired" && flow.friendlyCode("network_error") === "network_error");
}

// ================================================================ 6. security + integration (source-level)
{
  const flowSrc = strip(read("src/lib/productCheckout/clientFlow.ts"));
  const comp = strip(read("src/components/checkout/ProductCheckout.tsx"));
  const page = strip(read("src/app/[username]/item/[id]/checkout/page.tsx"));
  const item = strip(read("src/app/[username]/item/[id]/page.tsx"));
  const pdv = strip(read("src/components/catalog/ProductDetailView.tsx"));
  const musicItem = read("src/app/m/[username]/[type]/[id]/page.tsx");

  check("security: the browser body builders never include price/total/currency/profile/creator/commission/stock/amount", !/(price|total|subtotal|currency|profile_id|creator|commission|platform_fee|net_amount|stock|amount)\s*:/.test(flowSrc.slice(flowSrc.indexOf("export function buildCreateBody"), flowSrc.indexOf("const PLACEHOLDER"))));
  check("security: the client never talks to Supabase, Fapshi or the service role", !/supabase|fapshi|service_role|createAdminClient|platformSettings|commerce_enabled|commission_rate/i.test(flowSrc + comp));
  check("security: no eligibility rules are re-implemented in the browser view or controller", !/commerceEnabled|fapshiEnabled|is_demo|checkCommerceEligibility|checkProfileEligibility/.test(comp + flowSrc));
  check("security: eligibility is decided on the server (checkout page and item page)", /getCheckoutBlock\(/.test(page) && /computeCheckoutAvailability\(/.test(item) && !/checkCommerceEligibility|commerceEnabled/.test(pdv));
  check("security: the item page passes only the server-computed boolean", /checkoutAvailable=\{checkoutAvailable\}/.test(item));
  check("security: the checkout page is dynamic and non-indexed", /export const dynamic = "force-dynamic"/.test(read("src/app/[username]/item/[id]/checkout/page.tsx")) && /index: false/.test(read("src/app/[username]/item/[id]/checkout/page.tsx")));
  check("security: music profiles never reach this checkout page", /profileHasCategory\(profile, "music_entertainment"\)\) return notFound\(\)/.test(page));
  check("security: only whitelisted product/seller fields are passed to the client component", !/\.\.\.profile|\.\.\.product|profile=\{profile\}|product=\{product\}/.test(page));
  check("security: a returning customer can still open their receipt when checkout is off", /unavailableCode=\{orderId \? null : block\}/.test(page));
  check("security: the customer's own session prefill only (no other customer data)", /getCustomerFromCookie\(\)/.test(page) && /session\.customer\.(name|phone|email)/.test(page) && !/session\.customer\.id/.test(page));
  check("security: success is only ever set from the backend's succeeded status", (flowSrc.match(/phase: "success"/g) || []).length === 1 && /case "succeeded":\s*\n\s*this\.set\(\{ phase: "success"/.test(flowSrc));
  check("security: same-origin protections untouched (order route still gates the session link)", /isSameOrigin\(request\)/.test(read("src/app/api/products/orders/route.ts")));
  check("integration: the music item route passes no checkout capability (music keeps its own flow)", !/checkoutAvailable|product_checkout|productCheckout|computeCheckoutAvailability/.test(musicItem));
  check("integration: ProductDetailView keeps the sold-out check before any route", /const route = soldOut \? null : customerActionRoute\(/.test(pdv));
  check("integration: the CTA engine only receives a boolean capability + currency/demo", /checkoutAvailable,\s*\n\s*currency: profile\.currency,\s*\n\s*isDemo: profile\.is_demo === true/.test(pdv));
  check("integration: editor uses the same product rules and a server flag", /checkProductEligibility\(/.test(read("src/components/editor/CatalogCard.tsx")) && /commerceCheckoutAvailable/.test(read("src/components/editor/CatalogCard.tsx")) && /computeProfileCheckoutAvailability\(profile\)/.test(read("src/app/dashboard/page.tsx")));
  check("integration: no cart / shipping / coupon / subscription / Stripe code added", !/stripe|cart|coupon|shipping|discount|installment|subscription/i.test(flowSrc + comp + page));
  const prevw = strip(read("src/app/dev-preview-checkout/page.tsx"));
  check("safety: the mock preview page 404s in production and uses a mock API only", /NODE_ENV === "production"\) return notFound\(\)/.test(prevw) && !/fetch\(|createFetchApi|supabase/.test(strip(read("src/components/checkout/CheckoutPreview.tsx"))));
  check("safety: the checkout view never calls fetch itself (all traffic goes through the injectable API)", !/\bfetch\(/.test(comp));
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
