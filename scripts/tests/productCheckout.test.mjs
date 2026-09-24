// Product checkout (Increment 2): order creation, payment initiation, status check and settlement.
// Runs entirely against an IN-MEMORY store and a SCRIPTED fake Fapshi — no database, no network, no
// real payments. The in-memory store mirrors the rules the Increment 1 migration enforces (guarded
// status transitions, one live payment attempt per order, one earning per order/payment, exactly-once
// stock release); it proves the TypeScript logic, NOT the SQL itself (that needs the real database).
//   Run:  node scripts/tests/productCheckout.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const L = (f) => jiti(path.join(REPO, "src/lib/productCheckout", f));
const { createProductOrder } = L("createOrder.ts");
const { initiateProductPayment } = L("initiatePayment.ts");
const { checkProductPayment, normalizeProviderStatus } = L("checkPayment.ts");
const { settleProductPayment } = L("settlement.ts");
const { computeEarnings, toCents, sameAmount, isWholeAmount } = L("money.ts");
const { parseCreateOrderInput, parsePayInput, normalizePayerPhone, isUuid } = L("validation.ts");
const { formatProductOrderNumber, formatProductReceiptNumber } = L("format.ts");
const { codeFromDbMessage, HTTP_STATUS } = L("errors.ts");
const C = L("constants.ts");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------- in-memory world
const TRANSITIONS_ORDER = {
  awaiting_payment: ["paid", "expired", "cancelled", "payment_review"],
  expired: ["paid", "payment_review"],
  cancelled: ["payment_review"],
  payment_review: ["paid", "refunded", "cancelled"],
  paid: ["fulfilled", "refunded", "payment_review"],
  fulfilled: ["refunded"],
  refunded: [],
};
const TRANSITIONS_PAYMENT = {
  initiated: ["pending", "succeeded", "failed", "expired", "cancelled"],
  pending: ["succeeded", "failed", "expired", "cancelled"],
  expired: ["succeeded"],
  cancelled: ["succeeded"],
  failed: [],
  succeeded: [],
};
const LIVE = ["initiated", "pending"];

function makeWorld(opts = {}) {
  const clock = { t: Date.parse("2026-11-03T10:00:00Z") };
  const now = () => new Date(clock.t);
  const db = {
    settings: { commerceEnabled: true, commissionRate: 0.05, fapshiEnabled: true, ...(opts.settings || {}) }, // TEST values only
    profiles: new Map(),
    products: new Map(),
    orders: new Map(),
    items: [],
    payments: [],
    earnings: [],
    seq: 0,
    releases: 0,
    logs: [],
    calls: { getProfile: 0 },
  };
  db.profiles.set(U(1), { id: U(1), user_id: U(101), username: "shop", currency: "XAF", published: true, is_demo: false, category: "business_ecommerce", categories: ["business_ecommerce"], ...(opts.profile || {}) });
  db.products.set(U(11), { id: U(11), profile_id: U(1), name: "Widget", price: 6000, available: true, inventory_count: 20, image_url: "https://img/w.png", ...(opts.product || {}) });
  const copy = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  const store = {
    async getSettings() { return copy(db.settings); },
    async getProduct(id) { return copy(db.products.get(id) || null); },
    async getProfile(id) { db.calls.getProfile++; return copy(db.profiles.get(id) || null); },
    // emulates create_product_order(): same gates, same error codes, atomic stock + rows
    async createOrder(a) {
      const fail = (code) => ({ ok: false, code });
      if (!Number.isInteger(a.quantity) || a.quantity < 1) return fail("invalid_quantity");
      if (a.quantity > 10) return fail("quantity_exceeds_max");
      const s = db.settings;
      if (!s.commerceEnabled || s.commissionRate == null) return fail("commerce_disabled");
      if (!s.fapshiEnabled) return fail("payment_provider_unavailable");
      const p = db.profiles.get(a.profileId);
      if (!p || !p.published || p.is_demo) return fail("profile_unavailable");
      if (p.category === "music_entertainment" || (p.categories || []).includes("music_entertainment")) return fail("music_profile_not_supported");
      const cur = (p.currency || "USD").toUpperCase();
      if (cur !== "XAF") return fail("commerce_currency_unsupported");
      const open = [...db.orders.values()].filter((o) => o.profile_id === a.profileId && o.customer_phone === a.phone && o.status === "awaiting_payment" && Date.parse(o.expires_at) > clock.t).length;
      if (open >= 3) return fail("too_many_open_orders");
      const pr = db.products.get(a.productId);
      const sellable = pr && pr.profile_id === a.profileId && pr.available !== false && pr.name && pr.name.trim() && pr.price != null && pr.price > 0;
      if (!sellable) return fail("product_unavailable");
      if (pr.inventory_count !== null && pr.inventory_count < a.quantity) return fail("insufficient_stock");
      if (pr.inventory_count !== null) pr.inventory_count -= a.quantity;
      const subtotal = pr.price * a.quantity; // database price x validated quantity
      const order = { id: U(1000 + ++db.seq), order_number: db.seq, profile_id: a.profileId, customer_id: a.customerId, customer_name: a.name, customer_phone: a.phone, customer_email: a.email, customer_note: a.note, currency: cur, subtotal, total: subtotal, status: "awaiting_payment", expires_at: new Date(clock.t + a.reservationMinutes * 60000).toISOString(), paid_at: null, stock_released_at: null, created_at: new Date(clock.t).toISOString() };
      const item = { id: U(2000 + db.seq), order_id: order.id, product_id: pr.id, name_snapshot: pr.name, image_snapshot: pr.image_url || null, unit_price_snapshot: pr.price, quantity: a.quantity, line_total: subtotal };
      db.orders.set(order.id, order);
      db.items.push(item);
      return { ok: true, order: copy(order), item: copy(item) };
    },
    async getOrder(id) { const o = db.orders.get(id); return o ? { order: copy(o), items: copy(db.items.filter((i) => i.order_id === id)) } : null; },
    async updateOrder(id, patch, expect) {
      const o = db.orders.get(id);
      if (!o || o.status !== expect) return false;
      if (patch.status && patch.status !== o.status && !TRANSITIONS_ORDER[o.status].includes(patch.status)) throw new Error(`illegal order transition ${o.status} -> ${patch.status}`);
      if (patch.status && ["paid", "fulfilled", "refunded"].includes(patch.status) && !(patch.paid_at || o.paid_at)) throw new Error("paid_at required");
      Object.assign(o, patch);
      return true;
    },
    async releaseOrder(id, status) {
      const o = db.orders.get(id);
      if (!o || o.status !== "awaiting_payment" || o.stock_released_at) return false;
      if (status === "expired" && Date.parse(o.expires_at) > clock.t) return false;
      if (db.payments.some((p) => p.target_id === id && LIVE.includes(p.status) && Date.parse(p.expires_at) > clock.t)) return false;
      o.status = status;
      o.stock_released_at = new Date(clock.t).toISOString();
      for (const it of db.items.filter((i) => i.order_id === id)) {
        const pr = db.products.get(it.product_id);
        if (pr && pr.inventory_count !== null) pr.inventory_count += it.quantity;
      }
      db.releases++;
      return true;
    },
    async listPayments(orderId) { return copy(db.payments.filter((p) => p.target_id === orderId).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || 0).reverse().reverse()); },
    async getPayment(id) { return copy(db.payments.find((p) => p.id === id) || null); },
    async insertPayment(row) {
      if (db.payments.some((p) => p.external_id === row.external_id)) throw new Error("dup external id");
      if (LIVE.includes(row.status) && db.payments.some((p) => p.target_id === row.target_id && LIVE.includes(p.status))) return { ok: false, reason: "duplicate_live" };
      db.payments.unshift(copy(row)); // newest first
      return { ok: true };
    },
    async updatePayment(id, patch, expect) {
      const p = db.payments.find((x) => x.id === id);
      if (!p || !expect.includes(p.status)) return false;
      if (patch.status && patch.status !== p.status && !TRANSITIONS_PAYMENT[p.status].includes(patch.status)) throw new Error(`illegal payment transition ${p.status} -> ${patch.status}`);
      if (patch.status === "succeeded" && !patch.confirmed_at) throw new Error("confirmed_at required");
      Object.assign(p, patch);
      return true;
    },
    async getEarningByOrder(orderId) { return copy(db.earnings.find((e) => e.order_id === orderId) || null); },
    async insertEarning(row) {
      if (db.earnings.some((e) => e.order_id === row.order_id || e.payment_id === row.payment_id)) return "exists";
      if (Math.round(row.gross_amount * 100) !== Math.round(row.platform_fee * 100) + Math.round(row.net_amount * 100)) throw new Error("gross != fee + net");
      db.earnings.push({ ...copy(row), status: "recorded" });
      return "inserted";
    },
  };

  let tx = 0;
  const provider = {
    calls: [], statuses: new Map(), failDirect: false, failStatus: false, statusCalls: 0,
    async directPay(p) {
      if (this.failDirect) throw new Error("provider secret detail: apikey=abc123");
      const transId = `TX-${++tx}`;
      this.calls.push(p);
      this.statuses.set(transId, { status: "CREATED", amount: p.amount });
      return { transId };
    },
    async getStatus(id) {
      this.statusCalls++;
      if (this.failStatus) throw new Error("provider down");
      const s = this.statuses.get(id);
      if (!s) throw new Error("unknown transaction");
      return { status: s.status, amount: s.amount, reason: s.reason ?? null };
    },
  };
  let idn = 5000;
  const deps = { store, provider, now, newId: () => U(++idn), log: (e, d) => db.logs.push({ e, d }), onOrderPaid: opts.onOrderPaid };
  return { db, deps, provider, clock, minutes: (m) => (clock.t += m * 60000) };
}

