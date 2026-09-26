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
    async listReconcilableOrderIds({ sinceIso, limit }) {
      const since = new Date(sinceIso).getTime();
      const live = (id) => ["awaiting_payment", "expired", "cancelled"].includes(db.orders.get(id)?.status);
      const newest = (a, b) => new Date(b.created_at) - new Date(a.created_at);
      const g = (pred) => db.payments.filter(pred).sort(newest).map((p) => p.target_id);
      const groups = [
        g((p) => p.status === "succeeded" && new Date(p.created_at).getTime() >= since),
        g((p) => (p.status === "initiated" || p.status === "pending") && p.provider_transaction_id),
        g((p) => (p.status === "expired" || p.status === "cancelled") && p.provider_transaction_id && new Date(p.created_at).getTime() >= since),
      ];
      return [...new Set(groups.flat())].filter(live).slice(0, limit);
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
  check("isolation: only the Fapshi adapter imports fapshi.ts; only the server wiring files import next/supabase", imports.filter(([, m]) => /fapshi$/.test(m)).every(([f]) => f === "fapshiProvider.ts") && imports.filter(([, m]) => /^next|supabase/.test(m)).every(([f]) => ["http.ts", "availability.ts", "responses.ts"].includes(f)));
  check("isolation: core logic files import nothing outside the module", all.filter(([f]) => !["supabaseStore.ts", "fapshiProvider.ts", "http.ts", "availability.ts", "commerceRateLimiter.ts", "responses.ts"].includes(f)).every(([f]) => imports.filter(([g]) => g === f).every(([, m]) => m.startsWith("./"))));
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

// ================================================================ 7. RECONCILIATION SWEEP + ABUSE LIMITS
{
  const { reconcileProductPayments } = L("reconcile.ts");
  const { createProviderPollGate } = L("pollGate.ts");
  const { withinLimit } = L("rateLimit.ts");
  const nofn = () => {};
  const phone9 = (i) => `6${String(70000000 + i)}`;
  // many independent orders in one world (unlimited stock, distinct contact/payer numbers)
  async function payFor(w, i, over = {}) {
    const o = await newOrder(w, { customer_phone: phone9(i), quantity: 1, ...over });
    const p = await initiateProductPayment(w.deps, o.id, goodPay({ phone: phone9(i) }));
    if (!p.ok) throw new Error("setup pay failed: " + p.code);
    const pay = w.db.payments.find((x) => x.target_id === o.id);
    return { order: o, payment: pay, transId: pay.provider_transaction_id };
  }
  const unlimited = { product: { inventory_count: null } };

  // ---- customer pays and closes the tab: the sweep finds and settles it
  {
    const w = makeWorld(); const p = await paying(w);
    w.provider.statuses.set(p.transId, { status: "SUCCESSFUL", amount: 12000 });
    const before = w.provider.statusCalls;
    const sum = await reconcileProductPayments(w.deps);
    check("reconcile: a payment that succeeded while nobody watched is settled", w.db.orders.get(p.order.id).status === "paid" && w.db.earnings.length === 1 && sum.succeeded === 1 && sum.examined === 1 && w.provider.statusCalls === before + 1);
    check("reconcile: the earning uses the unchanged commission calculation (12000 x 5% = 600 / 11400)", w.db.earnings[0].platform_fee === 600 && w.db.earnings[0].net_amount === 11400 && w.db.earnings[0].commission_rate === 0.05);
    for (let i = 0; i < 3; i++) await reconcileProductPayments(w.deps);
    check("reconcile: running it again is idempotent (one earning, still paid, no more provider calls)", w.db.earnings.length === 1 && w.db.orders.get(p.order.id).status === "paid" && w.provider.statusCalls === before + 1);
  }
  // ---- concurrent with the customer's own polling and a second sweep
  {
    let hook = 0; const w = makeWorld({ onOrderPaid: async () => { hook++; } }); const p = await paying(w);
    w.provider.statuses.set(p.transId, { status: "SUCCESSFUL", amount: 12000 });
    await Promise.all([reconcileProductPayments(w.deps), checkProductPayment(w.deps, p.order.id), reconcileProductPayments(w.deps), checkProductPayment(w.deps, p.order.id)]);
    check("reconcile: concurrent sweeps + customer polls never double-settle (one earning, one paid transition, hook once)", w.db.earnings.length === 1 && w.db.orders.get(p.order.id).status === "paid" && hook === 1, `${w.db.earnings.length}/${hook}`);
  }
  // ---- late success
  {
    const w = makeWorld(); const p = await paying(w); w.minutes(16); // attempt window over, order reservation (30 min) still open
    await reconcileProductPayments(w.deps);
    check("reconcile: an attempt past its window (provider still CREATED) is marked expired, nothing else changes", w.db.payments[0].status === "expired" && w.db.orders.get(p.order.id).status === "awaiting_payment" && w.db.earnings.length === 0);
    w.provider.statuses.set(p.transId, { status: "SUCCESSFUL", amount: 12000 });
    const sum = await reconcileProductPayments(w.deps);
    check("late success, reservation still held: the recently expired attempt is honoured -> paid, one earning", w.db.orders.get(p.order.id).status === "paid" && w.db.earnings.length === 1 && sum.succeeded === 1);
  }
  {
    const w = makeWorld(); const p = await paying(w); w.minutes(40);
    await reconcileProductPayments(w.deps);
    const stockAfterRelease = w.db.products.get(U(11)).inventory_count;
    check("reconcile: an unpaid order past its window is expired and its stock released exactly once", w.db.orders.get(p.order.id).status === "expired" && w.db.releases === 1 && stockAfterRelease === 20);
    w.provider.statuses.set(p.transId, { status: "SUCCESSFUL", amount: 12000 });
    const sum = await reconcileProductPayments(w.deps);
    check("late success AFTER the stock was released -> payment_review, no earning, stock not re-reserved", w.db.orders.get(p.order.id).status === "payment_review" && w.db.earnings.length === 0 && sum.review === 1 && w.db.products.get(U(11)).inventory_count === 20);
    const calls = w.provider.statusCalls; await reconcileProductPayments(w.deps); await reconcileProductPayments(w.deps);
    check("payment_review orders are left alone by later sweeps (no provider calls, no earning)", w.provider.statusCalls === calls && w.db.earnings.length === 0);
  }
  // ---- amount verification preserved
  {
    const w = makeWorld(); const p = await paying(w);
    w.provider.statuses.set(p.transId, { status: "SUCCESSFUL", amount: 100 });
    const sum = await reconcileProductPayments(w.deps);
    check("reconcile keeps the provider amount check: a mismatched amount -> payment_review, no earning", w.db.orders.get(p.order.id).status === "payment_review" && w.db.earnings.length === 0 && sum.review === 1);
  }
  // ---- failed / expired / pending / provider trouble
  {
    const w = makeWorld(unlimited); const a = await payFor(w, 1), b = await payFor(w, 2), c = await payFor(w, 3);
    w.provider.statuses.set(a.transId, { status: "FAILED", amount: null, reason: "insufficient funds" });
    w.provider.statuses.set(b.transId, { status: "EXPIRED", amount: null });
    const sum = await reconcileProductPayments(w.deps);
    const st = (x) => w.db.payments.find((p) => p.id === x.payment.id).status;
    check("reconcile: FAILED / EXPIRED / still-open are recorded correctly, no earnings", st(a) === "failed" && st(b) === "expired" && st(c) === "pending" && w.db.earnings.length === 0, JSON.stringify(sum));
  }
  {
    const w = makeWorld(); const p = await paying(w); w.provider.failStatus = true;
    const snapshot = JSON.stringify([w.db.payments, [...w.db.orders.values()], w.db.earnings]);
    const sum = await reconcileProductPayments(w.deps);
    check("reconcile: provider down / 429 -> pending, nothing changes, no earning, no crash", JSON.stringify([w.db.payments, [...w.db.orders.values()], w.db.earnings]) === snapshot && sum.pending === 1 && sum.errors === 0);
  }
  {
    const w = makeWorld(); const p = await paying(w);
    w.db.payments[0].status = "succeeded"; w.db.payments[0].confirmed_at = new Date(w.clock.t).toISOString(); // crashed between "payment succeeded" and "order paid"
    const sum = await reconcileProductPayments(w.deps);
    check("reconcile heals a crash between the payment claim and order settlement (order paid, one earning, no provider call)", w.db.orders.get(p.order.id).status === "paid" && w.db.earnings.length === 1 && w.provider.statusCalls === 0 && sum.succeeded === 1);
  }
  // ---- selection: only orders that can still change, within the lookback
  {
    const w = makeWorld(unlimited); const paid = await payFor(w, 1), open = await payFor(w, 2), old = await payFor(w, 3);
    w.provider.statuses.set(paid.transId, { status: "SUCCESSFUL", amount: 6000 });
    await checkProductPayment(w.deps, paid.order.id); // settled by the customer
    old.payment.status = "expired"; old.payment.created_at = new Date(w.clock.t - 25 * 3600000).toISOString(); // older than the 24h lookback
    const ids = await w.deps.store.listReconcilableOrderIds({ sinceIso: new Date(w.clock.t - C.LATE_CONFIRMATION_LOOKBACK_HOURS * 3600000).toISOString(), limit: 50 });
    check("selection: skips paid orders and payments older than the lookback; includes the open attempt", ids.length === 1 && ids[0] === open.order.id, JSON.stringify(ids));
  }
  // ---- bounded work
  {
    const w = makeWorld(unlimited); for (let i = 1; i <= 30; i++) await payFor(w, i);
    w.provider.statusCalls = 0;
    const sum = await reconcileProductPayments(w.deps);
    check("bounded: a default run examines at most RECONCILE_MAX_ORDERS_PER_RUN orders", sum.examined === C.RECONCILE_MAX_ORDERS_PER_RUN && w.provider.statusCalls === C.RECONCILE_MAX_ORDERS_PER_RUN, `${sum.examined}/${w.provider.statusCalls}`);
    const w2 = makeWorld(unlimited); for (let i = 1; i <= 12; i++) await payFor(w2, i);
    const small = await reconcileProductPayments(w2.deps, { maxOrders: 5 });
    check("bounded: maxOrders is honoured", small.examined === 5);
    let t = 0; const slow = makeWorld(unlimited); for (let i = 1; i <= 12; i++) await payFor(slow, i);
    const orig = slow.provider.getStatus.bind(slow.provider); slow.provider.getStatus = async (id) => { t += 6000; return orig(id); };
    const limited = await reconcileProductPayments(slow.deps, { concurrency: 2, timeBudgetMs: 10000, clockMs: () => t });
    check("bounded: the time budget stops the run early and says so", limited.budget_exhausted === true && limited.examined < 12 && limited.examined >= 2, JSON.stringify(limited));
    const empty = await reconcileProductPayments(makeWorld().deps);
    check("bounded: nothing to do is a cheap no-op", empty.examined === 0 && empty.budget_exhausted === false);
  }
  // ---- provider rate limit is respected by the sweep
  {
    const w = makeWorld(); w.deps.pollGate = createProviderPollGate(); const p = await paying(w);
    for (let i = 0; i < 5; i++) await reconcileProductPayments(w.deps);
    check("provider limit: five back-to-back sweeps ask Fapshi about the transaction once", w.provider.statusCalls === 1, String(w.provider.statusCalls));
    w.clock.t += 12000; await reconcileProductPayments(w.deps);
    check("provider limit: it asks again once the gap has passed", w.provider.statusCalls === 2);
    // sweep + customer polling together stay within 6/min
    const w2 = makeWorld(); w2.deps.pollGate = createProviderPollGate(); await paying(w2); const stamps = []; const real = w2.provider.getStatus.bind(w2.provider);
    w2.provider.getStatus = async (id) => { stamps.push(w2.clock.t); return real(id); };
    for (let s = 0; s < 300; s++) { w2.clock.t += 1000; await Promise.all([reconcileProductPayments(w2.deps), checkProductPayment(w2.deps, U(1001))]); }
    const worst = Math.max(...stamps.map((x) => stamps.filter((u) => u >= x && u < x + 60000).length));
    check("provider limit: sweeps and customer polling combined never exceed 6 requests in any 60s window", worst <= 6 && stamps.length > 0, `worst=${worst}`);
  }

  // ---- abuse limits (in-memory limiter mirroring commerce_rate_limit_hit: count, allow, record; rejections are not recorded)
  const memLimiter = (w) => { const ev = new Map(); return { calls: [], async hit(kind, subject) {
    this.calls.push([kind, subject]); const rule = C.RATE_RULES[kind]; const k = `${kind}:${subject}`; const now = w.clock.t;
    const live = (ev.get(k) || []).filter((t) => now - t < rule.windowSeconds * 1000);
    if (live.length >= rule.max) { ev.set(k, live); return false; }
    live.push(now); ev.set(k, live); return true; } }; };
  check("limits: rules are sane (per-phone stricter than per-IP; day window >= 10 min window)", C.RATE_RULES.pay_phone.max < C.RATE_RULES.pay_ip.max && C.RATE_RULES.pay_phone_day.windowSeconds >= C.RATE_RULES.pay_phone.windowSeconds && Object.values(C.RATE_RULES).every((r) => r.max >= 1 && r.windowSeconds >= 1 && r.windowSeconds <= 172800));
  check("limits: rate_limited is a stable code (429)", HTTP_STATUS.rate_limited === 429 && codeOf({ ok: false, code: "rate_limited" }) === "rate_limited");
  {
    const w = makeWorld(unlimited); w.deps.limiter = memLimiter(w);
    let last; for (let i = 1; i <= C.RATE_RULES.order_ip.max; i++) last = await createProductOrder(w.deps, goodOrder({ customer_phone: phone9(i), quantity: 1 }), { customerId: null, clientKey: "203.0.113.7" });
    check("limits: orders up to the per-IP limit succeed", last.ok && w.db.orders.size === C.RATE_RULES.order_ip.max);
    const stock = w.db.products.get(U(11)).inventory_count; const seq = w.db.seq;
    const blocked = await createProductOrder(w.deps, goodOrder({ customer_phone: phone9(99), quantity: 1 }), { customerId: null, clientKey: "203.0.113.7" });
    check("limits: the next order from the same client is refused with rate_limited — no order, no stock reserved", codeOf(blocked) === "rate_limited" && w.db.orders.size === C.RATE_RULES.order_ip.max && w.db.seq === seq && w.db.products.get(U(11)).inventory_count === stock);
    const other = await createProductOrder(w.deps, goodOrder({ customer_phone: phone9(98), quantity: 1 }), { customerId: null, clientKey: "203.0.113.8" });
    check("limits: a different client is unaffected", other.ok);
    const noKey = await createProductOrder(w.deps, goodOrder({ customer_phone: phone9(97), quantity: 1 }), { customerId: null });
    check("limits: no client key (address unavailable) means no IP limit is applied", noKey.ok);
    w.clock.t += 601000;
    check("limits: allowed again after the window passes", (await createProductOrder(w.deps, goodOrder({ customer_phone: phone9(96), quantity: 1 }), { customerId: null, clientKey: "203.0.113.7" })).ok);
    const inelig = makeWorld({ settings: { commerceEnabled: false } }); inelig.deps.limiter = memLimiter(inelig);
    await createProductOrder(inelig.deps, goodOrder(), { customerId: null, clientKey: "1.1.1.1" });
    check("limits: a request refused for another reason (commerce off) does not use up the limit", inelig.deps.limiter.calls.length === 0);
  }
  {
    // payer-number flood: one stranger's phone, many orders, many clients
    const w = makeWorld(unlimited); w.deps.limiter = memLimiter(w);
    const results = [];
    for (let i = 1; i <= 5; i++) {
      const o = await newOrder(w, { customer_phone: phone9(i), quantity: 1 });
      results.push(codeOf(await initiateProductPayment(w.deps, o.id, goodPay({ phone: "677 00 00 00" }), { clientKey: `198.51.100.${i}` })));
    }
    check("limits: the same payer number can only be prompted RULES.pay_phone.max times per window, whatever the order or client", results.filter((r) => r === "OK").length === C.RATE_RULES.pay_phone.max && results.slice(C.RATE_RULES.pay_phone.max).every((r) => r === "rate_limited"), results.join());
    check("limits: a refused prompt calls the provider zero extra times and writes no payment row", w.provider.calls.length === C.RATE_RULES.pay_phone.max && w.db.payments.length === C.RATE_RULES.pay_phone.max);
    w.clock.t += 601000;
    const o2 = await newOrder(w, { customer_phone: phone9(50), quantity: 1 });
    check("limits: the same payer number is allowed again after the 10-minute window (while under the daily cap)", codeOf(await initiateProductPayment(w.deps, o2.id, goodPay({ phone: "677 00 00 00" }), { clientKey: "198.51.100.50" })) === "OK");
    let day = 0; for (let n = 0; n < 12; n++) { w.clock.t += 601000; const o = await newOrder(w, { customer_phone: phone9(100 + n), quantity: 1 }); if (codeOf(await initiateProductPayment(w.deps, o.id, goodPay({ phone: "677 00 00 00" }), { clientKey: `192.0.2.${n}` })) === "OK") day++; }
    check("limits: the daily cap applies even when every 10-minute window is clear", day + 4 === C.RATE_RULES.pay_phone_day.max, String(day));
    const w3 = makeWorld(unlimited); w3.deps.limiter = memLimiter(w3); let okIp = 0;
    for (let i = 1; i <= 14; i++) { const o = await newOrder(w3, { customer_phone: phone9(i), quantity: 1 }); if (codeOf(await initiateProductPayment(w3.deps, o.id, goodPay({ phone: phone9(200 + i) }), { clientKey: "203.0.113.99" })) === "OK") okIp++; }
    check("limits: one client cannot prompt more than RULES.pay_ip.max numbers per window", okIp === C.RATE_RULES.pay_ip.max, String(okIp));
  }
  {
    // the limiter itself failing must never block a customer, and must be logged without leaking
    const w = makeWorld(); w.deps.limiter = { async hit() { throw new Error("connection string postgres://user:SECRETPW@host"); } };
    const p = await paying(w);
    const o = await createProductOrder(w.deps, goodOrder({ customer_phone: "677999999" }), { customerId: null, clientKey: "1.2.3.4" });
    check("limits: a failing limiter fails OPEN (order and payment still work)", o.ok && !!p.transId);
    const logs = w.db.logs.filter((l) => l.e === "product_rate_limit_error");
    check("limits: the failure is logged, bounded, and the caller gets no error text", logs.length >= 1 && logs.every((l) => String(l.d.error).length <= 120));
    check("limits: withinLimit with no limiter or no subject applies no limit", (await withinLimit({ log: nofn }, "pay_ip", "x")) === true && (await withinLimit({ limiter: { hit: async () => false }, log: nofn }, "pay_ip", null)) === true && (await withinLimit({ limiter: { hit: async () => false }, log: nofn }, "pay_ip", "x")) === false);
  }
  {
    // existing behaviour with a limiter present but permissive: identical outcomes
    const w = makeWorld(); w.deps.limiter = { async hit() { return true; } }; const p = await paying(w);
    w.provider.statuses.set(p.transId, { status: "SUCCESSFUL", amount: 12000 });
    const s = await checkProductPayment(w.deps, p.order.id);
    check("regression: with a permissive limiter the normal pay -> success flow is unchanged", s.ok && s.data.status === "succeeded" && w.db.earnings.length === 1);
  }
  // mutation: a reconciler that skipped the amount check would be caught by the test above; here, without the gate a hammering sweep exceeds 6/min
  {
    const w = makeWorld(); await paying(w); const stamps = []; const real = w.provider.getStatus.bind(w.provider);
    w.provider.getStatus = async (id) => { stamps.push(w.clock.t); return real(id); };
    for (let s = 0; s < 60; s++) { w.clock.t += 1000; await reconcileProductPayments(w.deps); }
    check("mutation: WITHOUT the poll gate a sweep every second exceeds 6/min (so the gate tests can fail)", stamps.length > 6);
  }
}

// ================================================================ 8. SERVER WIRING: real store query, hashing, ROUTES, CRON
{
  const os = await import("os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pc-routes-"));
  const write = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };
  const SRC = path.join(REPO, "src");

  // --- the REAL supabaseStore.listReconcilableOrderIds against a tiny in-memory PostgREST-style builder
  {
    const { createSupabaseStore } = L("supabaseStore.ts");
    const mkAdmin = (tables) => ({
      from(name) {
        const q = { f: [], order: null, limit: null };
        const b = {
          select() { return b; },
          eq(c, v) { q.f.push((r) => r[c] === v); return b; },
          in(c, vs) { q.f.push((r) => vs.includes(r[c])); return b; },
          not(c, op, v) { if (op === "is" && v === null) q.f.push((r) => r[c] != null); return b; },
          gte(c, v) { q.f.push((r) => r[c] >= v); return b; },
          order(c, o) { q.order = [c, o.ascending]; return b; },
          limit(n) { q.limit = n; return b; },
          then(res, rej) {
            let rows = (tables[name] || []).filter((r) => q.f.every((f) => f(r)));
            if (q.order) rows = [...rows].sort((x, y) => (x[q.order[0]] < y[q.order[0]] ? -1 : 1) * (q.order[1] ? 1 : -1));
            if (q.limit != null) rows = rows.slice(0, q.limit);
            return Promise.resolve({ data: rows, error: null }).then(res, rej);
          },
        };
        return b;
      },
    });
    const T0 = Date.parse("2026-11-03T10:00:00Z"), iso = (h) => new Date(T0 - h * 3600000).toISOString();
    const pay = (id, target, status, ageH, tx = "TX") => ({ id, target_id: target, target_type: "product_order", status, created_at: iso(ageH), provider_transaction_id: tx });
    const tables = {
      product_orders: [
        { id: "o-open", status: "awaiting_payment" }, { id: "o-paid", status: "paid" }, { id: "o-review", status: "payment_review" },
        { id: "o-exp", status: "expired" }, { id: "o-old", status: "expired" }, { id: "o-heal", status: "awaiting_payment" }, { id: "o-notx", status: "awaiting_payment" },
      ],
      customer_payments: [
        pay("1", "o-open", "pending", 1), pay("2", "o-paid", "pending", 1), pay("3", "o-review", "expired", 1), pay("4", "o-exp", "expired", 2),
        pay("5", "o-old", "expired", 30), pay("6", "o-heal", "succeeded", 3), pay("7", "o-notx", "initiated", 1, null),
      ],
    };
    const store = createSupabaseStore(mkAdmin(tables));
    const ids = await store.listReconcilableOrderIds({ sinceIso: iso(24), limit: 10 });
    check("real store query: succeeded-unsettled first, then open, then recently expired; skips paid / review / too old / no transaction id", JSON.stringify(ids) === JSON.stringify(["o-heal", "o-open", "o-exp"]), JSON.stringify(ids));
    check("real store query: limit is honoured", (await store.listReconcilableOrderIds({ sinceIso: iso(24), limit: 2 })).length === 2);
    check("real store query: nothing to do -> empty (no orders query needed)", (await createSupabaseStore(mkAdmin({ customer_payments: [], product_orders: [] })).listReconcilableOrderIds({ sinceIso: iso(24), limit: 5 })).length === 0);
    let threw = false; try { await createSupabaseStore({ from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, limit() { return this; }, in() { return this; }, not() { return this; }, gte() { return this; }, then(res) { return Promise.resolve({ data: null, error: { code: "XX000", message: "SECRET internal detail" } }).then(res); } }) }).listReconcilableOrderIds({ sinceIso: iso(24), limit: 5 }); } catch (e) { threw = !/SECRET/.test(e.message); }
    check("real store query: a database error throws a generic message (no database text)", threw);
  }

  // --- keyed hashing + the RPC limiter
  {
    const { hashRateSubject, createSupabaseRateLimiter } = L("commerceRateLimiter.ts");
    const saved = process.env.SETTINGS_ENCRYPTION_KEY; process.env.SETTINGS_ENCRYPTION_KEY = "test-key-A";
    const h = hashRateSubject("pay_ip", "203.0.113.7");
    check("hash: 64 hex chars, deterministic, case/space-insensitive, bound to the kind", /^[0-9a-f]{64}$/.test(h) && h === hashRateSubject("pay_ip", " 203.0.113.7 ") && h !== hashRateSubject("order_ip", "203.0.113.7") && h !== hashRateSubject("pay_ip", "203.0.113.8"));
    check("hash: the raw value is not in the output", !h.includes("203") || !/203\.0\.113\.7/.test(h));
    process.env.SETTINGS_ENCRYPTION_KEY = "test-key-B"; const h2 = hashRateSubject("pay_ip", "203.0.113.7"); process.env.SETTINGS_ENCRYPTION_KEY = "test-key-A";
    check("hash: keyed - a different secret gives a different hash (not reversible without the server key)", h !== h2);
    let calls = []; const admin = (ret) => ({ async rpc(fn, args) { calls.push([fn, args]); return ret; } });
    check("limiter: true from the database = allowed, false = refused", (await createSupabaseRateLimiter(admin({ data: true, error: null })).hit("pay_phone", "677000000")) === true && (await createSupabaseRateLimiter(admin({ data: false, error: null })).hit("pay_phone", "677000000")) === false);
    const [fn, args] = calls[0];
    check("limiter: calls commerce_rate_limit_hit with only the kind, a hash, the window and the max - never a raw phone or IP", fn === "commerce_rate_limit_hit" && JSON.stringify(Object.keys(args).sort()) === JSON.stringify(["p_kind", "p_max", "p_subject_hash", "p_window_seconds"]) && !JSON.stringify(args).includes("677000000") && args.p_window_seconds === C.RATE_RULES.pay_phone.windowSeconds && args.p_max === C.RATE_RULES.pay_phone.max);
    let msg = ""; try { await createSupabaseRateLimiter(admin({ data: null, error: { code: "42883", message: "function does not exist SECRET" } })).hit("pay_ip", "1.1.1.1"); } catch (e) { msg = e.message; }
    check("limiter: a database error (e.g. function not installed yet) throws a generic message, so callers fail open", /failed \(42883\)/.test(msg) && !/SECRET/.test(msg));
    delete process.env.SETTINGS_ENCRYPTION_KEY; let noKey = false; try { hashRateSubject("pay_ip", "x"); } catch { noKey = true; } process.env.SETTINGS_ENCRYPTION_KEY = saved ?? "";
    if (saved === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY;
    check("hash: refuses to run without the server secret", noKey);
  }

  // --- ROUTES: real route handlers + real respond/internalError; only the wiring is stubbed
  const httpStub = write("http.stub.ts", `
    import { respond, internalError } from ${JSON.stringify(path.join(SRC, "lib/productCheckout/responses.ts").replace(/\\/g, "/"))};
    export { respond, internalError };
    export function buildCheckoutDeps() { return (globalThis as any).__T.buildDeps(); }
  `);
  const sessionStub = write("session.stub.ts", `export function isSameOrigin() { return false; } export async function getCustomerFromCookie() { return null; }`);
  const jitiR = require("jiti")(import.meta.url, {
    alias: { "@/lib/productCheckout/http": httpStub, "@/lib/customer/session": sessionStub, "@": SRC },
    interopDefault: true, cache: false, requireCache: false,
  });
  const R = (p) => jitiR(path.join(SRC, "app/api", p));
  const ordersRoute = R("products/orders/route.ts"), payRoute = R("products/orders/[id]/pay/route.ts"), statusRoute = R("products/orders/[id]/pay-status/route.ts"), cronRoute = R("cron/reconcile-product-payments/route.ts");
  const { createSupabaseRateLimiter, hashRateSubject } = L("commerceRateLimiter.ts");
  const savedKey = process.env.SETTINGS_ENCRYPTION_KEY; process.env.SETTINGS_ENCRYPTION_KEY = "route-test-key";
  const quiet = console.error; const warn = console.warn;

  const rpcCalls = []; let rpcMode = "allow";
  const admin = { async rpc(fn, args) { rpcCalls.push(args); if (rpcMode === "deny") return { data: false, error: null }; if (rpcMode === "error") return { data: null, error: { code: "42883" } }; return { data: true, error: null }; } };
  let W = makeWorld({ product: { inventory_count: null } });
  globalThis.__T = { buildDeps: () => { W.clock.t = Date.now(); return { ...W.deps, now: () => new Date(), limiter: createSupabaseRateLimiter(admin), pollGate: undefined }; } };
  const req = (url, method, body, headers = {}) => new Request(`http://localhost${url}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (res) => { const t = await res.text(); try { return [res.status, JSON.parse(t), t]; } catch { return [res.status, null, t]; } };

  // create order
  let [st, body] = await json(await ordersRoute.POST(req("/api/products/orders", "POST", goodOrder({ quantity: 1 }), { "x-forwarded-for": "203.0.113.7, 10.0.0.1" })));
  check("route POST /orders: valid -> 201 with the order view (no phone / email / customer id)", st === 201 && body.id && body.total === 6000 && !("customer_phone" in body) && !("customer_email" in body) && !("customer_id" in body), JSON.stringify(body));
  check("route POST /orders: the client IP (first x-forwarded-for entry) is hashed before it reaches the database", rpcCalls.length === 1 && rpcCalls[0].p_kind === "order_ip" && rpcCalls[0].p_subject_hash === hashRateSubject("order_ip", "203.0.113.7") && !JSON.stringify(rpcCalls).includes("203.0.113"));
  const orderId = body.id;
  rpcCalls.length = 0; await ordersRoute.POST(req("/api/products/orders", "POST", goodOrder({ quantity: 1, customer_phone: "677111111" })));
  check("route POST /orders: no client address available -> no IP limit call", rpcCalls.length === 0);
  [st, body] = await json(await ordersRoute.POST(req("/api/products/orders", "POST", goodOrder({ quantity: 0 }))));
  check("route POST /orders: invalid input -> 400 with a code only", st === 400 && Object.keys(body).length === 1 && typeof body.error === "string");
  rpcMode = "deny"; const seq0 = W.db.seq;
  [st, body] = await json(await ordersRoute.POST(req("/api/products/orders", "POST", goodOrder({ quantity: 1, customer_phone: "677222222" }), { "x-forwarded-for": "198.51.100.9" })));
  check("route POST /orders: over the limit -> 429 rate_limited, no order created", st === 429 && body.error === "rate_limited" && W.db.seq === seq0);
  rpcMode = "error"; console.warn = () => {};
  [st, body] = await json(await ordersRoute.POST(req("/api/products/orders", "POST", goodOrder({ quantity: 1, customer_phone: "677333333" }), { "x-forwarded-for": "198.51.100.10" })));
  console.warn = warn;
  check("route POST /orders: the limiter function missing/failing fails OPEN (order still created)", st === 201 && !!body.id);
  rpcMode = "allow";

  // pay
  rpcCalls.length = 0;
  [st, body] = await json(await payRoute.POST(req(`/api/products/orders/${orderId}/pay`, "POST", { phone: "677 12 34 56", medium: "mobile money" }, { "x-forwarded-for": "203.0.113.7" }), { params: { id: orderId } }));
  check("route POST /pay: valid -> 200 pending, no transaction id / phone in the response", st === 200 && body.status === "pending" && !/TX-|677/.test(JSON.stringify(body)), JSON.stringify(body));
  check("route POST /pay: three abuse-limit hits (ip, payer phone 10min, payer phone day), all hashed - no raw IP or phone", rpcCalls.map((c) => c.p_kind).join() === "pay_ip,pay_phone,pay_phone_day" && !/203\.0\.113|677123456/.test(JSON.stringify(rpcCalls)));
  rpcMode = "deny"; const provCalls = W.provider.calls.length;
  const o2 = (await json(await ordersRoute.POST(req("/api/products/orders", "POST", goodOrder({ quantity: 1, customer_phone: "677444444" })))))[1];
  [st, body] = await json(await payRoute.POST(req(`/api/products/orders/${o2.id}/pay`, "POST", { phone: "677 12 34 56", medium: "mobile money" }), { params: { id: o2.id } }));
  check("route POST /pay: over the limit -> 429 rate_limited and Fapshi is never called", st === 429 && body.error === "rate_limited" && W.provider.calls.length === provCalls);
  rpcMode = "allow";
  [st, body] = await json(await payRoute.POST(req(`/api/products/orders/${o2.id}/pay`, "POST", { phone: "abc", medium: "mobile money" }), { params: { id: o2.id } }));
  check("route POST /pay: bad phone -> 400 invalid_phone", st === 400 && body.error === "invalid_phone");
  [st, body] = await json(await payRoute.POST(req(`/api/products/orders/zzz/pay`, "POST", { phone: "677123456", medium: "mobile money" }), { params: { id: "zzz" } }));
  check("route POST /pay: malformed order id -> 404 order_not_found", st === 404 && body.error === "order_not_found");

  // pay-status
  [st, body] = await json(await statusRoute.GET(req(`/api/products/orders/${orderId}/pay-status`, "GET"), { params: { id: orderId } }));
  check("route GET /pay-status: pending order -> 200 pending", st === 200 && body.status === "pending");
  [st, body] = await json(await statusRoute.GET(req(`/x`, "GET"), { params: { id: U(31337) } }));
  check("route GET /pay-status: unknown order -> 404 order_not_found", st === 404 && body.error === "order_not_found");
  W.provider.statuses.set(W.db.payments[0].provider_transaction_id, { status: "SUCCESSFUL", amount: 6000 });
  [st, body] = await json(await statusRoute.GET(req(`/x`, "GET"), { params: { id: orderId } }));
  check("route GET /pay-status: success is settled and returned (receipt number, no ids of payments)", st === 200 && body.status === "succeeded" && /^RCP-/.test(body.receipt_number) && W.db.earnings.length === 1 && !("payment_id" in body));

  // every public error code maps to its declared HTTP status through the real respond()
  {
    const { respond, internalError } = jitiR(path.join(SRC, "lib/productCheckout/responses.ts"));
    let all = true; for (const [code, status] of Object.entries(HTTP_STATUS)) { const r = respond({ ok: false, code }); const j = await r.json(); if (r.status !== status || j.error !== code || Object.keys(j).length !== 1) all = false; }
    check("HTTP mapping: every public error code returns exactly its declared status with only { error: code }", all && Object.keys(HTTP_STATUS).length >= 29);
    check("HTTP mapping: the 429 codes are rate_limited, too_many_open_orders, too_many_payment_attempts", Object.entries(HTTP_STATUS).filter(([, s]) => s === 429).map(([c]) => c).sort().join() === "rate_limited,too_many_open_orders,too_many_payment_attempts");
    check("HTTP mapping: success uses the requested status", respond({ ok: true, data: { a: 1 } }, 201).status === 201);
    console.error = () => {}; const r = internalError(new Error("password=hunter2 host=db.internal")); console.error = quiet;
    const [s5, j5, t5] = await json(r);
    check("no leakage: internalError is a bare 500 { error: 'internal_error' }", s5 === 500 && j5.error === "internal_error" && !/hunter2|db\.internal/.test(t5));
  }
  // unexpected exceptions never leak through any route
  {
    const boom = new Error("relation product_orders SECRET-DB-PASSWORD=abc123 at db.internal:5432");
    const saved = W.deps.store.getProduct; W.deps.store.getProduct = async () => { throw boom; }; console.error = () => {};
    const a = await json(await ordersRoute.POST(req("/api/products/orders", "POST", goodOrder())));
    W.deps.store.getProduct = saved;
    const savedGet = W.deps.store.getOrder; W.deps.store.getOrder = async () => { throw boom; };
    const b = await json(await statusRoute.GET(req("/x", "GET"), { params: { id: orderId } }));
    const c = await json(await payRoute.POST(req("/x", "POST", { phone: "677123456", medium: "mobile money" }), { params: { id: orderId } }));
    W.deps.store.getOrder = savedGet; console.error = quiet;
    check("no leakage: an unexpected exception in any checkout route is a generic 500 with no internal text", [a, b, c].every(([s, j, t]) => s === 500 && j.error === "internal_error" && !/SECRET|abc123|db\.internal|relation/.test(t)));
  }

  // --- CRON route
  W = makeWorld({ product: { inventory_count: null } });
  const cp = await (async () => { const o = await newOrder(W, { quantity: 1 }); await initiateProductPayment(W.deps, o.id, goodPay()); return { order: o, tx: W.db.payments[0].provider_transaction_id }; })();
  W.provider.statuses.set(cp.tx, { status: "SUCCESSFUL", amount: 6000 });
  const saveSecret = process.env.CRON_SECRET;
  const cron = (auth) => cronRoute.GET(req("/api/cron/reconcile-product-payments", "GET", undefined, auth === undefined ? {} : { authorization: auth }));
  process.env.CRON_SECRET = "cron-secret-value";
  let [cs, cj] = await json(await cron());
  check("cron: no Authorization header -> 401, nothing settled", cs === 401 && cj.error === "Unauthorized" && W.db.earnings.length === 0 && W.provider.statusCalls === 0);
  [cs] = await json(await cron("Bearer wrong")); const c2 = cs;
  [cs] = await json(await cron("cron-secret-value")); const c3 = cs;
  [cs] = await json(await cron("Bearer cron-secret-valuee")); const c4 = cs;
  check("cron: wrong secret, missing 'Bearer', or a longer/shorter value -> 401", c2 === 401 && c3 === 401 && c4 === 401 && W.db.earnings.length === 0);
  delete process.env.CRON_SECRET;
  [cs] = await json(await cron("Bearer undefined")); const u1 = cs; [cs] = await json(await cron("Bearer ")); const u2 = cs; [cs] = await json(await cron());
  check("cron: with CRON_SECRET unset EVERY request is refused (never matches the literal 'Bearer undefined')", u1 === 401 && u2 === 401 && cs === 401 && W.db.earnings.length === 0);
  process.env.CRON_SECRET = "cron-secret-value";
  let raw; [cs, cj, raw] = await json(await cron("Bearer cron-secret-value"));
  check("cron: correct secret -> 200 with counts only", cs === 200 && cj.ok === true && cj.succeeded === 1 && cj.examined === 1 && Object.values(cj).every((v) => typeof v === "number" || typeof v === "boolean"));
  check("cron: the payment was settled through the shared path (order paid, exactly one earning)", W.db.orders.get(cp.order.id).status === "paid" && W.db.earnings.length === 1);
  check("cron: the response contains no order id, phone, amount or transaction id", !new RegExp(`${cp.order.id}|${cp.tx}|677|6000`).test(raw));
  [cs, cj] = await json(await cron("Bearer cron-secret-value"));
  check("cron: a second run is a no-op (idempotent)", cs === 200 && cj.examined === 0 && W.db.earnings.length === 1);
  { const leak = new Error("SECRET-CONN-STRING db.internal"); const svd = W.deps.store.listReconcilableOrderIds; W.deps.store.listReconcilableOrderIds = async () => { throw leak; }; console.error = () => {};
    const [s5, j5, t5] = await json(await cron("Bearer cron-secret-value")); console.error = quiet; W.deps.store.listReconcilableOrderIds = svd;
    check("cron: an internal failure is a generic 500 with no internal text", s5 === 500 && j5.error === "internal_error" && !/SECRET|db\.internal/.test(t5)); }
  if (saveSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saveSecret;
  if (savedKey === undefined) delete process.env.SETTINGS_ENCRYPTION_KEY; else process.env.SETTINGS_ENCRYPTION_KEY = savedKey;
  console.error = quiet; console.warn = warn; delete globalThis.__T;

  // --- the REAL http.ts wiring (limiter + shared poll gate) with only the leaf modules stubbed
  {
    const supaStub = write("supa.stub.ts", `export function createAdminClient() { return { from() { throw new Error("not used"); }, rpc() { throw new Error("not used"); } }; }`);
    const fapStub = write("fapshi.stub.ts", `export async function fapshiDirectPay() { throw new Error("no network in tests"); } export async function fapshiGetStatus() { throw new Error("no network in tests"); }`);
    const jitiH = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": supaStub, "@/lib/fapshi": fapStub, "@": SRC }, interopDefault: true, cache: false, requireCache: false });
    const H = jitiH(path.join(SRC, "lib/productCheckout/http.ts"));
    const d1 = H.buildCheckoutDeps(), d2 = H.buildCheckoutDeps();
    check("http wiring: real deps carry the abuse limiter and one poll gate shared by every request", !!d1.limiter && typeof d1.limiter.hit === "function" && !!d1.pollGate && d1.pollGate === d2.pollGate);
    check("http wiring: re-exports respond/internalError for the routes", typeof H.respond === "function" && typeof H.internalError === "function");
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  // --- source-level facts
  const cronSrc = fs.readFileSync(path.join(REPO, "src/app/api/cron/reconcile-product-payments/route.ts"), "utf8");
  // Ringo Protection Phase 12 legitimately added its own auto-release cron (unrelated to
  // reconcile-product-payments) — this still proves that addition never touched or duplicated the
  // original two Normal-Payment-unrelated jobs.
  check(
    "cron: vercel.json still has the original two jobs unchanged, plus only the Protection auto-release cron added in Phase 12",
    JSON.stringify(JSON.parse(fs.readFileSync(path.join(REPO, "vercel.json"), "utf8")).crons.map((c) => c.path).sort()) ===
      JSON.stringify(["/api/cron/cleanup-demo-accounts", "/api/cron/downgrade-expired", "/api/cron/protection-auto-release"].sort())
  );
  check("cron: uses timingSafeEqual and requires CRON_SECRET to be set", /timingSafeEqual/.test(cronSrc) && /if \(!secret\) return false/.test(cronSrc));
  const reconSrc = fs.readFileSync(path.join(REPO, "src/lib/productCheckout/reconcile.ts"), "utf8");
  check("reconcile: contains no settlement logic of its own (delegates to checkProductPayment)", /checkProductPayment/.test(reconSrc) && !/settleProductPayment|insertEarning|computeEarnings|updateOrder|releaseOrder/.test(reconSrc.replace(/\/\/.*$/gm, "")));
  const settleSrc = fs.readFileSync(path.join(REPO, "src/lib/productCheckout/settlement.ts"), "utf8");
  check("settlement, commission and amount verification are untouched by this increment (still gated by VERIFY_PROVIDER_AMOUNT; commission from computeEarnings)", /VERIFY_PROVIDER_AMOUNT/.test(settleSrc) && /computeEarnings\(payment\.amount, settings\.commissionRate\)/.test(settleSrc) && C.VERIFY_PROVIDER_AMOUNT === true);
  const tr = fs.readFileSync(path.join(REPO, "src/lib/i18n/translations.ts"), "utf8");
  check("i18n: rate_limited has an English and a French message", /rate_limited: "Too many requests/.test(tr) && /rate_limited: "Trop de demandes/.test(tr));
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
