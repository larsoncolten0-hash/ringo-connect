// Increment 5A: seller Shop section (orders, order detail, fulfillment, earnings). No network, no real
// database, no Fapshi, no real payment, commerce stays disabled. Data access runs against an in-memory
// PostgREST-style fake that EMULATES row level security (a seller's client only sees their own profile's
// rows, has no write grants, and cannot read customer_payments) and the order state-machine trigger, so
// the tests can prove both layers: the RLS-scoped read AND the application's own profile filter.
//   Run:  node scripts/tests/shopSeller.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const L = (f) => jiti(path.join(SRC, "lib/productCheckout", f));
const SO = L("sellerOrders.ts");
const { fulfillOrder } = L("fulfillOrder.ts");
const { createSellerReader, createFulfillStore } = L("sellerReaders.ts");
const { SELLER_HTTP_STATUS, isSellerErrorCode } = L("sellerErrors.ts");
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ALL = ["awaiting_payment", "paid", "fulfilled", "cancelled", "expired", "refunded", "payment_review"];

// ================================================================ in-memory world (RLS + trigger emulation)
const LEGAL = {
  awaiting_payment: ["paid", "expired", "cancelled", "payment_review"],
  expired: ["paid", "payment_review"],
  cancelled: ["payment_review"],
  payment_review: ["paid", "refunded", "cancelled"],
  paid: ["fulfilled", "refunded", "payment_review"],
  fulfilled: ["refunded"],
};
const P_A = U(1), P_B = U(2), P_ADMIN = U(3), USER_A = U(101), USER_B = U(102), USER_ADMIN = U(103), USER_NOPROFILE = U(104);