const goodOrder = (over = {}) => ({ product_id: U(11), quantity: 2, customer_name: "Amina  Bello", customer_phone: "+237 677 12 34 56", customer_email: "Amina@Example.com", note: "Call before delivery", ...over });
const goodPay = (over = {}) => ({ phone: "677 12 34 56", medium: "mobile money", ...over });
async function newOrder(w, over, ctx = { customerId: null }) {
  const r = await createProductOrder(w.deps, goodOrder(over), ctx);
  if (!r.ok) throw new Error("setup order failed: " + r.code);
  return r.data;
}
async function paying(w, over) {
  const o = await newOrder(w, over);
  const p = await initiateProductPayment(w.deps, o.id, goodPay());
  if (!p.ok) throw new Error("setup payment failed: " + p.code);
  return { order: o, payment: w.db.payments[0], transId: w.db.payments[0].provider_transaction_id };
}
const codeOf = (r) => (r.ok ? "OK" : r.code);

// ================================================================ 1. ORDER API
{
  let w = makeWorld();
  check("order: invalid product id (not a uuid)", codeOf(await createProductOrder(w.deps, goodOrder({ product_id: "abc" }), { customerId: null })) === "product_unavailable");
  check("order: unknown product", codeOf(await createProductOrder(w.deps, goodOrder({ product_id: U(999) }), { customerId: null })) === "product_unavailable");
  w = makeWorld({ product: { available: false } });
  check("order: unavailable product", codeOf(await createProductOrder(w.deps, goodOrder(), { customerId: null })) === "product_unavailable");
  w = makeWorld({ product: { price: 0 } });
  check("order: zero price", codeOf(await createProductOrder(w.deps, goodOrder(), { customerId: null })) === "product_unavailable");
  w = makeWorld({ product: { price: null } });
  check("order: no price", codeOf(await createProductOrder(w.deps, goodOrder(), { customerId: null })) === "product_unavailable");
  w = makeWorld({ product: { name: "  " } });
  check("order: unnamed product", codeOf(await createProductOrder(w.deps, goodOrder(), { customerId: null })) === "product_unavailable");

  w = makeWorld();
  for (const q of [0, -1, 1.5, "abc", null, undefined, NaN, {}]) {
    check(`order: invalid quantity ${JSON.stringify(q)}`, codeOf(await createProductOrder(w.deps, goodOrder({ quantity: q }), { customerId: null })) === "invalid_quantity");
  }
  check("order: quantity 11 > max", codeOf(await createProductOrder(w.deps, goodOrder({ quantity: 11 }), { customerId: null })) === "quantity_exceeds_max");
  check("order: quantity 10 is allowed", codeOf(await createProductOrder(w.deps, goodOrder({ quantity: 10 }), { customerId: null })) === "OK");
  check("order: numeric-string quantity accepted", codeOf(await createProductOrder(makeWorld().deps, goodOrder({ quantity: "3" }), { customerId: null })) === "OK");

  const gates = [
    ["non-XAF profile", { profile: { currency: "USD" } }, "commerce_currency_unsupported"],
    ["missing currency (defaults USD)", { profile: { currency: null } }, "commerce_currency_unsupported"],
    ["music profile", { profile: { category: "music_entertainment", categories: ["music_entertainment"] } }, "music_profile_not_supported"],
    ["music as a secondary category", { profile: { category: "business_ecommerce", categories: ["business_ecommerce", "music_entertainment"] } }, "music_profile_not_supported"],
    ["demo profile", { profile: { is_demo: true } }, "profile_unavailable"],
    ["unpublished profile", { profile: { published: false } }, "profile_unavailable"],
    ["commerce disabled", { settings: { commerceEnabled: false } }, "commerce_disabled"],
    ["commission rate not set", { settings: { commissionRate: null } }, "commerce_disabled"],
    ["Fapshi disabled", { settings: { fapshiEnabled: false } }, "payment_provider_unavailable"],
    ["insufficient stock", { product: { inventory_count: 1 } }, "insufficient_stock"],
    ["sold out", { product: { inventory_count: 0 } }, "insufficient_stock"],
  ];
  for (const [name, o, code] of gates) {
    const x = makeWorld(o);
    const before = x.db.products.get(U(11)).inventory_count;
    check(`order: ${name} → ${code}`, codeOf(await createProductOrder(x.deps, goodOrder(), { customerId: null })) === code);
    check(`order: ${name} → stock untouched, no order row`, x.db.products.get(U(11)).inventory_count === before && x.db.orders.size === 0);
  }
  w = makeWorld({ product: { inventory_count: null } });
  check("order: NULL inventory means unlimited", codeOf(await createProductOrder(w.deps, goodOrder({ quantity: 10 }), { customerId: null })) === "OK" && w.db.products.get(U(11)).inventory_count === null);
  w = makeWorld({ product: { price: 1000.5 } });
  check("order: non-whole XAF total refused", codeOf(await createProductOrder(w.deps, goodOrder({ quantity: 1 }), { customerId: null })) === "product_price_unsupported");
  check("order: non-whole unit price is fine when the total is whole", codeOf(await createProductOrder(w.deps, goodOrder({ quantity: 2 }), { customerId: null })) === "OK");

  // valid creation + server-authoritative price
  w = makeWorld();
  const r = await createProductOrder(w.deps, { ...goodOrder(), price: 1, total: 1, subtotal: 1, currency: "USD", profile_id: U(777), creator_user_id: U(778), commission_rate: 0, platform_fee: 0, net_amount: 999999, stock: 9999, amount: 1 }, { customerId: null });
  check("order: valid creation", r.ok && r.data.status === "awaiting_payment" && r.data.order_number === "PO-000001");
  check("order: server-authoritative price/total/currency (browser values ignored)", r.ok && r.data.total === 12000 && r.data.subtotal === 12000 && r.data.currency === "XAF" && r.data.items[0].unit_price === 6000);
  const stored = w.db.orders.get(r.data.id);
  check("order: profile comes from the product, not the request", stored.profile_id === U(1));
  check("order: stock reserved atomically by the store (20 - 2)", w.db.products.get(U(11)).inventory_count === 18);
  check("order: contact snapshot normalised", stored.customer_name === "Amina Bello" && stored.customer_phone === "+237677123456" && stored.customer_email === "amina@example.com");
  check("order: the view exposes no phone/email/customer id", !JSON.stringify(r.data).match(/237677|amina|customer/i));
  check("order: reservation window is the configured constant", Math.round((Date.parse(stored.expires_at) - clock0(w)) / 60000) === C.RESERVATION_MINUTES);
  check("order: item snapshot (name, image, price, qty, line total)", r.ok && r.data.items[0].name === "Widget" && r.data.items[0].image === "https://img/w.png" && r.data.items[0].quantity === 2 && r.data.items[0].line_total === 12000);
  // price change after order creation does not change the order
  w.db.products.get(U(11)).price = 1;
  check("order: later price change does not affect the snapshot", w.db.orders.get(r.data.id).total === 12000 && w.db.items[0].unit_price_snapshot === 6000);

  // customer identity
  w = makeWorld();
  const g = await newOrder(w, {}, { customerId: null });
  check("order: guest checkout works (customer_id null)", w.db.orders.get(g.id).customer_id === null);
  const c = await newOrder(w, {}, { customerId: U(55) });
  check("order: session customer id is attached (from ctx, never the body)", w.db.orders.get(c.id).customer_id === U(55));
  const spoof = await createProductOrder(w.deps, { ...goodOrder(), customer_id: U(66) }, { customerId: null });
  check("order: a customer_id in the body is ignored", spoof.ok && w.db.orders.get(spoof.data.id).customer_id === null);

  // open-order cap
  w = makeWorld();
  for (let i = 0; i < 3; i++) await newOrder(w, { quantity: 1 });
  check("order: 4th open order for one phone → too_many_open_orders", codeOf(await createProductOrder(w.deps, goodOrder({ quantity: 1 }), { customerId: null })) === "too_many_open_orders");
  check("order: cap is per phone", codeOf(await createProductOrder(w.deps, goodOrder({ quantity: 1, customer_phone: "699999999" }), { customerId: null })) === "OK");

  // input validation
  w = makeWorld();
  check("validation: body must be an object", ["x", null, [], 5].every((b) => parseCreateOrderInput(b).ok === false));
  check("validation: name required", codeOf(await createProductOrder(w.deps, goodOrder({ customer_name: "  " }), { customerId: null })) === "invalid_name");
  check("validation: name max 120", codeOf(await createProductOrder(w.deps, goodOrder({ customer_name: "x".repeat(121) }), { customerId: null })) === "invalid_name");
  for (const ph of ["12", "abcdefgh", "", null, "+" + "1".repeat(20)]) check(`validation: contact phone ${JSON.stringify(ph)} rejected`, codeOf(await createProductOrder(w.deps, goodOrder({ customer_phone: ph }), { customerId: null })) === "invalid_phone");
  check("validation: bad email rejected", codeOf(await createProductOrder(w.deps, goodOrder({ customer_email: "nope" }), { customerId: null })) === "invalid_email");
  check("validation: email and note are optional", codeOf(await createProductOrder(w.deps, goodOrder({ customer_email: "", note: null }), { customerId: null })) === "OK");
  check("validation: note over 500 rejected", codeOf(await createProductOrder(w.deps, goodOrder({ note: "n".repeat(501) }), { customerId: null })) === "invalid_request");
  check("validation: control characters stripped from name", parseCreateOrderInput(goodOrder({ customer_name: "Ann\u0000\u0007 Lee" })).value.name === "Ann Lee");
}
function clock0(w) { return w.clock.t; }

