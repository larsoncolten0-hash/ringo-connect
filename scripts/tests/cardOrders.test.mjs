// Paid card orders, APPLICATION layer (the WhatsApp customers who paid for a card through the sales bot): the "mark completed" logic with its authorization order, the customer's thank-you
// only after the change succeeded, the honest notification outcomes, the payment hook that files the order, the route / page / view wiring, the inbox link, the sales-bot website / profile
// lines, and the English / French dictionaries. Nothing here connects to Supabase, Meta or any network, reads .env.local, or touches a payment: the database and the sender are stand-ins
// (the real database rules are proven in cardOrdersSql.test.mjs, the bot side in whatsappSalesBot.test.mjs).
//   Run:  node scripts/tests/cardOrders.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const raw = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
console.info = () => {};
let passed = 0;
const failures = [];
const test = async (name, fn) => { try { await fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); } };

const Lib = jiti(path.join(SRC, "lib/salesBot/cardOrders.ts"));
const Notice = jiti(path.join(SRC, "lib/salesBot/paymentNotice.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const EN = translations.en.inbox.salesBot, FR = translations.fr.inbox.salesBot;

const ORDER = "a1111111-1111-4111-8111-111111111111";
const CONV = "c2222222-2222-4222-8222-222222222222";
const ACTOR = "d3333333-3333-4333-8333-333333333333";
const FORGED_CONV = "e4444444-4444-4444-8444-444444444444";

/** A scripted database + guard + sender, recording every call in order. */
function rig({ locate = { result: "ok", conversation_id: CONV, profile_id: "p" }, set = { result: "ok", status: "completed", from: "paid", conversation_id: CONV, profile_id: "p", lang: "en", customer_name: "Jean" }, guard = { ok: true, kind: "member", userId: ACTOR, profileId: "p", admin: { rpc: async () => ({ data: null, error: null }) } }, send = async () => ({ status: 200, body: { ok: true, state: "sent", message_id: "m" } }), rpcError = {}, notify = "ok" } = {}) {
  const calls = [];
  const admin = {
    rpc: async (fn, args) => {
      calls.push({ kind: "rpc", fn, args });
      if (rpcError[fn] === "throw") throw new Error("db down SECRET");
      if (rpcError[fn]) return { data: null, error: { code: String(rpcError[fn]) } };
      if (fn === "card_order_locate") return { data: locate, error: null };
      if (fn === "card_order_set_status") return { data: set, error: null };
      if (fn === "card_order_record_notify") return { data: notify, error: null };
      return { data: null, error: { code: "unknown" } };
    },
  };
  const deps = {
    admin,
    guard: async (conversationId, permission) => { calls.push({ kind: "guard", conversationId, permission }); return guard; },
    send: async (d, input) => { calls.push({ kind: "send", d, input }); return send(d, input); },
  };
  return { deps, calls, names: () => calls.map((c) => (c.kind === "rpc" ? c.fn : c.kind)) };
}
const go = (r, input) => Lib.changeCardOrderStatus(r.deps, input);

// ============================================================ input validation happens before anything is read
await test("invalid input is refused before ANY database, guard or sender call", async () => {
  for (const [input, status] of [
    [{ orderId: "not-a-uuid", to: "completed" }, 404], [{ orderId: null, to: "completed" }, 404], [{ orderId: ORDER, to: "paid" }, 422], [{ orderId: ORDER, to: "cancelled" }, 422],
    [{ orderId: ORDER, to: undefined }, 422], [{ orderId: ORDER, to: 5 }, 422], [{ orderId: ORDER, to: "completed", details: 7 }, 422], [{ orderId: ORDER, to: "completed", details: "x".repeat(301) }, 422],
  ]) { const r = rig(); const res = await go(r, input); assert.strictEqual(res.status, status, JSON.stringify(input)); assert.strictEqual(res.body.ok, false); assert.deepStrictEqual(r.names(), []); }
});

// ============================================================ the order: locate -> guard (that conversation) -> change -> only then the customer
await test("an unknown order is 404 and the guard is never asked (nothing about it is revealed)", async () => {
  const r = rig({ locate: { result: "not_found" } });
  const res = await go(r, { orderId: ORDER, to: "completed" });
  assert.strictEqual(res.status, 404); assert.deepStrictEqual(r.names(), ["card_order_locate"]);
});
await test("the guard is asked about the conversation the DATABASE says the order belongs to, with inbox.reply, never about anything the browser sent", async () => {
  const r = rig();
  await go(r, { orderId: ORDER, to: "completed", conversation_id: FORGED_CONV, profile_id: "other", userId: "mallory" });
  const g = r.calls.find((c) => c.kind === "guard");
  assert.strictEqual(g.conversationId, CONV); assert.strictEqual(g.permission, "inbox.reply");
  const s = r.calls.find((c) => c.fn === "card_order_set_status");
  assert.strictEqual(s.args.p_actor_user_id, ACTOR); assert.strictEqual(s.args.p_order_id, ORDER);
  assert.ok(!JSON.stringify(r.calls).includes("mallory") && !JSON.stringify(r.calls).includes(FORGED_CONV));
});
await test("a guard refusal stops everything: 403 forbidden for a member without the permission, 404 for anyone else, 500 only for a server problem; nothing is changed and nobody is thanked", async () => {
  for (const [guard, status, error] of [
    [{ ok: false, status: 403, error: "forbidden" }, 403, "forbidden"], [{ ok: false, status: 401, error: "not_found" }, 404, "not_found"],
    [{ ok: false, status: 403, error: "not_found" }, 404, "not_found"], [{ ok: false, status: 404, error: "not_found" }, 404, "not_found"], [{ ok: false, status: 503, error: "server_error" }, 500, "server_error"],
  ]) { const r = rig({ guard }); const res = await go(r, { orderId: ORDER, to: "completed" }); assert.strictEqual(res.status, status); assert.strictEqual(res.body.error, error); assert.deepStrictEqual(r.names(), ["card_order_locate", "guard"]); }
});
await test("the database has the last word: a refusal there (forbidden, not found, invalid transition, invalid) changes nothing and thanks nobody", async () => {
  for (const [set, status, error] of [[{ result: "forbidden" }, 403, "forbidden"], [{ result: "not_found" }, 404, "not_found"], [{ result: "invalid_transition", status: "completed" }, 409, "invalid_transition"], [{ result: "invalid" }, 422, "invalid"], [{ result: "weird" }, 404, "not_found"]]) {
    const r = rig({ set }); const res = await go(r, { orderId: ORDER, to: "completed" });
    assert.strictEqual(res.status, status); assert.strictEqual(res.body.error, error); assert.ok(!r.names().includes("send")); assert.ok(!r.names().includes("card_order_record_notify"));
  }
});
await test("an unavailable database is a 500, never a half-done change: no thank-you, no claim of success", async () => {
  for (const fn of ["card_order_locate", "card_order_set_status"]) { for (const mode of ["throw", "XX000"]) { const r = rig({ rpcError: { [fn]: mode } }); const res = await go(r, { orderId: ORDER, to: "completed" }); assert.strictEqual(res.status, 500, fn + mode); assert.strictEqual(res.body.ok, false); assert.ok(!r.names().includes("send")); assert.ok(!JSON.stringify(res).includes("SECRET")); } }
});
await test("asking for 'completed' on an order that is already completed is a no-op: 200, the customer is NOT thanked a second time", async () => {
  const r = rig({ set: { result: "noop", status: "completed", conversation_id: CONV, profile_id: "p", lang: "en" } });
  const res = await go(r, { orderId: ORDER, to: "completed" });
  assert.strictEqual(res.status, 200); assert.deepStrictEqual(res.body, { ok: true, state: "completed", notified: "none", unchanged: true }); assert.ok(!r.names().includes("send")); assert.ok(!r.names().includes("card_order_record_notify"), "the stored notification outcome is not touched");
});

// ============================================================ the customer is thanked only after success, in their language, and the outcome is real
await test("after a successful change the customer is sent ONE thank-you through the Inbox sender as the real actor, to the located conversation, with a stable request id", async () => {
  const r = rig();
  const res = await go(r, { orderId: ORDER, to: "completed", details: "  Delivered,\n Akwa  " });
  assert.deepStrictEqual(r.names(), ["card_order_locate", "guard", "card_order_set_status", "send", "card_order_record_notify"]);
  const send = r.calls.find((c) => c.kind === "send");
  assert.strictEqual(send.input.userId, ACTOR); assert.strictEqual(send.input.conversationId, CONV); assert.strictEqual(send.input.text, EN.orderThanks);
  assert.ok(typeof send.input.clientRequestId === "string" && /^[0-9a-f-]{36}$/.test(send.input.clientRequestId));
  assert.strictEqual(r.calls.find((c) => c.fn === "card_order_set_status").args.p_details, "Delivered, Akwa");
  assert.deepStrictEqual(res.body, { ok: true, state: "completed", notified: "sent" });
  const again = rig(); await go(again, { orderId: ORDER, to: "completed" });
  assert.strictEqual(again.calls.find((c) => c.kind === "send").input.clientRequestId, send.input.clientRequestId, "a retry uses the same request id, so the sender can never send it twice");
});
await test("the thank-you follows the customer's language (French customer, French text) and nothing else is added to it", async () => {
  const r = rig({ set: { result: "ok", status: "completed", from: "paid", conversation_id: CONV, profile_id: "p", lang: "fr", customer_name: "Jean" } });
  await go(r, { orderId: ORDER, to: "completed", details: "private note for the team" });
  const text = r.calls.find((c) => c.kind === "send").input.text;
  assert.strictEqual(text, FR.orderThanks); assert.ok(!text.includes("private note"));
});
await test("the thank-you thanks the customer for choosing Ringo Connect and invites them to contact the team for any support or assistance, in both languages", async () => {
  assert.ok(/Thank you for choosing Ringo Connect/.test(EN.orderThanks) && /support or assistance/.test(EN.orderThanks) && /feel free to contact us/.test(EN.orderThanks));
  assert.ok(/Merci d’avoir choisi Ringo Connect/.test(FR.orderThanks) && /aide ou d’assistance/.test(FR.orderThanks) && /n’hésitez pas à nous contacter/.test(FR.orderThanks));
  assert.ok(EN.orderThanks.includes("*0*") && FR.orderThanks.includes("*0*") && EN.orderThanks.length < 500 && FR.orderThanks.length < 500);
});
await test("the outcome is REAL: sent, window closed (the 24-hour window) and failed (including a thrown error) are told apart, recorded, and returned; the change itself still stands", async () => {
  const cases = [
    [async () => ({ status: 200, body: { ok: true, state: "sent", message_id: "m" } }), "sent"],
    [async () => ({ status: 409, body: { ok: false, error: "window_closed" } }), "window_closed"],
    [async () => ({ status: 502, body: { ok: false, error: "send_failed" } }), "failed"],
    [async () => { throw new Error("meta down SECRET"); }, "failed"],
  ];
  for (const [send, expected] of cases) {
    const r = rig({ send }); const res = await go(r, { orderId: ORDER, to: "completed" });
    assert.strictEqual(res.status, 200); assert.strictEqual(res.body.state, "completed"); assert.strictEqual(res.body.notified, expected);
    assert.strictEqual(r.calls.find((c) => c.fn === "card_order_record_notify").args.p_outcome, expected);
    assert.ok(!JSON.stringify(res).includes("SECRET"));
  }
});
await test("if recording the outcome fails the change still stands and the result still says what really happened", async () => {
  const r = rig({ rpcError: { card_order_record_notify: "throw" } });
  const res = await go(r, { orderId: ORDER, to: "completed" });
  assert.strictEqual(res.status, 200); assert.strictEqual(res.body.notified, "sent");
});

// ============================================================ the payment hook files the order
function hookAdmin({ session = { result: "ok", conversation_id: CONV, owner_user_id: ACTOR, lang: "en", tier: "pro", handoff: false }, row = { full_name: "Jean Mbah", delivery_location: "Akwa, Douala", pending_fapshi_trans_id: "TX1", requested_plan_id: null, requested_interval: null, requested_addon_ids: [] }, recordError = null } = {}) {
  const calls = [];
  const admin = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "wa_sales_payment_context") return { data: session, error: null };
      if (fn === "card_order_record_paid") { if (recordError === "throw") throw new Error("db down SECRET"); return recordError ? { data: null, error: { code: recordError } } : { data: { result: "created", id: ORDER, status: "paid" }, error: null }; }
      return { data: null, error: { code: "unknown" } };
    },
    from: (table) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "signup_requests" ? row : null, error: null }) }), in: async () => ({ data: [], error: null }), order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }),
  };
  return { admin, calls };
}
await test("the hook files a paid order with the name and the delivery place of the stored signup request, even when a person has taken the conversation over", async () => {
  for (const handoff of [false, true]) {
    const h = hookAdmin({ session: { result: "ok", conversation_id: CONV, owner_user_id: ACTOR, lang: "en", tier: "pro", handoff } });
    await Notice.notifyWhatsAppOrderPaid(h.admin, ORDER, { send: async () => ({ status: 200, body: { ok: true, state: "sent", message_id: "m" } }) });
    const rec = h.calls.filter((c) => c.fn === "card_order_record_paid");
    assert.strictEqual(rec.length, 1, "handoff " + handoff);
    assert.strictEqual(rec[0].args.p_signup_request_id, ORDER); assert.strictEqual(rec[0].args.p_name, "Jean Mbah"); assert.strictEqual(rec[0].args.p_place, "Akwa, Douala");
    assert.deepStrictEqual(Object.keys(rec[0].args).sort(), ["p_amount", "p_name", "p_place", "p_signup_request_id"], "nothing about the conversation or the organization is passed: the database derives it");
  }
});
await test("a signup request that did not come from the bot files nothing", async () => {
  const h = hookAdmin({ session: { result: "none" } });
  const res = await Notice.notifyWhatsAppOrderPaid(h.admin, ORDER);
  assert.strictEqual(res.result, "not_from_bot"); assert.ok(!h.calls.some((c) => c.fn === "card_order_record_paid"));
});
await test("a failure while filing the order (error code or exception) never breaks the hook: the rest of it carries on exactly as before and nothing leaks", async () => {
  for (const recordError of ["42883", "throw"]) {
    const h = hookAdmin({ recordError, session: { result: "ok", conversation_id: CONV, owner_user_id: ACTOR, lang: "en", tier: "pro", handoff: true } });
    const res = await Notice.notifyWhatsAppOrderPaid(h.admin, ORDER);
    assert.strictEqual(res.result, "skipped_handoff", recordError); assert.ok(!JSON.stringify(res).includes("SECRET"));
  }
});