function makeWorld() {
  const db = { profiles: [], product_orders: [], product_order_items: [], commerce_sale_earnings: [], customer_payments: [], requests: [], fail: null };
  db.profiles.push({ id: P_A, user_id: USER_A, username: "alpha", category: "business_ecommerce", categories: [] }, { id: P_B, user_id: USER_B, username: "beta", category: "business_ecommerce", categories: [] }, { id: P_ADMIN, user_id: USER_ADMIN, username: "boss", category: "business_ecommerce", categories: [] });
  let seq = 0;
  const day = (n) => new Date(Date.parse("2026-11-03T10:00:00Z") - n * 3600000).toISOString();
  const addOrder = (profile_id, status, over = {}) => {
    seq++;
    const id = over.id || U(1000 + seq);
    const total = over.total ?? 12000;
    db.product_orders.push({ id, order_number: seq, profile_id, customer_id: null, customer_name: over.customer_name || `Buyer ${seq}`, customer_phone: over.customer_phone || "677123456", customer_email: over.customer_email ?? "buyer@example.com", customer_note: over.customer_note ?? "Call first", currency: "XAF", subtotal: total, total, status, expires_at: day(0), paid_at: ["paid", "fulfilled", "refunded"].includes(status) ? day(seq) : null, stock_released_at: null, created_at: over.created_at || day(1000 - seq), updated_at: day(500 - seq) });
    db.product_order_items.push({ id: U(5000 + seq), order_id: id, product_id: null, name_snapshot: over.name || "Blue Widget", image_snapshot: null, unit_price_snapshot: total / 2, quantity: 2, line_total: total });
    return id;
  };
  const addEarning = (order_id, profile_id, over = {}) => {
    seq++;
    const gross = over.gross ?? 12000, rate = over.rate ?? 0.05, fee = over.fee ?? Math.round(gross * rate * 100) / 100;
    db.commerce_sale_earnings.push({ id: U(9000 + seq), order_id, payment_id: over.payment_id || U(7000 + seq), profile_id, creator_user_id: profile_id === P_A ? USER_A : USER_B, gross_amount: gross, commission_rate: rate, platform_fee: fee, net_amount: over.net ?? gross - fee, currency: over.currency || "XAF", status: over.status || "recorded", created_at: over.created_at || day(900 - seq) });
  };
  const addPayment = (order_id, profile_id, over = {}) => {
    seq++;
    db.customer_payments.push({ id: U(7000 + seq), provider: "fapshi", provider_transaction_id: over.tx || "TX-SECRET-1", external_id: over.external_id || `pp-${U(7000 + seq)}`, target_type: "product_order", target_id: order_id, profile_id, amount: 12000, currency: "XAF", payer_medium: over.medium || "mobile money", status: over.status || "succeeded", provider_status: "SUCCESSFUL", failure_reason: over.failure || null, expires_at: day(0), confirmed_at: over.confirmed_at || day(3), created_at: over.created_at || day(4) });
  };

  const profileOf = (id) => db.profiles.find((p) => p.id === id);
  // Which rows may this viewer read? (the owner-or-admin policies of the migration)
  const canSee = (viewer, table, row) => {
    if (viewer === "service") return true;
    if (!viewer) return false;
    if (table === "customer_payments") return false; // no client grant at all
    if (!["product_orders", "product_order_items", "commerce_sale_earnings"].includes(table)) return table === "profiles" ? row.user_id === viewer.userId : false;
    const orderRow = table === "product_order_items" ? db.product_orders.find((o) => o.id === row.order_id) : row;
    const pid = table === "product_order_items" ? orderRow?.profile_id : row.profile_id;
    return viewer.isAdmin || profileOf(pid)?.user_id === viewer.userId;
  };
  const legal = (from, to) => from === to || (LEGAL[from] || []).includes(to);

  function client(viewer, { rlsOn = true } = {}) {
    const effective = viewer === "service" ? "service" : rlsOn ? viewer : "service";
    return {
      auth: { getUser: async () => ({ data: { user: viewer && viewer !== "service" ? { id: viewer.userId } : null } }) },
      from(table) {
        const q = { filters: [], order: [], range: null, patch: null, head: false, count: false, cols: "*" };
        db.requests.push({ table, q, viewer: viewer === "service" ? "service" : "rls" });
        const run = () => {
          if (db.fail && db.fail.table === table) return { data: null, error: { code: "XX000", message: "SECRET internal detail postgres://u:pw@host" }, count: null };
          let rows = db[table].filter((r) => canSee(effective, table, r) && q.filters.every((f) => f(r)));
          if (q.patch) {
            if (viewer !== "service") return { data: null, error: { code: "42501", message: "permission denied for table " + table } };
            const out = [];
            for (const r of rows) {
              if (table === "product_orders" && q.patch.status && !legal(r.status, q.patch.status)) return { data: null, error: { code: "P0001", message: `product_orders: illegal status transition ${r.status} -> ${q.patch.status}` } };
              Object.assign(r, q.patch, { updated_at: new Date().toISOString() });
              out.push({ id: r.id });
            }
            return { data: out, error: null };
          }
          for (const [col, asc] of [...q.order].reverse()) rows = [...rows].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
          const total = rows.length;
          if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
          if (q.head) return { data: null, error: null, count: total };
          rows = rows.map((r) => {
            const copy = { ...r };
            if (table === "product_orders" && /product_order_items\(/.test(q.cols)) copy.product_order_items = db.product_order_items.filter((i) => i.order_id === r.id);
            if (table === "commerce_sale_earnings" && /product_orders\(/.test(q.cols)) copy.product_orders = { order_number: db.product_orders.find((o) => o.id === r.order_id)?.order_number ?? null };
            return copy;
          });
          return { data: rows, error: null, count: q.count ? total : null };
        };
        const b = {
          select(cols, opts) { q.cols = cols || "*"; if (opts?.count) q.count = true; if (opts?.head) q.head = true; return b; },
          update(patch) { q.patch = patch; return b; },
          eq(c, v) { q.filters.push((r) => r[c] === v); return b; },
          in(c, vs) { q.filters.push((r) => vs.includes(r[c])); return b; },
          order(c, o) { q.order.push([c, o?.ascending !== false]); return b; },
          range(a, z) { q.range = [a, z]; return b; },
          limit() { return b; },
          maybeSingle() { const r = run(); return Promise.resolve(r.error ? r : { data: r.data?.[0] ?? null, error: null }); },
          single() { return b.maybeSingle(); },
          then(res, rej) { return Promise.resolve(run()).then(res, rej); },
        };
        return b;
      },
    };
  }
  const viewerOf = (userId, isAdmin = false) => ({ userId, isAdmin });
  return { db, addOrder, addEarning, addPayment, client, viewerOf };
}

// ================================================================ 1. status mapping
{
  const expected = { awaiting_payment: ["awaiting", "none", false], paid: ["paid", "to_fulfill", true], fulfilled: ["paid", "fulfilled", false], cancelled: ["cancelled", "none", false], expired: ["expired", "none", false], refunded: ["refunded", "none", false], payment_review: ["review", "none", false] };
  for (const s of ALL) check(`status ${s}: payment=${expected[s][0]} fulfillment=${expected[s][1]} canFulfil=${expected[s][2]}`, SO.paymentStateOf(s) === expected[s][0] && SO.fulfillmentStateOf(s) === expected[s][1] && SO.canFulfil(s) === expected[s][2]);
  check("only 'paid' can be fulfilled", ALL.filter((s) => SO.canFulfil(s)).join() === "paid");
  check("groups: sales / to_fulfill / unpaid cover the statuses sensibly", SO.statusesForGroup("sales").join() === "paid,fulfilled,payment_review,refunded" && SO.statusesForGroup("to_fulfill").join() === "paid" && SO.statusesForGroup("unpaid").join() === "awaiting_payment,expired,cancelled");
  check("groups: every status appears in exactly one of sales / unpaid", ALL.every((s) => (SO.statusesForGroup("sales").includes(s) ? 1 : 0) + (SO.statusesForGroup("unpaid").includes(s) ? 1 : 0) === 1));
  check("parseGroup: unknown / missing / hostile values fall back to sales", ["x", "", undefined, null, 5, "unpaid; drop table", "TO_FULFILL"].every((v) => SO.parseGroup(v) === "sales") && SO.parseGroup("to_fulfill") === "to_fulfill" && SO.parseGroup("unpaid") === "unpaid");
  check("parsePage: invalid values fall back to 1, huge values are capped", ["0", "-3", "abc", "1.5", "", undefined, null, NaN].every((v) => SO.parsePage(v) === 1) && SO.parsePage("7") === 7 && SO.parsePage(3) === 3 && SO.parsePage("99999999") === SO.MAX_PAGE);
}

// ================================================================ 2. order list (through the RLS-scoped reader)
const W = makeWorld();
{
  // 45 orders for seller A across statuses, 6 for seller B
  const statuses = ["paid", "fulfilled", "awaiting_payment", "expired", "payment_review", "cancelled", "refunded", "paid", "paid"];
  for (let i = 0; i < 45; i++) W.addOrder(P_A, statuses[i % statuses.length]);
  for (let i = 0; i < 6; i++) W.addOrder(P_B, "paid", { customer_name: "B Buyer", name: "B Product" });
  const rls = W.client(W.viewerOf(USER_A)), admin = W.client("service");
  const reader = createSellerReader(rls, admin);
  const salesTotal = W.db.product_orders.filter((o) => o.profile_id === P_A && SO.statusesForGroup("sales").includes(o.status)).length;
  let page = await SO.listSellerOrders(reader, { profileId: P_A, group: "sales", page: 1 });
  check("list: sales page 1 has pageSize items, newest first, correct total and page count", page.items.length === Math.min(20, salesTotal) && page.total === salesTotal && page.pageCount === Math.ceil(salesTotal / 20) && page.items.every((o, i, a) => i === 0 || a[i - 1].createdAt >= o.createdAt), JSON.stringify([page.items.length, page.total, page.pageCount]));
  check("list: only statuses of the sales group appear", page.items.every((o) => ["paid", "fulfilled", "review", "refunded"].includes(o.payment)));
  const seen = new Set(); let n = 0;
  for (let p = 1; p <= page.pageCount; p++) { const pg = await SO.listSellerOrders(reader, { profileId: P_A, group: "sales", page: p }); pg.items.forEach((o) => seen.add(o.id)); n += pg.items.length; }
  check("list: paging through every page returns every sale exactly once (no gaps, no duplicates)", seen.size === salesTotal && n === salesTotal);
  const last = await SO.listSellerOrders(reader, { profileId: P_A, group: "sales", page: 999 });
  check("list: a page past the end shows the last page instead of an empty screen", last.page === page.pageCount && last.items.length > 0);
  check("list: page 0 / junk page → page 1", (await SO.listSellerOrders(reader, { profileId: P_A, group: "sales", page: "junk" })).page === 1);
  const unpaid = await SO.listSellerOrders(reader, { profileId: P_A, group: "unpaid", page: 1 });
  check("list: unpaid group shows only awaiting / expired / cancelled", unpaid.items.length > 0 && unpaid.items.every((o) => ["awaiting", "expired", "cancelled"].includes(o.payment)));
  const tf = await SO.listSellerOrders(reader, { profileId: P_A, group: "to_fulfill", page: 1 });
  check("list: to_fulfill shows only paid orders and the badge count matches", tf.items.length > 0 && tf.items.every((o) => o.status === "paid" && o.fulfillment === "to_fulfill") && tf.toFulfillCount === W.db.product_orders.filter((o) => o.profile_id === P_A && o.status === "paid").length);
  const it = page.items[0];
  check("list item: reference, product, quantity, gross, payment, fulfillment, date, customer summary", /^PO-\d{6}$/.test(it.reference) && it.product === "Blue Widget" && it.quantity === 2 && it.gross === 12000 && it.currency === "XAF" && !!it.payment && !!it.createdAt && it.customerName.startsWith("Buyer") && it.customerPhone === "677123456");
  check("list item: no email, note, customer id or payment-ledger data", !("customerEmail" in it) && !JSON.stringify(it).match(/buyer@example|Call first|customer_id|TX-|external|provider/i));
  check("isolation: seller A never sees seller B's orders", [...seen].every((id) => W.db.product_orders.find((o) => o.id === id).profile_id === P_A));
  const bPage = await SO.listSellerOrders(createSellerReader(W.client(W.viewerOf(USER_B)), admin), { profileId: P_B, group: "sales", page: 1 });
  check("isolation: seller B sees only their own six", bPage.total === 6 && bPage.items.every((o) => o.customerName === "B Buyer"));
  // seller A asking for B's profile id: RLS returns nothing
  const cross = await SO.listSellerOrders(createSellerReader(W.client(W.viewerOf(USER_A)), admin), { profileId: P_B, group: "sales", page: 1 });
  check("isolation: asking for another seller's profile id returns nothing (RLS)", cross.total === 0 && cross.items.length === 0);
  // defence in depth: even a client with RLS OFF only returns the requested profile's rows
  const noRls = await SO.listSellerOrders(createSellerReader(W.client(W.viewerOf(USER_A), { rlsOn: false }), admin), { profileId: P_A, group: "sales", page: 1 });
  check("defence in depth: with RLS disabled the profile filter alone still keeps B's rows out", noRls.total === salesTotal && noRls.items.every((o) => o.customerName !== "B Buyer"));
  const anon = await SO.listSellerOrders(createSellerReader(W.client(null), admin), { profileId: P_A, group: "sales", page: 1 });
  check("anonymous client sees zero orders", anon.total === 0);
  check("every order query carries the seller's profile filter and none used the service role", W.db.requests.filter((r) => r.table === "product_orders" && r.viewer === "rls").length > 0 && !W.db.requests.some((r) => r.table === "product_orders" && r.viewer === "service" && !r.q.patch));
}

// ================================================================ 3. order detail
{
  const w = makeWorld();
  const o1 = w.addOrder(P_A, "paid", { total: 12000 });
  w.addEarning(o1, P_A, { gross: 12000, rate: 0.05 });
  w.addPayment(o1, P_A, { tx: "TX-VERY-SECRET", external_id: "pp-abcdef12-3456-4789-8abc-def012345678", medium: "orange money", failure: "SECRET failure text" });
  const oOther = w.addOrder(P_B, "paid");
  const oNoEarn = w.addOrder(P_A, "payment_review");
  const oRev = w.addOrder(P_A, "refunded"); w.addEarning(oRev, P_A, { status: "reversed" });
  const oFul = w.addOrder(P_A, "fulfilled");
  const rls = w.client(w.viewerOf(USER_A)), admin = w.client("service");
  const reader = createSellerReader(rls, admin);
  // the product later changes price / the platform changes its rate: history must not move
  const detail = await SO.getSellerOrderDetail(reader, { profileId: P_A, orderId: o1 });
  check("detail: product line with the PRICE SNAPSHOT, quantity and line total", detail.lines.length === 1 && detail.lines[0].name === "Blue Widget" && detail.lines[0].quantity === 2 && detail.lines[0].unitPrice === 6000 && detail.lines[0].lineTotal === 12000 && detail.total === 12000);
  check("detail: gross / Ringo commission / seller earnings come from the immutable earning record", detail.earning.gross === 12000 && detail.earning.commission === 600 && detail.earning.net === 11400 && detail.earning.commissionRatePct === 5 && detail.earning.reversed === false);
  w.db.commerce_sale_earnings[0].commission_rate = 0.05; // (records are immutable in the DB; nothing here recalculates from anything else)
  check("detail: gross - commission = net exactly", Math.round((detail.earning.gross - detail.earning.commission) * 100) === Math.round(detail.earning.net * 100));
  check("detail: payment method and a SHORT reference only", detail.paymentInfo.method === "orange money" && detail.paymentInfo.reference === "PAY-ABCDEF12" && detail.paymentInfo.confirmedAt);
  const flat = JSON.stringify(detail);
  check("detail: no provider transaction id, provider status, failure text, external id or payment id leaks", !/TX-VERY-SECRET|SECRET failure|pp-abcdef|provider_status|provider_transaction|external_id|payment_id|creator_user_id/i.test(flat), flat.slice(0, 300));
  check("detail: customer contact for the seller (name, phone, email, note)", detail.customer.name.startsWith("Buyer") && detail.customer.phone === "677123456" && detail.customer.email === "buyer@example.com" && detail.customer.note === "Call first");
  check("detail: timestamps (placed, paid) and canFulfil for a paid order", !!detail.timestamps.createdAt && !!detail.timestamps.paidAt && detail.timestamps.fulfilledAt === null && detail.canFulfil === true && detail.fulfillment === "to_fulfill");
  const df = await SO.getSellerOrderDetail(reader, { profileId: P_A, orderId: oFul });
  check("detail: a fulfilled order shows its fulfilment time (last update) and can no longer be fulfilled", !!df.timestamps.fulfilledAt && df.canFulfil === false && df.fulfillment === "fulfilled" && df.paymentInfo === null);
  const dr = await SO.getSellerOrderDetail(reader, { profileId: P_A, orderId: oNoEarn });
  check("detail: payment_review has no earning, no fulfil action, no fulfilment time", dr.earning === null && dr.canFulfil === false && dr.payment === "review" && dr.timestamps.fulfilledAt === null);
  const drev = await SO.getSellerOrderDetail(reader, { profileId: P_A, orderId: oRev });
  check("detail: a reversed earning is flagged", drev.earning.reversed === true && drev.canFulfil === false);
  const before = w.db.requests.filter((r) => r.table === "customer_payments").length;
  const other = await SO.getSellerOrderDetail(reader, { profileId: P_A, orderId: oOther });
  check("isolation: another seller's order id → null (looks exactly like a missing order)", other === null && (await SO.getSellerOrderDetail(reader, { profileId: P_A, orderId: U(424242) })) === null);
  check("isolation: a cross-seller / missing lookup never touches the payment ledger", w.db.requests.filter((r) => r.table === "customer_payments").length === before);
  const asB = await SO.getSellerOrderDetail(createSellerReader(w.client(w.viewerOf(USER_B)), admin), { profileId: P_B, orderId: o1 });
  check("isolation: seller B asking for seller A's order → null", asB === null);
  const asAdminRls = await SO.getSellerOrderDetail(createSellerReader(w.client(w.viewerOf(USER_ADMIN, true)), admin), { profileId: P_ADMIN, orderId: o1 });
  check("isolation: even an admin's client only gets orders of the profile it asks for (profile filter)", asAdminRls === null);
  const rawSummary = await reader.getPaymentSummary(o1);
  check("reader: the ledger summary itself carries only status, method, confirmed_at and a short reference", JSON.stringify(Object.keys(rawSummary).sort()) === JSON.stringify(["confirmed_at", "method", "reference", "status"]));
  check("payment ledger is read with the service role only, and only after the order read succeeded", w.db.requests.filter((r) => r.table === "customer_payments").every((r) => r.viewer === "service"));
  const rlsPayments = await w.client(w.viewerOf(USER_A)).from("customer_payments").select("*");
  check("emulation sanity: a seller's own client can never read customer_payments", (rlsPayments.data || []).length === 0);
}

// ================================================================ 4. earnings (immutable records)
{
  const w = makeWorld();
  const mk = (over) => { const o = w.addOrder(P_A, "paid"); w.addEarning(o, P_A, over); return o; };
  mk({ gross: 12000, rate: 0.05 });
  mk({ gross: 5000, rate: 0.1 });
  mk({ gross: 100, rate: 0.055, fee: 5.5, net: 94.5 });
  mk({ gross: 20000, rate: 0.05, status: "reversed" });
  mk({ gross: 7000, rate: 0.05, currency: "USD" });
  const oB = w.addOrder(P_B, "paid"); w.addEarning(oB, P_B, { gross: 99999 });
  const reader = createSellerReader(w.client(w.viewerOf(USER_A)), w.client("service"));
  const e = await SO.getSellerEarnings(reader, { profileId: P_A, page: 1 });
  check("earnings: totals sum the stored records - gross 17100, commission 1105.5, net 15994.5 (each record keeps ITS OWN rate)", e.totals.gross === 17100 && e.totals.commission === 1105.5 && e.totals.net === 15994.5 && e.totals.count === 3, JSON.stringify(e.totals));
  check("earnings: gross - commission = net for the totals", Math.round((e.totals.gross - e.totals.commission) * 100) === Math.round(e.totals.net * 100));
  check("earnings: the reversed record is excluded from every total and counted separately", e.totals.reversedCount === 1 && e.totals.gross !== 17100 + 20000);
  check("earnings: another currency and another seller's records are not mixed in", e.totals.gross === 17100 && e.total === 5);
  check("earnings: records listed newest first with reference, rate and reversed flag", e.items.length === 5 && e.items.every((r) => /^PO-\d{6}$/.test(r.reference)) && e.items.some((r) => r.reversed) && e.items.every((r, i, a) => i === 0 || a[i - 1].createdAt >= r.createdAt));
  check("earnings: per-record rate is the snapshot (5%, 10%, 5.5%)", [5, 10, 5.5].every((p) => e.items.some((r) => r.commissionRatePct === p)));
  check("earnings: floating-point safe (0.1 + 0.2 style sums are exact)", SO.summariseEarnings([{ gross_amount: 0.1, platform_fee: 0.01, net_amount: 0.09, status: "recorded", currency: "XAF" }, { gross_amount: 0.2, platform_fee: 0.02, net_amount: 0.18, status: "recorded", currency: "XAF" }]).gross === 0.3);
  check("earnings: empty set → zero totals", SO.summariseEarnings([]).gross === 0 && SO.summariseEarnings([]).count === 0);
  check("earnings: numeric strings from the database are handled", SO.summariseEarnings([{ gross_amount: "1000.00", platform_fee: "50.00", net_amount: "950.00", status: "recorded", currency: "XAF" }]).net === 950);
  // pagination + more than one request chunk
  const w2 = makeWorld(); for (let i = 0; i < 45; i++) { const o = w2.addOrder(P_A, "paid"); w2.addEarning(o, P_A, { gross: 1000, rate: 0.05 }); }
  const r2 = createSellerReader(w2.client(w2.viewerOf(USER_A)), w2.client("service"));
  const p3 = await SO.getSellerEarnings(r2, { profileId: P_A, page: 3 });
  check("earnings: pagination (45 records, 20 per page → page 3 has 5) while totals cover ALL records", p3.items.length === 5 && p3.pageCount === 3 && p3.total === 45 && p3.totals.gross === 45000 && p3.totals.commission === 2250);
  const w3 = makeWorld(); for (let i = 0; i < 2300; i++) { const o = w3.addOrder(P_A, "paid"); w3.addEarning(o, P_A, { gross: 100, rate: 0.05, fee: 5, net: 95 }); }
  const t3 = await SO.getSellerEarnings(createSellerReader(w3.client(w3.viewerOf(USER_A)), w3.client("service")), { profileId: P_A, page: 1 });
  check("earnings: totals stay exact beyond the 1000-rows-per-request limit (2300 records)", t3.totals.count === 2300 && t3.totals.gross === 230000 && t3.totals.net === 218500, JSON.stringify(t3.totals));
  const anon = await SO.getSellerEarnings(createSellerReader(w.client(null), w.client("service")), { profileId: P_A, page: 1 });
  check("earnings: anonymous / cross-seller reads return nothing", anon.totals.count === 0 && anon.items.length === 0);
  const src = strip(read("src/lib/productCheckout/sellerOrders.ts"));
  check("earnings never recompute: no commission rate, computeEarnings or product price is used in the read model", !/computeEarnings|\bcommissionRate\b|settings\.|getSettings|\.price\b/.test(src));
}

// ================================================================ 5. fulfillment
function fulfilStore(w, viewer, profileId) { return createFulfillStore(w.client(viewer), w.client("service"), profileId); }
{
  const w = makeWorld();
  const ids = {}; for (const s of ALL) ids[s] = w.addOrder(P_A, s);
  const other = w.addOrder(P_B, "paid");
  const fulfilAs = (id, viewer = w.viewerOf(USER_A), profile = P_A) => fulfillOrder(fulfilStore(w, viewer, profile), id);
  let r = await fulfilAs(ids.paid);
  check("fulfil: paid -> fulfilled succeeds", r.ok && r.data.status === "fulfilled" && r.data.already === false && w.db.product_orders.find((o) => o.id === ids.paid).status === "fulfilled");
  r = await fulfilAs(ids.paid);
  check("fulfil: repeating it is idempotent (ok, already:true, nothing changes)", r.ok && r.data.already === true);
  r = await fulfilAs(ids.fulfilled);
  check("fulfil: an already-fulfilled order is ok / already:true", r.ok && r.data.already === true);
  for (const s of ["awaiting_payment", "expired", "cancelled", "payment_review", "refunded"]) {
    const before = w.db.product_orders.find((o) => o.id === ids[s]).status;
    r = await fulfilAs(ids[s]);
    check(`fulfil: ${s} -> refused with order_not_fulfillable and left untouched`, !r.ok && r.code === "order_not_fulfillable" && w.db.product_orders.find((o) => o.id === ids[s]).status === before);
  }
  r = await fulfilAs(other);
  check("fulfil: another seller's order → order_not_found, unchanged", !r.ok && r.code === "order_not_found" && w.db.product_orders.find((o) => o.id === other).status === "paid");
  r = await fulfilAs(other, w.viewerOf(USER_ADMIN, true), P_ADMIN);
  check("fulfil: even an admin's session cannot fulfil another seller's order", !r.ok && r.code === "order_not_found" && w.db.product_orders.find((o) => o.id === other).status === "paid");
  r = await fulfilAs(U(31337));
  check("fulfil: unknown id → order_not_found", !r.ok && r.code === "order_not_found");
  for (const bad of ["zzz", "", "1' or '1'='1", null, undefined]) { r = await fulfillOrder(fulfilStore(w, w.viewerOf(USER_A), P_A), bad); if (r.ok || r.code !== "order_not_found") check("fulfil: malformed id rejected", false, String(bad)); }
  check("fulfil: malformed ids → order_not_found", true);
  r = await fulfillOrder(fulfilStore(w, null, P_A), other);
  check("fulfil: an anonymous client finds nothing", !r.ok && r.code === "order_not_found");

  // double click / concurrency
  const w2 = makeWorld(); const oid = w2.addOrder(P_A, "paid"); let claims = 0;
  const base = fulfilStore(w2, w2.viewerOf(USER_A), P_A); const store = { ...base, async claimFulfilled(id) { const ch = await base.claimFulfilled(id); if (ch) claims++; return ch; } };
  const rs = await Promise.all([1, 2, 3, 4, 5].map(() => fulfillOrder(store, oid)));
  check("fulfil: 5 simultaneous clicks → all succeed, exactly ONE actually changed the order", rs.every((x) => x.ok) && claims === 1 && rs.filter((x) => x.data.already === false).length === 1 && w2.db.product_orders[0].status === "fulfilled", `claims=${claims}`);
  // lost race: claim returns false and the order moved on
  const lost = { getOwnedOrder: (() => { let n = 0; return async () => (++n === 1 ? { id: oid, status: "paid" } : { id: oid, status: "refunded" }); })(), claimFulfilled: async () => false };
  r = await fulfillOrder(lost, oid);
  check("fulfil: a lost race where the order became refunded → order_not_fulfillable (never a false success)", !r.ok && r.code === "order_not_fulfillable");
  const lost2 = { getOwnedOrder: (() => { let n = 0; return async () => (++n === 1 ? { id: oid, status: "paid" } : { id: oid, status: "fulfilled" }); })(), claimFulfilled: async () => false };
  r = await fulfillOrder(lost2, oid);
  check("fulfil: a lost race where someone else fulfilled it → ok, already:true", r.ok && r.data.already === true);
  // the database trigger stays the final authority
  const guard = { getOwnedOrder: async () => ({ id: oid, status: "paid" }), claimFulfilled: async () => { throw new Error("product_orders update failed: product_orders: illegal status transition refunded -> fulfilled"); } };
  r = await fulfillOrder(guard, oid);
  check("fulfil: a trigger refusal becomes order_not_fulfillable (no crash, no leak)", !r.ok && r.code === "order_not_fulfillable");
  let threw = false; try { await fulfillOrder({ getOwnedOrder: async () => ({ id: oid, status: "paid" }), claimFulfilled: async () => { throw new Error("connection reset"); } }, oid); } catch { threw = true; }
  check("fulfil: an unexpected error is not swallowed (the route turns it into internal_error)", threw);
  // the real store's write is conditional on 'paid' and on the seller's profile, and cannot bypass the trigger
  const w3 = makeWorld(); const rid = w3.addOrder(P_A, "refunded");
  const rs3 = fulfilStore(w3, w3.viewerOf(USER_A), P_A);
  const changed = await rs3.claimFulfilled(rid);
  check("store: claimFulfilled only updates rows still 'paid' (a refunded order stays refunded)", changed === false && w3.db.product_orders[0].status === "refunded");
  const upd = w3.db.requests.filter((r) => r.q.patch);
  check("store: the write is the service role, filtered by id + profile + status='paid'", upd.length === 1 && upd[0].viewer === "service" && upd[0].q.filters.length === 3);
  const rlsWrite = await w3.client(w3.viewerOf(USER_A)).from("product_orders").update({ status: "fulfilled" }).eq("id", rid);
  check("emulation sanity: a seller's own client has no UPDATE grant (fulfilment can only go through the route)", rlsWrite.error?.code === "42501");
  const trg = read("supabase/migrations/2026-11-02_product_checkout_foundation.sql");
  const guardBody = trg.slice(trg.indexOf("create or replace function product_orders_guard"), trg.indexOf("drop trigger if exists product_orders_guard_trg"));
  const toFulfilled = [...guardBody.matchAll(/old\.status = '(\w+)'\s*and new\.status (?:in \(([^)]*)\)|= '(\w+)')/g)].filter((m) => (m[2] || m[3] || "").includes("'fulfilled'") || m[3] === "fulfilled").map((m) => m[1]);
  check("parity: in the database guard, 'paid' is the ONLY status that may move to 'fulfilled'", toFulfilled.join() === "paid", toFulfilled.join());
}

// ================================================================ 6. the fulfil ROUTE (real handler, stubbed wiring)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shop-routes-"));
  const write = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };
  const supa = write("supa.stub.ts", `export function createClient() { return (globalThis as any).__T.rls(); } export function createAdminClient() { return (globalThis as any).__T.admin(); }`);
  const sessPath = write("session.stub.ts", `export function isSameOrigin(request: Request) { const o = request.headers.get("origin"); if (!o) return false; const h = request.headers.get("x-forwarded-host") || request.headers.get("host"); try { return new URL(o).host === h; } catch { return false; } }`);
  const jitiR = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": supa, "@/lib/customer/session": sessPath, "@": SRC }, interopDefault: true, cache: false, requireCache: false });
  const route = jitiR(path.join(SRC, "app/api/dashboard/product-orders/[id]/fulfill/route.ts"));

  const w = makeWorld();
  const paid = w.addOrder(P_A, "paid"), otherPaid = w.addOrder(P_B, "paid"), paid2 = w.addOrder(P_A, "paid");
  const bad = {}; for (const s of ["awaiting_payment", "expired", "cancelled", "payment_review", "refunded"]) bad[s] = w.addOrder(P_A, s);
  let viewer = w.viewerOf(USER_A);
  globalThis.__T = { rls: () => w.client(viewer), admin: () => w.client("service") };
  const call = (id, { origin = "http://localhost:3000", body } = {}) => route.POST(new Request(`http://localhost:3000/api/dashboard/product-orders/${id}/fulfill`, { method: "POST", headers: { host: "localhost:3000", ...(origin ? { origin } : {}), "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: { id } });
  const j = async (res) => { const t = await res.text(); let b = null; try { b = JSON.parse(t); } catch {} return [res.status, b, t]; };
  const quiet = console.error, warn = console.warn; console.error = () => {}; console.warn = () => {};

  viewer = null; let [st, b] = await j(await call(paid));
  check("route: anonymous → 401 not_authenticated, nothing changed", st === 401 && b.error === "not_authenticated" && w.db.product_orders.find((o) => o.id === paid).status === "paid");
  viewer = w.viewerOf(USER_A);
  [st, b] = await j(await call(paid, { origin: null }));
  check("route: no Origin header → 403 forbidden (CSRF), nothing changed", st === 403 && b.error === "forbidden" && w.db.product_orders.find((o) => o.id === paid).status === "paid");
  [st, b] = await j(await call(paid, { origin: "https://evil.example" }));
  check("route: a cross-site Origin → 403 forbidden", st === 403 && b.error === "forbidden");
  [st, b] = await j(await call(paid, { body: { status: "refunded", profile_id: P_B } }));
  check("route: owner + paid → 200 fulfilled (the request body is ignored)", st === 200 && b.status === "fulfilled" && b.already === false && w.db.product_orders.find((o) => o.id === paid).status === "fulfilled");
  [st, b] = await j(await call(paid));
  check("route: repeat → 200 already:true (idempotent)", st === 200 && b.already === true);
  const dbl = await Promise.all([1, 2, 3].map(() => call(paid2).then(j)));
  check("route: three simultaneous requests → all 200, one change, final state fulfilled", dbl.every(([s]) => s === 200) && dbl.filter(([, x]) => x.already === false).length === 1 && w.db.product_orders.find((o) => o.id === paid2).status === "fulfilled");
  for (const [s, id] of Object.entries(bad)) {
    [st, b] = await j(await call(id));
    check(`route: ${s} → 409 order_not_fulfillable and unchanged`, st === 409 && b.error === "order_not_fulfillable" && w.db.product_orders.find((o) => o.id === id).status === s);
  }
  [st, b] = await j(await call(otherPaid));
  check("route: another seller's order → 404 order_not_found (same as missing), unchanged", st === 404 && b.error === "order_not_found" && w.db.product_orders.find((o) => o.id === otherPaid).status === "paid");
  viewer = w.viewerOf(USER_ADMIN, true);
  [st, b] = await j(await call(otherPaid));
  check("route: an admin session cannot fulfil another seller's order either → 404", st === 404 && w.db.product_orders.find((o) => o.id === otherPaid).status === "paid");
  viewer = w.viewerOf(USER_NOPROFILE);
  [st, b] = await j(await call(otherPaid));
  check("route: a signed-in user without a profile → 404, nothing changed", st === 404 && w.db.product_orders.find((o) => o.id === otherPaid).status === "paid");
  viewer = w.viewerOf(USER_A);
  [st, b] = await j(await call("not-a-uuid"));
  check("route: malformed id → 404 order_not_found", st === 404 && b.error === "order_not_found");
  w.db.fail = { table: "product_orders" };
  let [s5, b5, t5] = await j(await call(otherPaid));
  w.db.fail = null;
  check("route: an unexpected database error → generic 500 internal_error with no internal text", s5 === 500 && b5.error === "internal_error" && !/SECRET|postgres|pw@/i.test(t5), t5);
  // every stable code maps to its declared status and only codes are returned
  const all = []; for (const [code, status] of Object.entries(SELLER_HTTP_STATUS)) all.push(status);
  check("errors: every seller error code has a declared HTTP status (401/403/400/404/409/500) and is recognised", ["not_authenticated", "forbidden", "invalid_request", "order_not_found", "order_not_fulfillable", "internal_error"].every((c) => isSellerErrorCode(c)) && all.join() === "401,403,400,404,409,500" && !isSellerErrorCode("nope"));
  console.error = quiet; console.warn = warn; delete globalThis.__T;
  fs.rmSync(tmp, { recursive: true, force: true });

  const rsrc = strip(read("src/app/api/dashboard/product-orders/[id]/fulfill/route.ts"));
  check("route source: force-dynamic, auth before origin, same-origin check, never reads the body", /export const dynamic = "force-dynamic"/.test(rsrc) && /isSameOrigin\(request\)/.test(rsrc) && rsrc.indexOf("not_authenticated") < rsrc.indexOf("forbidden") && !/request\.json|request\.formData|request\.text/.test(rsrc));
  check("route source: returns codes only (no error.message in a response)", !/NextResponse\.json\([^)]*(message|\.stack)/.test(rsrc));
}

// ================================================================ 7. access + nav visibility (shopAuth)
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shop-auth-"));
  const write = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };
  const supa = write("supa.stub.ts", `export function createClient() { return (globalThis as any).__A.rls; } export function createAdminClient() { return (globalThis as any).__A.admin; }`);
  const nav = write("nav.stub.ts", `export function redirect(to: string) { const e: any = new Error("REDIRECT:" + to); e.redirectTo = to; throw e; }`);
  const jitiA = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": supa, "next/navigation": nav, "@": SRC }, interopDefault: true, cache: false, requireCache: false });
  const A = jitiA(path.join(SRC, "lib/shopAuth.ts"));
  const mkClient = ({ user, profile, orders = 0, settings = { commerce_enabled: false }, boom = false }) => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from(t) {
      const b = { select() { return b; }, eq() { return b; }, limit() { return b; },
        single: async () => ({ data: profile }), maybeSingle: async () => ({ data: t === "platform_settings" ? settings : profile }),
        then(res, rej) { if (boom) return Promise.reject(new Error("db down")).then(res, rej); return Promise.resolve({ count: orders, data: null }).then(res, rej); } };
      return b;
    },
  });
  const set = (o) => { globalThis.__A = { rls: mkClient(o), admin: mkClient(o) }; };
  const shop = { id: P_A, user_id: USER_A, category: "business_ecommerce", categories: [] };
  const music = { id: P_A, user_id: USER_A, category: "music_entertainment", categories: ["music_entertainment"] };
  const visible = (o) => { set(o); return A.shopIsVisibleFor(globalThis.__A.rls, o.profile); };
  check("nav: hidden while platform commerce is OFF and the profile has no orders", (await visible({ profile: shop })) === false);
  check("nav: shown when platform commerce is ON", (await visible({ profile: shop, settings: { commerce_enabled: true } })) === true);
  check("nav: still shown when commerce is OFF but historical orders exist", (await visible({ profile: shop, orders: 3 })) === true);
  check("nav: never shown for a music profile (even with commerce on)", (await visible({ profile: music, settings: { commerce_enabled: true }, orders: 5 })) === false);
  check("nav: no profile → hidden", (await visible({ profile: null })) === false);
  check("nav: a database failure hides the entry instead of breaking the dashboard", (await visible({ profile: shop, boom: true })) === false);
  const go = async (o) => { set(o); try { const r = await A.requireShopProfile(); return { ok: true, r }; } catch (e) { return { ok: false, to: e.redirectTo || e.message }; } };
  let r = await go({ user: null, profile: shop });
  check("guard: not signed in → redirect to login", !r.ok && r.to === "/auth/login");
  r = await go({ user: { id: USER_A }, profile: null });
  check("guard: signed in but no profile → login with profile_missing", !r.ok && /profile_missing/.test(r.to));
  r = await go({ user: { id: USER_A }, profile: music, settings: { commerce_enabled: true } });
  check("guard: a music profile is sent back to the dashboard", !r.ok && r.to === "/dashboard");
  r = await go({ user: { id: USER_A }, profile: shop });
  check("guard: commerce off and no orders → back to the dashboard (the section does not exist yet)", !r.ok && r.to === "/dashboard");
  r = await go({ user: { id: USER_A }, profile: shop, settings: { commerce_enabled: true } });
  check("guard: eligible owner gets their own profile", r.ok && r.r.profile.id === P_A);
  r = await go({ user: { id: USER_A }, profile: shop, orders: 2 });
  check("guard: historical orders keep the section reachable when commerce is off", r.ok);
  delete globalThis.__A; fs.rmSync(tmp, { recursive: true, force: true });
  const asrc = strip(read("src/lib/shopAuth.ts"));
  check("guard source: owner only - resolves the caller's OWN profile, no organization / staff / team imports", /eq\("user_id", user\.id\)/.test(asrc) && !/team\/|organization|OrgAccess|staff/i.test(asrc));
}