// ================================================================ 2. PAYMENT INITIATION
{
  let w = makeWorld();
  check("pay: invalid order id", codeOf(await initiateProductPayment(w.deps, "nope", goodPay())) === "order_not_found");
  check("pay: nonexistent order", codeOf(await initiateProductPayment(w.deps, U(4242), goodPay())) === "order_not_found");
  const o = await newOrder(w);
  check("pay: invalid phone", codeOf(await initiateProductPayment(w.deps, o.id, goodPay({ phone: "12345" }))) === "invalid_phone");
  check("pay: non-Cameroon-mobile phone", codeOf(await initiateProductPayment(w.deps, o.id, goodPay({ phone: "233 55 123 4567" }))) === "invalid_phone");
  check("pay: invalid medium", codeOf(await initiateProductPayment(w.deps, o.id, goodPay({ medium: "card" }))) === "invalid_payment_medium");
  check("pay: nothing reached the provider on invalid input", w.provider.calls.length === 0 && w.db.payments.length === 0);

  // valid initiation; amount cannot be client-controlled
  const ok1 = await initiateProductPayment(w.deps, o.id, { ...goodPay(), amount: 1, total: 1, currency: "USD", order_total: 1 });
  const call = w.provider.calls[0];
  check("pay: valid initiation → pending", ok1.ok && ok1.data.status === "pending");
  check("pay: provider charged the ORDER's amount, not a client amount", call.amount === 12000);
  check("pay: phone normalised, medium and references passed", call.phone === "677123456" && call.medium === "mobile money" && call.userId === o.id && /^pp-/.test(call.externalId));
  const pr = w.db.payments[0];
  check("pay: payment row (fapshi / product_order / order total / XAF / pending / txn id)", pr.provider === "fapshi" && pr.target_type === "product_order" && pr.target_id === o.id && pr.amount === 12000 && pr.currency === "XAF" && pr.status === "pending" && pr.provider_transaction_id === "TX-1" && pr.payer_medium === "mobile money" && pr.profile_id === U(1));
  check("pay: unique external_id per attempt", pr.external_id === `pp-${pr.id}`);
  check("pay: response exposes no provider ids / secrets", !JSON.stringify(ok1.data).match(/TX-|apikey|pp-/));
  check("pay: order reservation extended to cover the attempt", Date.parse(w.db.orders.get(o.id).expires_at) >= Date.parse(pr.expires_at));

  // duplicate live payment
  check("pay: duplicate live attempt refused", codeOf(await initiateProductPayment(w.deps, o.id, goodPay())) === "payment_already_pending");
  check("pay: only one provider call / one payment row", w.provider.calls.length === 1 && w.db.payments.length === 1);
  const racing = makeWorld(); const ro = await newOrder(racing);
  const both = await Promise.all([initiateProductPayment(racing.deps, ro.id, goodPay()), initiateProductPayment(racing.deps, ro.id, goodPay())]);
  check("pay: two simultaneous starts → exactly one wins", both.filter((x) => x.ok).length === 1 && racing.provider.calls.length === 1, both.map(codeOf).join());

  // order state gates
  for (const [status, code] of [["paid", "order_not_payable"], ["fulfilled", "order_not_payable"], ["cancelled", "order_not_payable"], ["refunded", "order_not_payable"], ["expired", "order_expired"], ["payment_review", "payment_review"]]) {
    const x = makeWorld(); const xo = await newOrder(x); x.db.orders.get(xo.id).status = status;
    check(`pay: ${status} order → ${code}`, codeOf(await initiateProductPayment(x.deps, xo.id, goodPay())) === code && x.provider.calls.length === 0);
  }
  // expired by the clock: refused AND stock released exactly once
  w = makeWorld(); const eo = await newOrder(w); w.minutes(31);
  check("pay: order past its window → order_expired", codeOf(await initiateProductPayment(w.deps, eo.id, goodPay())) === "order_expired");
  check("pay: lazy expiry restored the stock once (20)", w.db.products.get(U(11)).inventory_count === 20 && w.db.orders.get(eo.id).status === "expired");
  check("pay: second attempt does not release twice", codeOf(await initiateProductPayment(w.deps, eo.id, goodPay())) === "order_expired" && w.db.products.get(U(11)).inventory_count === 20 && w.db.releases === 1);

  // platform / profile / currency
  for (const [name, mut, code] of [
    ["Fapshi disabled", (x) => (x.db.settings.fapshiEnabled = false), "payment_provider_unavailable"],
    ["commerce disabled", (x) => (x.db.settings.commerceEnabled = false), "commerce_disabled"],
    ["profile became demo", (x) => (x.db.profiles.get(U(1)).is_demo = true), "profile_unavailable"],
    ["profile currency changed away from XAF", (x) => (x.db.profiles.get(U(1)).currency = "USD"), "commerce_currency_unsupported"],
    ["profile became a music profile", (x) => (x.db.profiles.get(U(1)).categories.push("music_entertainment")), "music_profile_not_supported"],
  ]) {
    const x = makeWorld(); const xo = await newOrder(x); mut(x);
    check(`pay: ${name} → ${code}`, codeOf(await initiateProductPayment(x.deps, xo.id, goodPay())) === code && x.provider.calls.length === 0 && x.db.payments.length === 0);
  }
  { const x = makeWorld(); const xo = await newOrder(x); x.db.orders.get(xo.id).currency = "USD";
    check("pay: an order not in XAF is refused (XAF enforced)", codeOf(await initiateProductPayment(x.deps, xo.id, goodPay())) === "commerce_currency_unsupported" && x.provider.calls.length === 0); }
  { const x = makeWorld({ product: { price: 1000.5 } }); const xo = await newOrder(x, { quantity: 2 }); x.db.orders.get(xo.id).total = 2001.5;
    check("pay: a non-whole XAF amount is refused", codeOf(await initiateProductPayment(x.deps, xo.id, goodPay())) === "payment_amount_invalid"); }
  { const x = makeWorld(); const xo = await newOrder(x); x.db.products.get(U(11)).profile_id = U(2);
    check("pay: order whose product belongs to another profile is refused", codeOf(await initiateProductPayment(x.deps, xo.id, goodPay())) === "order_not_payable"); }

  // provider failure, retry, attempt cap
  w = makeWorld(); const fo = await newOrder(w); w.provider.failDirect = true;
  const failed = await initiateProductPayment(w.deps, fo.id, goodPay());
  check("pay: provider error → payment_failed (no provider text leaked)", codeOf(failed) === "payment_failed" && !JSON.stringify(failed).includes("apikey"));
  check("pay: failed attempt recorded as failed", w.db.payments[0].status === "failed" && w.db.payments[0].failure_reason === "provider_error");
  w.provider.failDirect = false;
  check("pay: a retry after a failure is allowed", codeOf(await initiateProductPayment(w.deps, fo.id, goodPay())) === "OK" && w.db.payments.length === 2);
  w = makeWorld(); const co = await newOrder(w); w.provider.failDirect = true;
  for (let i = 0; i < C.MAX_PAYMENT_ATTEMPTS; i++) await initiateProductPayment(w.deps, co.id, goodPay());
  w.provider.failDirect = false;
  check("pay: attempts per order are capped", codeOf(await initiateProductPayment(w.deps, co.id, goodPay())) === "too_many_payment_attempts" && w.db.payments.length === C.MAX_PAYMENT_ATTEMPTS);
}