// ============================================================ wiring and scope (static)
const route = raw("src/app/api/inbox/orders/[id]/status/route.ts");
await test("the route reads only status and details from the body, takes the id from the URL, requires JSON, and asks the same conversation guard as the appointments", () => {
  const c = strip(route);
  assert.ok(/application\/json/.test(c) && /params\.id/.test(c) && /body\.status/.test(c) && /body\.details/.test(c));
  assert.ok(/guardConversationAction\(conversationId, permission, "card_orders"\)/.test(c));
  assert.ok(!/body\.(conversation|profile|user|phone|id)/i.test(c));
  assert.ok(/NextResponse\.json\(body, \{ status, headers: \{ "Cache-Control": "no-store" \} \}\)/.test(c));
});
const page = raw("src/app/dashboard/inbox/orders/page.tsx");
await test("the page resolves the organization from the session (never the URL), reads through the user's own session under row-level security, and shows the button only with inbox.reply", () => {
  const c = strip(page);
  assert.ok(/resolveInboxActor\(\)/.test(c) && /actor\.supabase/.test(c) && /\.eq\("profile_id", actor\.profileId\)/.test(c));
  assert.ok(/actor\.kind === "owner" \|\| actor\.permissions\.includes\("inbox\.reply"\)/.test(c));
  assert.ok(!/searchParams|params\./.test(c));
});
await test("the view has two groups (paid, completed), the complete button only for those who may act and only on a paid order, and tells the truth about the thank-you", () => {
  const v = strip(raw("src/components/inbox/OrdersView.tsx"));
  assert.ok(/GROUPS: CardOrderStatus\[\] = \["paid", "completed"\]/.test(v));
  assert.ok(/canAct && row\.status === "paid"/.test(v));
  assert.ok(/u\.notified\[key\]/.test(v) && /u\.notified\[notifyKey\]/.test(v));
  assert.ok(/\/api\/inbox\/orders\//.test(v));
});
await test("the inbox has a link to the paid orders next to the appointments link", () => {
  const v = raw("src/components/inbox/InboxView.tsx");
  assert.ok(/\/orders`\} className=[^>]*>\{u\.ordersLink\}<\/Link>/.test(v) && v.indexOf("u.appointmentsLink") < v.indexOf("u.ordersLink"));
});
await test("the new code touches no payment, price, plan or subscription: it imports no payment module and writes no signup request", () => {
  const code = strip(raw("src/lib/salesBot/cardOrders.ts")) + strip(route) + strip(page) + strip(raw("src/components/inbox/OrdersView.tsx"));
  assert.ok(!/fapshi|stripe|customer_paid|signupPayment|payment_transactions|from\("signup_requests"\)/i.test(code));
  const hook = strip(raw("src/lib/salesBot/paymentNotice.ts"));
  assert.strictEqual((hook.match(/from\("signup_requests"\)/g) || []).length, 1, "the stored signup request is still read exactly once");
  assert.ok(!/\.(update|insert|delete|upsert)\(/.test(hook));
});
await test("the migration is proposed only: it is not referenced by any code path as applied, and the proposal says so", () => {
  const sql = raw("supabase/migrations/2026-12-25_card_orders.sql");
  assert.ok(/PROPOSED, NOT APPLIED/.test(sql.split("\n")[0]));
});

// ============================================================ website, official profile and the demo video (Discover Ringo, Know more)
const SITE = "www.ringoconnectltd.com", PROFILE = "www.ringoconnectltd.com/ringoconnectltd";
await test("Discover Ringo and every Know more answer carry the website and the official Ringo profile, in both languages, without removing any explanation", () => {
  for (const [L, name] of [[EN, "EN"], [FR, "FR"]]) {
    assert.ok(L.discover.includes(SITE) && L.discover.includes(PROFILE), name + " discover");
    assert.ok(L.faqOptions.includes(SITE) && L.faqOptions.includes(PROFILE), name + " faqOptions");
    assert.ok(L.faqMenu.includes(SITE) && L.faqMenu.includes(PROFILE), name + " faqMenu");
  }
  assert.ok(/NFC/.test(EN.discover) && /QR/.test(EN.discover) && /1\. Buy a card now/.test(EN.discover) && /3\. Main menu/.test(EN.discover));
  const VIDEO = "https://www.facebook.com/share/r/1KLGNrNpxs/?mibextid=wwXIfr";
  for (const [L, name] of [[EN, "EN"], [FR, "FR"]]) { assert.ok(L.discover.includes(VIDEO) && L.faqOptions.includes(VIDEO), name + " video"); assert.ok(!L.welcome.includes(VIDEO) && !L.mainMenu.includes(VIDEO), name + " video only where asked"); }
  assert.ok(EN.faqOptions.includes("*faq* to see the questions") && EN.faqOptions.includes("Type *human*") && FR.faqOptions.includes("Tapez *humain*"));
});

// ============================================================ the two dictionaries
await test("the paid-orders dictionaries exist in English and French with the same keys, and every text is non-empty", () => {
  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, p + k + ".") : [p + k]));
  const en = translations.en.inbox.cardOrders, fr = translations.fr.inbox.cardOrders;
  assert.deepStrictEqual(keys(en).sort(), keys(fr).sort());
  const flat = (o) => Object.values(o).flatMap((v) => (v && typeof v === "object" ? flat(v) : [v]));
  assert.ok(flat(en).every((s) => typeof s === "string" && s.length > 1) && flat(fr).every((s) => typeof s === "string" && s.length > 1));
  assert.ok(translations.en.inbox.ordersLink && translations.fr.inbox.ordersLink && translations.en.inbox.ordersLink !== translations.fr.inbox.ordersLink);
  assert.deepStrictEqual(Object.keys(en.groups), ["paid", "completed"]);
  assert.deepStrictEqual(Object.keys(en.notified).sort(), ["failed", "none", "sent", "window_closed"]);
});

console.log(`cardOrders: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("FAILURES:"); for (const f of failures) console.log(" - " + f); process.exit(1); }