// ================================================================ 8. what the seller sees (server-rendered views, EN + FR)
{
  const { transform } = require("sucrase");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  let LOCALE = "fr";
  const cache = new Map();
  const resolveSrc = (id) => { const base = path.join(SRC, id.slice(2)); for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext; throw new Error("cannot resolve " + id); };
  const stubs = {
    "@/components/LanguageProvider": { useLanguage: () => ({ locale: LOCALE, t: translations[LOCALE], setLocale() {} }), LanguageProvider: ({ children }) => children },
    "next/navigation": { usePathname: () => "/dashboard/shop", useRouter: () => ({ refresh() {}, push() {} }) },
  };
  function load(file) {
    if (!file.endsWith(".tsx")) return jiti(file);
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = transform(fs.readFileSync(file, "utf8"), { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", production: true }).code;
    const req = (id) => (stubs[id] ? stubs[id] : id.startsWith("@/") ? load(resolveSrc(id)) : require(id));
    new Function("require", "module", "exports", code)(req, mod, mod.exports);
    return mod.exports;
  }
  const V = (n) => load(path.join(SRC, "components/shop", n)).default;
  const html = (Comp, props, lang) => { LOCALE = lang; return renderToStaticMarkup(React.createElement(Comp, props)).replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"'); };

  const w = makeWorld();
  const oPaid = w.addOrder(P_A, "paid", { customer_name: "Amina Bello", customer_phone: "677123456" }); w.addEarning(oPaid, P_A); w.addPayment(oPaid, P_A, { tx: "TX-SECRET-9", external_id: "pp-abcdef12-3456-4789-8abc-def012345678" });
  const oFul = w.addOrder(P_A, "fulfilled"), oRev = w.addOrder(P_A, "payment_review"), oAwait = w.addOrder(P_A, "awaiting_payment"), oExp = w.addOrder(P_A, "expired"), oRef = w.addOrder(P_A, "refunded");
  const reader = createSellerReader(w.client(w.viewerOf(USER_A)), w.client("service"));
  const list = await SO.listSellerOrders(reader, { profileId: P_A, group: "sales", page: 1 });
  const detail = async (id) => SO.getSellerOrderDetail(reader, { profileId: P_A, orderId: id });

  // list
  const Orders = V("ShopOrdersView.tsx");
  let h = html(Orders, { data: list }, "en");
  check("list EN: title, tabs, chips, reference, product, quantity, amount, customer, link to detail", h.includes("Shop orders") && h.includes("Sales") && h.includes("To fulfill") && h.includes("Unpaid") && /PO-\d{6}/.test(h) && h.includes("Blue Widget") && h.includes("Qty 2") && /12,000|12 000|XAF/.test(h) && h.includes("Amina Bello") && h.includes("677123456") && h.includes(`/dashboard/shop/${oPaid}`));
  h = html(Orders, { data: list }, "fr");
  check("list FR: French title, tabs and statuses, no English UI text", h.includes("Commandes boutique") && h.includes("Ventes") && h.includes("À traiter") && h.includes("Non payées") && h.includes("Payée") && h.includes("Qté 2") && !/Shop orders|Awaiting payment|Qty /.test(h));
  check("list: filter links point at the right groups, active one is marked", h.includes('href="/dashboard/shop?group=to_fulfill"') && h.includes('href="/dashboard/shop?group=unpaid"') && h.includes('aria-selected="true"'));
  check("list: the to-fulfill badge shows the count", new RegExp(`>${list.toFulfillCount}<`).test(h));
  check("list: payment_review / refunded are shown as such, not as paid", /En vérification/.test(h) && /Remboursée/.test(h));
  const bigW = makeWorld(); for (let i = 0; i < 45; i++) bigW.addOrder(P_A, "paid");
  const many = await SO.listSellerOrders(createSellerReader(bigW.client(bigW.viewerOf(USER_A)), bigW.client("service")), { profileId: P_A, group: "sales", page: 2 });
  h = html(Orders, { data: many }, "en");
  check("list: pagination shows Previous / Next and 'Page 2 of 3' with correct links", h.includes("Page 2 of 3") && h.includes("Previous") && h.includes("Next") && h.includes('href="/dashboard/shop"') && h.includes('href="/dashboard/shop?page=3"') && h.includes("45 orders"));
  for (const g of ["sales", "to_fulfill", "unpaid"]) {
    const emptyPage = { group: g, items: [], page: 1, pageSize: 20, pageCount: 1, total: 0, toFulfillCount: 0 };
    check(`list: empty ${g} state renders in EN and FR`, /No sales yet|Nothing to fulfill|No unpaid orders/.test(html(Orders, { data: emptyPage }, "en")) && /Aucune vente|Rien à traiter|Aucune commande non payée/.test(html(Orders, { data: emptyPage }, "fr")));
  }
  check("list: no ledger / provider / secret data anywhere in the markup", !/TX-SECRET|provider|external|service_role|apikey|payment_id/i.test(h) && !/buyer@example|Call first/.test(h));

  // detail
  const Detail = V("ShopOrderDetail.tsx");
  let d = await detail(oPaid);
  h = html(Detail, { order: d }, "en");
  check("detail EN (paid): items with price snapshot, amounts (gross, commission with rate, earnings), payment method + reference", h.includes("Blue Widget") && /6,000|6 000/.test(h) && h.includes("Gross amount") && h.includes("Ringo commission (5%)") && h.includes("Your earnings") && /11,400|11 400/.test(h) && /600/.test(h) && h.includes("MTN MoMo") && h.includes("PAY-ABCDEF12"));
  check("detail EN (paid): customer contact, call + WhatsApp links, timeline, and the Mark-as-fulfilled action", h.includes("Amina Bello") && h.includes("buyer@example.com") && h.includes("Call first") && h.includes('href="tel:+237677123456"') && h.includes("https://wa.me/237677123456") && h.includes("Placed") && h.includes("Paid") && h.includes("Mark as fulfilled"));
  check("detail: no provider transaction id, ledger id or secrets in the markup", !/TX-SECRET|pp-abcdef|provider|service_role|creator_user_id/i.test(h));
  h = html(Detail, { order: d }, "fr");
  check("detail FR (paid): French labels, no English UI text", h.includes("Marquer comme traitée") && h.includes("Commission Ringo (5 %)") && h.includes("Vos gains") && h.includes("Montant brut") && h.includes("Chronologie") && h.includes("Appeler") && !/Mark as fulfilled|Your earnings|Gross amount|Timeline/.test(h));
  d = await detail(oFul); h = html(Detail, { order: d }, "en");
  check("detail (fulfilled): shows Fulfilled and NO fulfil button", h.includes("Fulfilled") && !h.includes("Mark as fulfilled") && !h.includes("fulfil-title"));
  d = await detail(oRev); h = html(Detail, { order: d }, "en");
  check("detail (payment_review): explains it is being verified, no fulfil button", h.includes("We are verifying this payment") && !h.includes("Mark as fulfilled"));
  d = await detail(oAwait); h = html(Detail, { order: d }, "fr");
  check("detail (awaiting): 'pas encore payé', no fulfil button, no earnings block claiming money", h.includes("n'a pas encore payé") && !h.includes("Marquer comme traitée") && h.includes("Aucun gain n'est enregistré"));
  d = await detail(oExp); h = html(Detail, { order: d }, "en");
  check("detail (expired): 'not paid', no fulfil button", h.includes("was not paid") && !h.includes("Mark as fulfilled"));
  d = await detail(oRef); h = html(Detail, { order: d }, "en");
  check("detail (refunded): shown as refunded, no fulfil button", h.includes("was refunded") && !h.includes("Mark as fulfilled"));

  // earnings
  const Earn = V("ShopEarningsView.tsx");
  const w2 = makeWorld(); const e1 = w2.addOrder(P_A, "paid"), e2 = w2.addOrder(P_A, "paid"), e3 = w2.addOrder(P_A, "refunded");
  w2.addEarning(e1, P_A, { gross: 12000, rate: 0.05 }); w2.addEarning(e2, P_A, { gross: 5000, rate: 0.1 }); w2.addEarning(e3, P_A, { gross: 20000, status: "reversed" });
  const ed = await SO.getSellerEarnings(createSellerReader(w2.client(w2.viewerOf(USER_A)), w2.client("service")), { profileId: P_A, page: 1 });
  h = html(Earn, { data: ed }, "en");
  check("earnings EN: Gross sales / Ringo commission / Your earnings totals, records with rates, reversed flagged", h.includes("Gross sales") && h.includes("Ringo commission") && h.includes("Your earnings") && /17,000|17 000/.test(h) && /1,100|1 100/.test(h) && /15,900|15 900/.test(h) && h.includes("5% commission") && h.includes("10% commission") && h.includes("Reversed") && h.includes("2 paid orders") && h.includes("1 reversed record is not counted"));
  check("earnings EN: makes clear these are records and payouts are not available (no balance / withdraw UI)", h.includes("Payouts are not available yet") && !/withdraw|available balance|request payout/i.test(h));
  h = html(Earn, { data: ed }, "fr");
  check("earnings FR: French totals and labels, no English UI text", h.includes("Ventes brutes") && h.includes("Commission Ringo") && h.includes("Vos gains") && h.includes("Commission de 5 %") && h.includes("2 commandes payées") && h.includes("Annulé") && !/Gross sales|Your earnings|Payouts are not/.test(h));
  const emptyE = await SO.getSellerEarnings(createSellerReader(makeWorld().client(null), makeWorld().client("service")), { profileId: P_A, page: 1 });
  check("earnings: empty state in EN and FR", html(Earn, { data: emptyE }, "en").includes("No earnings yet") && html(Earn, { data: emptyE }, "fr").includes("Aucun gain pour l'instant"));

  // tabs
  const Tabs = V("ShopTabs.tsx");
  h = html(Tabs, {}, "en"); const hf = html(Tabs, {}, "fr");
  check("tabs: Orders | Earnings in both languages", h.includes("Orders") && h.includes("Earnings") && hf.includes("Commandes") && hf.includes("Gains") && h.includes("/dashboard/shop/earnings"));

  // i18n parity: same shape in en and fr, functions stay functions, and FR is really translated
  const shape = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "object" && v ? shape(v) : typeof v]));
  check("i18n: shopOrders has identical structure in EN and FR (every key, every function)", JSON.stringify(shape(translations.en.shopOrders)) === JSON.stringify(shape(translations.fr.shopOrders)));
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "object" && v ? flat(v, p + k + ".") : [[p + k, v]]));
  const sameText = flat(translations.en.shopOrders).filter(([k, v], i) => typeof v === "string" && v.length > 0 && v === flat(translations.fr.shopOrders)[i][1]).map(([k]) => k);
  check("i18n: French differs from English for every string except brand / loanword labels", sameText.every((k) => ["whatsapp", "methods.mobile money", "methods.orange money", "lineTotal"].includes(k)), sameText.join());
  check("i18n: every seller error code has a message in both languages, and nav.shop exists", Object.keys(SELLER_HTTP_STATUS).every((c) => translations.en.shopOrders.errors[c] && translations.fr.shopOrders.errors[c]) && !!translations.en.nav.shop && !!translations.fr.nav.shop);
  check("i18n: interpolating functions behave (plurals)", translations.en.shopOrders.totalOrders(1) === "1 order" && translations.fr.shopOrders.totalOrders(2) === "2 commandes" && translations.fr.shopOrders.moreItems(2) === "+2 autres");
}