// ================================================================ 3. STATUS + SETTLEMENT
{
  // successful payment
  let w = makeWorld();
  const { order, payment, transId } = await paying(w);
  let s = await checkProductPayment(w.deps, order.id);
  check("status: pending while the provider says CREATED", s.ok && s.data.status === "pending" && !!s.data.expires_at);
  w.provider.statuses.set(transId, { status: "SUCCESSFUL", amount: 12000 });
  s = await checkProductPayment(w.deps, order.id);
  const o1 = w.db.orders.get(order.id);
  check("settle: success → succeeded", s.ok && s.data.status === "succeeded");
  check("settle: order paid with paid_at", o1.status === "paid" && !!o1.paid_at);
  check("settle: payment marked succeeded with confirmed_at", w.db.payments[0].status === "succeeded" && !!w.db.payments[0].confirmed_at);
  check("settle: receipt data returned (RCP- number, seller, totals)", s.data.receipt_number === "RCP-000001" && s.data.seller_username === "shop" && s.data.order.total === 12000 && s.data.order.paid_at === o1.paid_at);
  const e = w.db.earnings[0];
  check("earnings: exactly one row", w.db.earnings.length === 1);
  check("earnings: commission rate snapshotted from platform settings", e.commission_rate === 0.05);
  check("earnings: gross 12000, fee 600, net 11400 (gross = fee + net)", e.gross_amount === 12000 && e.platform_fee === 600 && e.net_amount === 11400 && Math.round(e.gross_amount * 100) === Math.round(e.platform_fee * 100) + Math.round(e.net_amount * 100));
  check("earnings: creator is the profile owner, linked to order + payment", e.creator_user_id === U(101) && e.order_id === order.id && e.payment_id === payment.id && e.profile_id === U(1) && e.currency === "XAF");
  check("earnings: no payout / hold / withdrawal fields created", !("payout_id" in e) && !("available_at" in e) && e.status === "recorded");
  check("settle: stock stays reserved/finalised (18)", w.db.products.get(U(11)).inventory_count === 18);

  // later commission change does not rewrite the snapshot
  w.db.settings.commissionRate = 0.5;
  await checkProductPayment(w.deps, order.id);
  check("earnings: a later commission change never rewrites the snapshot", w.db.earnings.length === 1 && w.db.earnings[0].commission_rate === 0.05);

  // duplicate success — sequential and concurrent
  for (let i = 0; i < 3; i++) await checkProductPayment(w.deps, order.id);
  check("duplicate success (polled repeatedly): still one earning, order still paid", w.db.earnings.length === 1 && w.db.orders.get(order.id).status === "paid");
  const w2 = makeWorld(); const p2 = await paying(w2); w2.provider.statuses.set(p2.transId, { status: "SUCCESSFUL", amount: 12000 });
  const outs = await Promise.all([1, 2, 3, 4, 5].map(() => settleProductPayment(w2.deps, p2.payment.id, { amount: 12000 })));
  check("concurrent settlement (5 at once): one earning", w2.db.earnings.length === 1, String(w2.db.earnings.length));
  check("concurrent settlement: exactly one caller settled the order", outs.filter((x) => x.settledNow).length === 1, JSON.stringify(outs.map((x) => x.settledNow)));
  check("concurrent settlement: every caller reports success", outs.every((x) => x.status === "succeeded" && x.earningRecorded));
  const w3 = makeWorld({ onOrderPaid: async () => { hookCalls++; } }); let hookCalls = 0;
  const p3 = await paying(w3); w3.provider.statuses.set(p3.transId, { status: "SUCCESSFUL", amount: 12000 });
  await Promise.all([1, 2, 3].map(() => checkProductPayment(w3.deps, p3.order.id)));
  check("side effects (onOrderPaid) run exactly once", hookCalls === 1, String(hookCalls));
  { const w4 = makeWorld({ onOrderPaid: async () => { throw new Error("hook exploded"); } }); const p4 = await paying(w4); w4.provider.statuses.set(p4.transId, { status: "SUCCESSFUL", amount: 12000 });
    const r4 = await checkProductPayment(w4.deps, p4.order.id);
    check("a failing side-effect hook never blocks settlement", r4.ok && r4.data.status === "succeeded" && w4.db.earnings.length === 1); }

  // crash between steps heals on the next call (re-entrant)
  { const w5 = makeWorld(); const p5 = await paying(w5);
    w5.db.payments[0].status = "succeeded"; w5.db.payments[0].confirmed_at = w5.deps.now().toISOString(); // step 1 done, then "crash"
    const r5 = await checkProductPayment(w5.deps, p5.order.id);
    check("re-entrant: payment succeeded but order not yet paid → next poll finishes the job", r5.ok && r5.data.status === "succeeded" && w5.db.orders.get(p5.order.id).status === "paid" && w5.db.earnings.length === 1);
    const w6 = makeWorld(); const p6 = await paying(w6);
    w6.db.payments[0].status = "succeeded"; w6.db.payments[0].confirmed_at = w6.deps.now().toISOString(); w6.db.orders.get(p6.order.id).status = "paid"; w6.db.orders.get(p6.order.id).paid_at = w6.deps.now().toISOString();
    await checkProductPayment(w6.deps, p6.order.id);
    check("re-entrant: order paid but earning missing → next poll records it once", w6.db.earnings.length === 1); }

  // failed and expired payments
  w = makeWorld(); let fp = await paying(w); w.provider.statuses.set(fp.transId, { status: "FAILED", amount: null, reason: "insufficient funds" });
  s = await checkProductPayment(w.deps, fp.order.id);
  check("status: provider FAILED → failed (order stays open for a retry)", s.ok && s.data.status === "failed" && s.data.code === "payment_failed" && w.db.payments[0].status === "failed" && w.db.orders.get(fp.order.id).status === "awaiting_payment");
  check("status: no earning and no paid order on failure", w.db.earnings.length === 0 && w.db.orders.get(fp.order.id).paid_at === null);
  check("status: after a failure the customer can start again", codeOf(await initiateProductPayment(w.deps, fp.order.id, goodPay())) === "OK");
  w = makeWorld(); fp = await paying(w); w.provider.statuses.set(fp.transId, { status: "EXPIRED", amount: null });
  s = await checkProductPayment(w.deps, fp.order.id);
  check("status: provider EXPIRED → expired", s.ok && s.data.status === "expired" && s.data.code === "payment_expired" && w.db.payments[0].status === "expired");
  w = makeWorld(); fp = await paying(w); w.minutes(16); // attempt window passes, provider still CREATED
  s = await checkProductPayment(w.deps, fp.order.id);
  check("status: attempt past its window (provider still CREATED) → expired locally", s.ok && s.data.status === "expired" && w.db.payments[0].status === "expired");
  w = makeWorld(); fp = await paying(w); w.provider.failStatus = true;
  s = await checkProductPayment(w.deps, fp.order.id);
  check("status: provider unreachable → stays pending, no state change", s.ok && s.data.status === "pending" && w.db.payments[0].status === "pending");
  check("status: normalizeProviderStatus", ["SUCCESSFUL:succeeded", "FAILED:failed", "EXPIRED:expired", "CREATED:pending", "WHATEVER:pending", "undefined:pending"].every((x) => { const [a, b] = x.split(":"); return normalizeProviderStatus(a === "undefined" ? undefined : a) === b; }));
  check("status: unknown / malformed order id", codeOf(await checkProductPayment(w.deps, "zzz")) === "order_not_found" && codeOf(await checkProductPayment(w.deps, U(31337))) === "order_not_found");
  { const nw = makeWorld(); const no = await newOrder(nw);
    const ns = await checkProductPayment(nw.deps, no.id);
    check("status: no payment started → not_started", ns.ok && ns.data.status === "not_started"); }

  // lazy expiry with no payment at all
  w = makeWorld(); const lo = await newOrder(w); w.minutes(31);
  s = await checkProductPayment(w.deps, lo.id);
  check("expiry: unpaid order past its window → expired, stock returned once", s.ok && s.data.status === "expired" && w.db.products.get(U(11)).inventory_count === 20);
  await checkProductPayment(w.deps, lo.id); await checkProductPayment(w.deps, lo.id);
  check("expiry: repeated checks never release the stock twice", w.db.products.get(U(11)).inventory_count === 20 && w.db.releases === 1);
  check("expiry: exactly-once release at the store level", (await w.deps.store.releaseOrder(lo.id, "expired")) === false);
  w = makeWorld(); const lp = await paying(w); w.minutes(14);
  await checkProductPayment(w.deps, lp.order.id);
  check("expiry: a LIVE payment protects the reservation from release", w.db.orders.get(lp.order.id).status === "awaiting_payment" && w.db.products.get(U(11)).inventory_count === 18);

  // late success after the order expired -> payment_review, payment preserved, no false paid, no earning
  w = makeWorld(); const late = await paying(w); w.minutes(17);
  await checkProductPayment(w.deps, late.order.id); // attempt expires locally
  w.minutes(20); await checkProductPayment(w.deps, late.order.id); // order window passes -> released
  check("late: order expired and stock released before the confirmation", w.db.orders.get(late.order.id).status === "expired" && w.db.products.get(U(11)).inventory_count === 20);
  w.provider.statuses.set(late.transId, { status: "SUCCESSFUL", amount: 12000 });
  s = await checkProductPayment(w.deps, late.order.id);
  check("late: success after expiry → payment_review (never silently paid)", s.ok && s.data.status === "review" && s.data.code === "payment_review" && w.db.orders.get(late.order.id).status === "payment_review");
  check("late: the successful payment is preserved", w.db.payments[0].status === "succeeded" && !!w.db.payments[0].confirmed_at);
  check("late: no earning, stock NOT re-added by a stock function, no double release", w.db.earnings.length === 0 && w.db.products.get(U(11)).inventory_count === 20 && w.db.releases === 1);
  check("late: paying an order in review is refused", codeOf(await initiateProductPayment(w.deps, late.order.id, goodPay())) === "payment_review");
  // late success while the order still holds its reservation (lazy expiry hasn't run) -> safely paid
  w = makeWorld(); const late2 = await paying(w); w.minutes(16);
  w.provider.statuses.set(late2.transId, { status: "SUCCESSFUL", amount: 12000 });
  s = await checkProductPayment(w.deps, late2.order.id);
  check("late: success while the reservation is still held → paid normally", s.ok && s.data.status === "succeeded" && w.db.orders.get(late2.order.id).status === "paid" && w.db.earnings.length === 1);

  // mismatches -> payment_review
  w = makeWorld(); let mm = await paying(w); w.provider.statuses.set(mm.transId, { status: "SUCCESSFUL", amount: 100 });
  s = await checkProductPayment(w.deps, mm.order.id);
  check("mismatch: provider amount differs from the order → review, not paid", s.ok && s.data.status === "review" && w.db.orders.get(mm.order.id).status === "payment_review" && w.db.earnings.length === 0);
  check("mismatch: the payment itself is still recorded as succeeded", w.db.payments[0].status === "succeeded");
  check("mismatch: diagnostics logged without personal data", w.db.logs.some((l) => l.e === "product_payment_review" && l.d.reason === "provider_amount_mismatch") && !JSON.stringify(w.db.logs).match(/237|amina|677/i));
  for (const [name, mut, reason] of [
    ["payment amount differs from the order total", (x, id) => (x.db.payments[0].amount = 5), "payment_amount_mismatch"],
    ["payment currency differs from the order", (x, id) => (x.db.payments[0].currency = "USD"), "payment_currency_mismatch"],
    ["order currency is not XAF", (x, id) => { x.db.orders.get(id).currency = "EUR"; x.db.payments[0].currency = "EUR"; }, "payment_currency_mismatch"],
    ["payment belongs to another profile", (x, id) => (x.db.payments[0].profile_id = U(2)), "payment_profile_mismatch"],
  ]) {
    const x = makeWorld(); const xm = await paying(x); mut(x, xm.order.id); x.provider.statuses.set(xm.transId, { status: "SUCCESSFUL", amount: 12000 });
    const out = await settleProductPayment(x.deps, x.db.payments[0].id, { amount: 12000 });
    check(`mismatch: ${name} → review (${reason})`, out.status === "review" && out.reason === reason && x.db.orders.get(xm.order.id).status === "payment_review" && x.db.earnings.length === 0 && x.db.orders.get(xm.order.id).paid_at === null, JSON.stringify(out));
  }
  { const x = makeWorld(); const xm = await paying(x); x.db.payments[0].provider = "stripe";
    const out = await settleProductPayment(x.deps, x.db.payments[0].id, { amount: 12000 });
    check("wrong provider → review, no writes", out.status === "review" && out.reason === "invalid_payment" && x.db.payments[0].status === "pending" && x.db.orders.get(xm.order.id).status === "awaiting_payment" && x.db.earnings.length === 0); }
  { const x = makeWorld(); const xm = await paying(x); x.db.payments[0].target_type = "quote";
    const out = await settleProductPayment(x.deps, x.db.payments[0].id, { amount: 12000 });
    check("wrong target type → review, no writes", out.status === "review" && x.db.earnings.length === 0 && x.db.orders.get(xm.order.id).status === "awaiting_payment"); }
  { const x = makeWorld(); const out = await settleProductPayment(x.deps, U(31337), { amount: 1 });
    check("unknown payment id → review, no writes", out.status === "review" && x.db.earnings.length === 0); }
  { const x = makeWorld(); const xm = await paying(x); x.db.orders.delete(xm.order.id);
    const out = await settleProductPayment(x.deps, x.db.payments[0].id, { amount: 12000 });
    check("payment whose order is gone → payment kept as succeeded, review, no earning", out.status === "review" && out.reason === "order_missing" && x.db.payments[0].status === "succeeded" && x.db.earnings.length === 0); }
  for (const st of ["cancelled", "refunded"]) {
    const x = makeWorld(); const xm = await paying(x); x.db.orders.get(xm.order.id).status = st; x.db.payments[0].expires_at = new Date(x.clock.t + 1e7).toISOString();
    const out = await settleProductPayment(x.deps, x.db.payments[0].id, { amount: 12000 });
    check(`order ${st} + successful payment → never paid, no earning`, out.status === "review" && x.db.earnings.length === 0 && x.db.orders.get(xm.order.id).paid_at === null && x.db.payments[0].status === "succeeded");
  }
  { const x = makeWorld(); const xm = await paying(x); x.db.payments[0].status = "failed";
    const out = await settleProductPayment(x.deps, x.db.payments[0].id, { amount: 12000 });
    check("locally failed payment + provider success → review (conflict), not paid", out.status === "review" && x.db.earnings.length === 0 && x.db.orders.get(xm.order.id).status !== "paid"); }

  // commission handling
  { const x = makeWorld({ settings: { commissionRate: null } }); const xm = await paying(x).catch(() => null);
    check("commission unset: order creation is refused (commerce_disabled)", xm === null); }
  { const x = makeWorld(); const xm = await paying(x); x.db.settings.commissionRate = null; x.provider.statuses.set(xm.transId, { status: "SUCCESSFUL", amount: 12000 });
    const r = await checkProductPayment(x.deps, xm.order.id);
    check("commission removed mid-flight: order still paid, no invented percentage", r.ok && r.data.status === "succeeded" && x.db.earnings.length === 0);
    x.db.settings.commissionRate = 0.1; await checkProductPayment(x.deps, xm.order.id);
    check("…and the earning is created once the rate is set (re-run repairs it)", x.db.earnings.length === 1 && x.db.earnings[0].commission_rate === 0.1 && x.db.earnings[0].platform_fee === 1200 && x.db.earnings[0].net_amount === 10800); }
  { const x = makeWorld({ settings: { commissionRate: 0 } }); const xm = await paying(x); x.provider.statuses.set(xm.transId, { status: "SUCCESSFUL", amount: 12000 }); await checkProductPayment(x.deps, xm.order.id);
    check("a 0% commission is honoured (fee 0, net = gross)", x.db.earnings.length === 1 && x.db.earnings[0].platform_fee === 0 && x.db.earnings[0].net_amount === 12000); }

  // customer pays twice (no normal flow produces this — the order expires with the attempt — so the
  // second payment row is crafted directly to exercise the settlement safeguard)
  { const x = makeWorld(); const xm = await paying(x); const first = x.db.payments[0];
    x.provider.statuses.set(first.provider_transaction_id, { status: "SUCCESSFUL", amount: 12000 });
    await checkProductPayment(x.deps, xm.order.id);
    const second = { ...first, id: U(9001), external_id: "pp-dup", provider_transaction_id: "TX-DUP", status: "pending", confirmed_at: null, created_at: new Date(x.clock.t + 1000).toISOString() };
    x.db.payments.unshift(second);
    const o2 = await settleProductPayment(x.deps, second.id, { amount: 12000 });
    check("double payment: still exactly one earning and one paid order", x.db.earnings.length === 1 && x.db.orders.get(xm.order.id).status === "paid" && x.db.earnings[0].payment_id === first.id);
    check("double payment: the extra payment is recorded as succeeded and flagged for refund review", o2.status === "succeeded" && o2.duplicatePayment === true && x.db.payments.filter((p) => p.status === "succeeded").length === 2 && x.db.logs.some((l) => l.e === "product_duplicate_payment"));
    const again = await settleProductPayment(x.deps, second.id, { amount: 12000 });
    check("double payment: re-processing the extra payment adds nothing", x.db.earnings.length === 1 && again.status === "succeeded"); }
}

