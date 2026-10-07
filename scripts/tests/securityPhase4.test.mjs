// Security Phase 4 (API / input audit): a Fapshi transaction must be THIS music order's own payment, for THIS amount, before a sale and its
// payable earnings row are created. No network, no Supabase, no Fapshi.
//   Run:  node scripts/tests/securityPhase4.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const { fapshiTxMatchesMusicOrder: ok, musicOrderExternalId } = jiti(path.join(SRC, "lib/musicOrderPaymentBinding.ts"));

let passed = 0;
const failures = [];
const test = (name, fn) => { try { fn(); passed++; } catch (e) { failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`); } };

const ORDER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const tx = (o = {}) => ({ externalId: `music-order-${ORDER}`, userId: ORDER, amount: 5000, ...o });

test("the pay route's own transaction for this order and amount is accepted", () => {
  assert.equal(ok(tx(), { id: ORDER, total: 5000 }), true);
  assert.equal(ok(tx(), { id: ORDER, total: "5000.00" }), true); // numeric columns arrive as strings
  assert.equal(ok(tx({ amount: 5000 }), { id: ORDER, total: 5000.4 }), true); // the pay route sends Math.round(total)
  assert.equal(musicOrderExternalId(ORDER), `music-order-${ORDER}`);
});
test("a real, successful transaction of ANOTHER order is refused (the artist stored someone else's / their own tiny payment on an invented order)", () => {
  assert.equal(ok(tx({ externalId: `music-order-${OTHER}`, userId: OTHER, amount: 100 }), { id: ORDER, total: 5000000 }), false);
  assert.equal(ok(tx({ externalId: `music-order-${OTHER}`, userId: OTHER, amount: 5000 }), { id: ORDER, total: 5000 }), false);
});
test("a transaction of another product line (signup, billing, shop, protection) is refused", () => {
  for (const externalId of [`signup-${ORDER}-abc`, `product-order-${ORDER}`, `protection-${ORDER}`, ORDER, "", "music-order-", `music-order-${ORDER}x`]) {
    assert.equal(ok(tx({ externalId, userId: ORDER }), { id: ORDER, total: 5000 }), false, externalId);
  }
});
test("raising the total AFTER paying (the artist can edit their own order) is refused", () => {
  assert.equal(ok(tx({ amount: 100 }), { id: ORDER, total: 5000000 }), false);
  assert.equal(ok(tx({ amount: 5000 }), { id: ORDER, total: 5001 }), false);
});
test("a missing / non-numeric amount, an empty order and a missing transaction are refused", () => {
  for (const amount of [undefined, null, NaN, "5000", Infinity]) assert.equal(ok(tx({ amount }), { id: ORDER, total: 5000 }), false, String(amount));
  for (const total of [0, -5, null, undefined, "abc", NaN]) assert.equal(ok(tx(), { id: ORDER, total }), false, String(total));
  assert.equal(ok(null, { id: ORDER, total: 5000 }), false);
  assert.equal(ok(undefined, { id: ORDER, total: 5000 }), false);
  assert.equal(ok(tx(), { id: "", total: 5000 }), false);
});
test("userId alone binds only when the provider sent no externalId at all; a contradicting externalId never does", () => {
  assert.equal(ok({ externalId: null, userId: ORDER, amount: 5000 }, { id: ORDER, total: 5000 }), true);
  assert.equal(ok({ externalId: `music-order-${OTHER}`, userId: ORDER, amount: 5000 }, { id: ORDER, total: 5000 }), false);
  assert.equal(ok({ externalId: null, userId: OTHER, amount: 5000 }, { id: ORDER, total: 5000 }), false);
  assert.equal(ok({ externalId: null, userId: null, amount: 5000 }, { id: ORDER, total: 5000 }), false);
});

const src = read("src/lib/musicOrderPayment.ts");
test("the confirmation checks the binding BEFORE it marks the order paid or creates the earnings row, and stops there", () => {
  const bind = src.indexOf("fapshiTxMatchesMusicOrder(tx, order)");
  assert.ok(bind > 0, "the binding is not called");
  assert.ok(bind < src.indexOf('.update({ payment_status: "paid"'), "must run before the order is marked paid");
  assert.ok(bind < src.indexOf('.from("music_sale_earnings")'), "must run before the earnings row is created");
  assert.match(src.slice(bind, bind + 400), /return "FAILED";/);
});
test("the pay route still stamps the transaction with the order's own id and amount (the values the binding checks)", () => {
  const pay = read("src/app/api/music/orders/[id]/pay/route.ts");
  assert.match(pay, /externalId: `music-order-\$\{params\.id\}`/);
  assert.match(pay, /userId: params\.id/);
  assert.match(pay, /amount: Math\.round\(Number\(order\.total\)\)/);
});
test("music_sale_earnings is still created in exactly one place", () => {
  const hits = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name) && /from\("music_sale_earnings"\)\s*\.insert/.test(fs.readFileSync(p, "utf8").replace(/\s+/g, " ").replace(/\s*\.\s*/g, "."))) hits.push(path.relative(REPO, p).replace(/\\/g, "/")); } };
  walk(SRC);
  assert.deepEqual(hits, ["src/lib/musicOrderPayment.ts"]);
});

console.log(`securityPhase4: ${passed} checks passed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