// ================================================================ 9. wiring and isolation (source-level)
{
  const shell = read("src/components/dashboard/DashboardShell.tsx"); // raw: a comment there mentions "/dashboard/**", which a naive comment-stripper misreads
  check("shell: a Shop nav entry exists, is gated by hasShop and hidden for staff, and is labelled from translations", /hasShop && !organization\?\.isStaff/.test(shell) && /href: "\/dashboard\/shop"/.test(shell) && /t\.nav\.shop/.test(shell));
  check("shell: pull-to-refresh is enabled for the Shop pages (like Music)", /"\/dashboard\/shop",/.test(shell) && /"\/dashboard\/shop\/earnings",/.test(shell));
  const lay = read("src/app/dashboard/layout.tsx");
  check("dashboard layout: hasShop is computed for the viewer's OWN profile and never for staff, then passed to the shell", /!isActingAsStaff && ownProfile \? await shopIsVisibleFor\(supabase, ownProfile\) : false/.test(lay) && /hasShop=\{hasShop\}/.test(lay));
  const files = ["src/lib/productCheckout/sellerOrders.ts", "src/lib/productCheckout/fulfillOrder.ts", "src/lib/productCheckout/sellerErrors.ts", "src/lib/productCheckout/sellerReaders.ts", "src/lib/shopAuth.ts", "src/app/api/dashboard/product-orders/[id]/fulfill/route.ts", "src/app/dashboard/shop/layout.tsx", "src/app/dashboard/shop/page.tsx", "src/app/dashboard/shop/[id]/page.tsx", "src/app/dashboard/shop/earnings/page.tsx", ...fs.readdirSync(path.join(REPO, "src/components/shop")).map((f) => `src/components/shop/${f}`)];
  const srcs = files.map((f) => [f, strip(read(f))]);
  check("isolation: no Shop file imports Music / Restaurant / Booking / Ticketing / Billing / Fapshi / team modules", srcs.every(([, s]) => !/from "@\/(lib|components)\/(music|restaurant|bookings?|tickets?|ticketing|billing|fapshi|team|association|applyPayment|musicAuth|restaurantAuth|bookingAuth|ticketingAuth)/i.test(s)));
  check("isolation: nothing in Shop touches the payment provider, settlement, the commission rate or the checkout state machine", srcs.every(([, s]) => !/fapshi|settleProductPayment|computeEarnings|\bcommissionRate\b|checkProductPayment|initiateProductPayment|createProductOrder|reconcile|releaseOrder/i.test(s)));
  check("isolation: no payout / withdrawal / balance functionality", srcs.every(([, s]) => !/payout|withdraw|available_at|hold_days|balance/i.test(s)));
  check("core files stay dependency-free (no Supabase / Next / React imports)", ["sellerOrders.ts", "fulfillOrder.ts", "sellerErrors.ts", "sellerReaders.ts"].every((f) => !/from "(next|react|@\/lib\/supabase|@supabase)/.test(strip(read(`src/lib/productCheckout/${f}`)))));
  check("service role is used for exactly two things: the payment-ledger read and the paid->fulfilled write", (() => { const s = strip(read("src/lib/productCheckout/sellerReaders.ts")); return (s.match(/admin\s*\.from\(/g) || []).length === 2 && /admin\s*\.from\("customer_payments"\)/.test(s) && /admin\s*\.from\("product_orders"\)[\s\S]*\.update\(\{ status: "fulfilled" \}\)/.test(s); })());
  // Ringo Protection (Phase 5) added ONE new rls query (getProtectionSummaryForOrder, reading
  // protection_transactions under its own Phase 1 owner-read RLS policy), and Phase 7 added a
  // SECOND (reading protection_disputes under its own owner-read policy, added in
  // 2026-11-12_ringo_protection_disputes.sql) — both filter on profile_id, so the counts below have
  // moved up by two total since the pre-Protection baseline; the safety property itself (every rls
  // query is profile-scoped) is unchanged.
  check("every rls query filters on the seller's profile id", (() => { const s = strip(read("src/lib/productCheckout/sellerReaders.ts")); return (s.match(/rls\s*\.from\(/g) || []).length === 9 && (s.match(/\.eq\("profile_id", profileId\)/g) || []).length === 10; })());
  check("the four commerce tables' schema is untouched by this increment (no migration added or changed for 5A)", fs.readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => f.startsWith("2026-11")).sort().join() === "2026-11-01_product_cta.sql,2026-11-02_product_checkout_foundation.sql,2026-11-03_commerce_abuse_protection.sql");
  const det = strip(read("src/components/shop/ShopOrderDetail.tsx"));
  check("UI: the fulfil action has a synchronous in-flight guard (rapid taps in one tick send ONE request), and touch targets are at least 44px", /useRef\(false\)/.test(det) && /if \(inFlight\.current\) return/.test(det) && /inFlight\.current = true/.test(det) && /finally \{\s*inFlight\.current = false/.test(det) && (det.match(/min-h-\[44px\]/g) || []).length >= 5);
  // Ringo Protection Phase 12 legitimately added its own auto-release cron entry (unrelated to Shop) —
  // still 3, never a duplicate or an unrelated Shop schedule change.
  const cfg = JSON.parse(read("vercel.json")); check("no Shop-relevant schedule or Vercel config was changed (Phase 12 legitimately added one unrelated Protection cron)", cfg.crons.length === 3);
}

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