// ================================================================ 4. PURE UNITS
{
  check("money: 12000 @ 5% → 600 / 11400", JSON.stringify(computeEarnings(12000, 0.05)) === JSON.stringify({ gross: 12000, platformFee: 600, net: 11400, rate: 0.05 }));
  const half = computeEarnings(999, 0.075);
  check("money: half-up rounding to the cent (999 @ 7.5% → 74.93 / 924.07)", half.platformFee === 74.93 && half.net === 924.07);
  check("money: rate 0 and rate 1", computeEarnings(500, 0).platformFee === 0 && computeEarnings(500, 1).net === 0);
  check("money: unusable inputs → null", [computeEarnings(0, 0.1), computeEarnings(-5, 0.1), computeEarnings("x", 0.1), computeEarnings(100, 1.5), computeEarnings(100, -0.1), computeEarnings(100, null), computeEarnings(100, undefined), computeEarnings(100, NaN), computeEarnings(1e15, 0.1)].every((v) => v === null));
  let exact = true;
  for (let i = 0; i < 5000; i++) {
    const g = Math.round(Math.random() * 1e7) / 100 + 0.01;
    const rate = Math.round(Math.random() * 10000) / 10000;
    const e = computeEarnings(g, rate);
    if (!e || toCents(e.gross) !== toCents(e.platformFee) + toCents(e.net) || e.platformFee < 0 || e.net < 0) { exact = false; break; }
  }
  check("money: gross = fee + net to the cent (5000 random cases)", exact);
  check("money: numeric strings and comparison helpers", toCents("12.30") === 1230 && sameAmount("12.30", 12.3) && !sameAmount(1, 1.01) && isWholeAmount(6000) && !isWholeAmount(6000.5) && !isWholeAmount(0));
  check("format: PO-/RCP- numbers", formatProductOrderNumber(42) === "PO-000042" && formatProductReceiptNumber(42) === "RCP-000042");
  check("errors: db messages map to stable codes; unknown → internal_error", codeFromDbMessage("insufficient_stock") === "insufficient_stock" && codeFromDbMessage("commerce_currency_unsupported") === "commerce_currency_unsupported" && codeFromDbMessage('null value in column "x" violates not-null constraint') === "internal_error" && codeFromDbMessage(undefined) === "internal_error");
  check("errors: every listed code has an HTTP status", ["commerce_disabled", "payment_provider_unavailable", "product_unavailable", "invalid_quantity", "order_not_found", "order_expired", "order_not_payable", "payment_already_pending", "payment_amount_mismatch", "payment_currency_mismatch", "payment_failed", "payment_expired", "payment_review"].every((c) => typeof HTTP_STATUS[c] === "number"));
  check("validation: uuid check", isUuid(U(1)) && !isUuid("x") && !isUuid(null));
  check("validation: payer phone normalisation matches fapshi.ts (strip formatting and 237)", normalizePayerPhone("+237 677 12 34 56") === "677123456" && normalizePayerPhone("677-12-34-56") === "677123456");
  check("validation: pay input", parsePayInput({ phone: "6 77 12 34 56", medium: "orange money" }).ok && !parsePayInput({ phone: "677123456", medium: "x" }).ok && !parsePayInput(null).ok);
}

// ================================================================ 5. ISOLATION + PARITY WITH THE MIGRATION
{
  const dir = path.join(REPO, "src/lib/productCheckout");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const strip = (s) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const all = files.map((f) => [f, strip(fs.readFileSync(path.join(dir, f), "utf8"))]);
  const forbidden = /music_orders|music_order_items|music_sale_earnings|music_payouts|payment_transactions|applySuccessfulPayment|musicOrderPayment|checkAndConfirmFapshiOrder|request_music_payout|orders\/\[id\]|\/api\/music|\/api\/billing/;
  check("isolation: product checkout never references music/billing/payment_transactions code or tables", all.every(([, s]) => !forbidden.test(s)), all.filter(([, s]) => forbidden.test(s)).map(([f]) => f).join());
  const imports = all.flatMap(([f, s]) => [...s.matchAll(/from\s+"([^"]+)"/g)].map((m) => [f, m[1]]));
  check("isolation: only the Fapshi adapter imports fapshi.ts; only the server wiring files import next/supabase", imports.filter(([, m]) => /fapshi$/.test(m)).every(([f]) => f === "fapshiProvider.ts") && imports.filter(([, m]) => /^next|supabase/.test(m)).every(([f]) => ["http.ts", "availability.ts"].includes(f)));
  check("isolation: core logic files import nothing outside the module", all.filter(([f]) => !["supabaseStore.ts", "fapshiProvider.ts", "http.ts", "availability.ts"].includes(f)).every(([f]) => imports.filter(([g]) => g === f).every(([, m]) => m.startsWith("./"))));
  check("no payout / withdrawal / hold / commission-percentage code", all.every(([, s]) => !/payout|withdraw|available_at|hold_days/i.test(s)) && all.every(([, s]) => !/commissionRate\s*=\s*0?\.\d|rate\s*=\s*0?\.\d/.test(s)));
  check("no Stripe in the generic lane (Fapshi only)", all.every(([, s]) => !/stripe/i.test(s.replace(/"stripe"/g, ""))));

  const routes = ["src/app/api/products/orders/route.ts", "src/app/api/products/orders/[id]/pay/route.ts", "src/app/api/products/orders/[id]/pay-status/route.ts"];
  const rsrc = routes.map((r) => fs.readFileSync(path.join(REPO, r), "utf8"));
  check("routes: all three exist and are force-dynamic", rsrc.every((s) => /export const dynamic = "force-dynamic"/.test(s)));
  check("routes: never read price/total/currency/amount/profile from the request", rsrc.every((s) => !/body\??\.(price|total|subtotal|currency|amount|profile_id|creator|commission|stock)/.test(s)));
  check("routes: errors are stable codes via respond()/internalError()", rsrc.every((s) => /respond\(/.test(s) && /internalError\(/.test(s)));
  check("order route: customer id only from the verified session on a same-origin request", /isSameOrigin\(request\)/.test(rsrc[0]) && /getCustomerFromCookie\(\)/.test(rsrc[0]) && !/customer_id/.test(rsrc[0].replace(/\/\/.*$/gm, "")));

  const sql = fs.readFileSync(path.join(REPO, "supabase/migrations/2026-11-02_product_checkout_foundation.sql"), "utf8");
  check("parity: MAX_QUANTITY matches the SQL c_max_quantity", new RegExp(`c_max_quantity constant int := ${C.MAX_QUANTITY};`).test(sql));
  check("parity: RESERVATION_MINUTES matches the SQL default", new RegExp(`p_reservation_minutes int default ${C.RESERVATION_MINUTES}`).test(sql));
  check("parity: currency and provider match the SQL", /v_currency <> 'XAF'/.test(sql) && C.SUPPORTED_CURRENCY === "XAF" && /provider in \('fapshi'\)/.test(sql) && C.PROVIDER === "fapshi");
  check("parity: target type matches the SQL", /target_type in \('product_order'\)/.test(sql) && C.TARGET_TYPE === "product_order");
  check("parity: every error code the SQL raises maps to a public code", [...sql.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]).filter((m) => m !== "invalid_reservation_window").every((m) => codeFromDbMessage(m) !== "internal_error"), [...sql.matchAll(/raise exception '([a-z_]+)'/g)].map((m) => m[1]).filter((m) => codeFromDbMessage(m) === "internal_error").join());
  check("parity: invalid_reservation_window is an internal configuration error (the app always sends 30)", codeFromDbMessage("invalid_reservation_window") === "internal_error" && C.RESERVATION_MINUTES >= 5 && C.RESERVATION_MINUTES <= 120);
  check("parity: the state machines here match the migration's guard transitions", (() => {
    const orderOk = /old\.status = 'awaiting_payment' and new\.status in \('paid','expired','cancelled','payment_review'\)/.test(sql) && /old\.status = 'expired'\s+and new\.status in \('paid','payment_review'\)/.test(sql) && /old\.status = 'cancelled'\s+and new\.status = 'payment_review'/.test(sql);
    const payOk = /old\.status = 'expired'\s+and new\.status = 'succeeded'/.test(sql) && /old\.status = 'cancelled' and new\.status = 'succeeded'/.test(sql);
    return orderOk && payOk;
  })());
}

// ================================================================ 6. PROVIDER RATE LIMIT (Fapshi: 6 status requests / minute / transaction)
{
  const { createProviderPollGate } = L("pollGate.ts");
  check("rate limit: constants respect 6/min/transaction", 60000 / C.PAYMENT_STATUS_POLL_INTERVAL_MS <= 6 && C.PROVIDER_STATUS_MIN_GAP_MS >= 10000 && C.PAYMENT_STATUS_POLL_INTERVAL_MS >= C.PROVIDER_STATUS_MIN_GAP_MS);
  check("amount verification stays enabled", C.VERIFY_PROVIDER_AMOUNT === true);

  const g = createProviderPollGate();
  check("gate: first check allowed, second within the gap refused, allowed again once the gap has passed",
    g.tryAcquire("T", 0) === true && g.tryAcquire("T", 5000) === false && g.tryAcquire("T", 10999) === false && g.tryAcquire("T", 11000) === true);
  check("gate: a refused check does not extend the gap; transactions are independent", g.tryAcquire("T", 15000) === false && g.tryAcquire("OTHER", 15000) === true);
  { const s = createProviderPollGate(11000, 3); for (let i = 0; i < 20; i++) s.tryAcquire("k" + i, 1000); check("gate: memory is bounded", s.tryAcquire("fresh", 1000) === true); }

  // Hammer one payment: 5 concurrent "tabs", one request per second for 5 minutes, through the real status check.
  const gated = () => { const w = makeWorld(); w.deps.pollGate = createProviderPollGate(); return w; };
  {
    const w = gated(); const p = await paying(w); const stamps = [];
    const real = w.provider.getStatus.bind(w.provider); w.provider.getStatus = async (id) => { stamps.push(w.clock.t); return real(id); };
    for (let sec = 0; sec < 300; sec++) { w.clock.t += 1000; for (let tab = 0; tab < 5; tab++) await checkProductPayment(w.deps, p.order.id); }
    const worst = Math.max(...stamps.map((t) => stamps.filter((u) => u >= t && u < t + 60000).length));
    check("rate limit: 5 tabs polling every second for 5 minutes never exceed 6 provider requests in any 60s window", worst <= 6 && stamps.length > 0, `worst=${worst} total=${stamps.length}`);
  }
  {
    const w = gated(); const p = await paying(w);
    w.clock.t += 1000; await checkProductPayment(w.deps, p.order.id); // consumes the slot (pending)
    w.provider.statuses.set(p.transId, { status: "SUCCESSFUL", amount: 12000 });
    w.clock.t += 2000; let s = await checkProductPayment(w.deps, p.order.id);
    check("rate limit: a check inside the gap answers pending WITHOUT asking the provider and changes nothing", s.ok && s.data.status === "pending" && w.db.payments[0].status === "pending" && w.db.earnings.length === 0 && w.provider.statusCalls === 1);
    w.clock.t += 9000; s = await checkProductPayment(w.deps, p.order.id);
    check("rate limit: once the gap passes the success is picked up and settled", s.ok && s.data.status === "succeeded" && w.db.earnings.length === 1 && w.db.orders.get(p.order.id).status === "paid");
    for (let i = 0; i < 4; i++) { w.clock.t += 12000; await checkProductPayment(w.deps, p.order.id); }
    check("rate limit: repeated polling after success creates no second earning", w.db.earnings.length === 1);
  }
  // 429 (or any provider error) is safe: stays pending, changes nothing, and the slot is still consumed
  {
    const w = gated(); const p = await paying(w);
    w.provider.failStatus = true;
    const before = JSON.stringify([w.db.payments, [...w.db.orders.values()], w.db.earnings]);
    w.clock.t += 1000; let s = await checkProductPayment(w.deps, p.order.id);
    check("429: provider error -> pending, no state change, no earning", s.ok && s.data.status === "pending" && JSON.stringify([w.db.payments, [...w.db.orders.values()], w.db.earnings]) === before);
    w.clock.t += 1000; await checkProductPayment(w.deps, p.order.id);
    check("429: an errored request still counts against the gap (no retry storm)", w.provider.statusCalls === 1);
    w.provider.failStatus = false; w.provider.statuses.set(p.transId, { status: "SUCCESSFUL", amount: 12000 });
    w.clock.t += 12000; s = await checkProductPayment(w.deps, p.order.id);
    check("429: after the limit clears, the payment settles exactly once", s.ok && s.data.status === "succeeded" && w.db.earnings.length === 1 && w.db.payments.length === 1);
    const log429 = w.db.logs.filter((l) => l.e === "product_provider_status_error");
    check("429: the failure is logged, bounded to 160 chars", log429.length === 1 && String(log429[0].d.error).length <= 160);
  }
  { const w = gated(); const p = await paying(w); w.provider.getStatus = async () => { throw new Error("Fapshi payment-status failed (429)"); };
    w.clock.t += 1000; const s = await checkProductPayment(w.deps, p.order.id);
    check("429: a literal 429 error is handled like any provider error", s.ok && s.data.status === "pending" && w.db.earnings.length === 0); }
  // mutation: the tests can fail - with no gate the hammering exceeds the limit
  {
    const w = makeWorld(); const p = await paying(w); const stamps = [];
    const real = w.provider.getStatus.bind(w.provider); w.provider.getStatus = async (id) => { stamps.push(w.clock.t); return real(id); };
    for (let sec = 0; sec < 60; sec++) { w.clock.t += 1000; await checkProductPayment(w.deps, p.order.id); }
    check("mutation: WITHOUT the gate the same hammering exceeds 6/min (so the test above can fail)", stamps.length > 6);
  }
  const httpSrc = fs.readFileSync(path.join(REPO, "src/lib/productCheckout/http.ts"), "utf8");
  check("wiring: the real server deps use one shared poll gate", /pollGate:\s*providerPollGate/.test(httpSrc) && /createProviderPollGate\(\)/.test(httpSrc));
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
