// Churches & Ministries Phase 4 (advanced features): the Church Store summary and stock card, and the church push safeguard. OFFLINE: pure functions, the real handler against a recording stub session,
// the real dispatch() against a stub database, plus source and translation checks. No database, no network, no payment. All data is synthetic.
//   Run:  node scripts/tests/churchPhase4.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { kit, REPO, SRC } from "./ministryApiHarness.mjs";

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const { check, eq, section, summary } = kit();
console.error = () => {};
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const strip = (s) => s.replace(/\/\/[^\n]*/g, "");

const SUM = jiti(path.join(SRC, "lib/church/store/summary.ts"));
const STOCK = jiti(path.join(SRC, "lib/church/store/stock.ts"));
const RUN = jiti(path.join(SRC, "lib/church/push/run.ts"));
const TR = jiti(path.join(SRC, "lib/i18n/translations.ts")).translations;

const PERIOD = { from: "2026-10-01", to: "2026-10-31", days: 31 };

section("A. store summary arithmetic: ");
{
  const placed = [
    { status: "paid" }, { status: "fulfilled" }, { status: "awaiting_payment" }, { status: "awaiting_payment" }, { status: "cancelled" }, { status: "refunded" }, { status: "payment_review" }, { status: "bogus" },
  ];
  const paid = [
    { status: "paid", total: "5000.00", currency: "XAF", paid_at: "2026-10-05T10:00:00Z" },
    { status: "fulfilled", total: 2500, currency: "XAF", paid_at: "2026-10-06T10:00:00Z" },
    { status: "paid", total: "10.00", currency: "EUR", paid_at: "2026-10-07T10:00:00Z" },
    { status: "awaiting_payment", total: 9999, currency: "XAF", paid_at: null },
    { status: "refunded", total: 3000, currency: "XAF", paid_at: "2026-10-08T10:00:00Z" },
    { status: "paid", total: 4000, currency: "XAF", paid_at: null },
  ];
  const s = SUM.summarizeStore(PERIOD, placed, paid, false);
  eq("only verified paid or fulfilled XAF orders with a paid date are added up", [s.sales.orders, s.sales.revenueXaf], [2, 7500]);
  eq("the average is a whole number of XAF", s.sales.averageXaf, 3750);
  eq("a paid order in another currency is counted aside and never added to the XAF total", s.sales.otherCurrencyOrders, 1);
  eq("an unpaid, refunded or undated order is never counted as a sale", s.sales.orders, 2);
  eq("orders placed are counted by status and an unknown status is ignored", [s.placed.total, s.placed.byStatus.awaiting_payment, s.placed.byStatus.paid, s.placed.byStatus.refunded, s.placed.byStatus.payment_review], [8, 2, 1, 1, 1]);
  const empty = SUM.summarizeStore(PERIOD, [], [], false);
  eq("no orders gives zeros and a zero average, never NaN", [empty.sales.orders, empty.sales.revenueXaf, empty.sales.averageXaf, empty.placed.total], [0, 0, 0, 0]);
  const junk = SUM.summarizeStore(PERIOD, [], [{ status: "paid", total: "abc", currency: "XAF", paid_at: "2026-10-05T10:00:00Z" }, { status: "paid", total: -50, currency: "XAF", paid_at: "2026-10-05T10:00:00Z" }], false);
  eq("an unreadable or negative total adds nothing", junk.sales.revenueXaf, 0);
  check("a truncated read is flagged so the screen never presents a floor as exact", SUM.summarizeStore(PERIOD, [], [], true).truncated === true);
  check("the summary carries no buyer data: only counts and totals", !/name|phone|email|address|buyer/i.test(JSON.stringify(s)));
}

section("B. store summary handler: ");
{
  const calls = [];
  const session = (result) => ({
    from(table) {
      const rec = { table, filters: [] };
      calls.push(rec);
      const q = {
        select: () => q,
        eq: (c, v) => (rec.filters.push(["eq", c, v]), q),
        in: (c, v) => (rec.filters.push(["in", c, v]), q),
        gte: (c, v) => (rec.filters.push(["gte", c, v]), q),
        lt: (c, v) => (rec.filters.push(["lt", c, v]), q),
        order: () => q,
        limit: () => q,
        then: (res, rej) => Promise.resolve(result(rec)).then(res, rej),
      };
      return q;
    },
  });
  const actor = (kind, result) => ({ kind, profileId: "c1", caps: {}, supabase: session(result) });
  const okRows = (rec) => ({ data: rec.filters.some((f) => f[0] === "in") ? [{ status: "paid", total: 1000, currency: "XAF", paid_at: "2026-10-05T10:00:00Z" }] : [{ status: "paid" }, { status: "awaiting_payment" }], error: null });

  const owner = await SUM.getStoreSummary(actor("owner", okRows), new URLSearchParams("from=2026-10-01&to=2026-10-31"));
  eq("the owner gets the summary", [owner.status, owner.body.summary.sales.revenueXaf, owner.body.summary.placed.total], [200, 1000, 2]);
  check("it reads only the church's own Shop orders table, scoped to the church from the session", calls.every((c) => c.table === "product_orders" && c.filters.some((f) => f[1] === "profile_id" && f[2] === "c1")));
  check("sales are counted on the day paid and only for paid or fulfilled orders", calls.some((c) => c.filters.some((f) => f[0] === "in" && f[1] === "status" && f[2].join() === "paid,fulfilled") && c.filters.some((f) => f[1] === "paid_at")));

  const before = calls.length;
  for (const kind of ["staff", "leader"]) {
    const r = await SUM.getStoreSummary(actor(kind, okRows), new URLSearchParams());
    eq(`${kind} is refused (the Shop is owner only)`, r.status, 403);
  }
  eq("a refused request reads nothing", calls.length, before);
  eq("an unexpected parameter is refused", (await SUM.getStoreSummary(actor("owner", okRows), new URLSearchParams("church=x"))).status, 400);
  eq("a bad date is refused", (await SUM.getStoreSummary(actor("owner", okRows), new URLSearchParams("from=2026-02-30&to=2026-03-01"))).status, 400);
  eq("a range over 366 days is refused", (await SUM.getStoreSummary(actor("owner", okRows), new URLSearchParams("from=2024-01-01&to=2026-01-01"))).status, 400);
  const bad = await SUM.getStoreSummary(actor("owner", () => ({ data: null, error: { message: "secret table detail" } })), new URLSearchParams());
  check("a failed read is an error, never zero, and never echoes the database's words", bad.status === 502 && !JSON.stringify(bad.body).includes("secret"), JSON.stringify(bad));
  const big = await SUM.getStoreSummary(actor("owner", () => ({ data: Array.from({ length: SUM.SUMMARY_ROW_LIMIT }, () => ({ status: "awaiting_payment" })), error: null })), new URLSearchParams());
  check("hitting the row limit is reported as truncated", big.body.summary.truncated === true);
}

section("C. stock card: ");
{
  const body = {
    summary: { tracked: 12, low: 2, out: 1 },
    items: [
      { product_id: "p1", name: "Hymn book", state: "low", count: 3 },
      { product_id: "p2", name: "T-shirt", state: "out", count: 0 },
      { product_id: "p3", name: "Bible", state: "ok", count: 50 },
      { product_id: "p4", name: "Cap", state: "low", count: 1 },
    ],
  };
  const s = STOCK.stockFromOverview(body);
  eq("counts come straight from the Inventory summary", [s.state, s.tracked, s.low, s.out], ["ready", 12, 2, 1]);
  eq("out of stock is listed before low stock and healthy products are left out", s.attention.map((a) => a.id), ["p2", "p1", "p4"]);
  eq("an unusable answer is 'unavailable', not zero", [STOCK.stockFromOverview(null).state, STOCK.stockFromOverview({}).state], ["unavailable", "unavailable"]);
  eq("no tracked products is a real zero", STOCK.stockFromOverview({ summary: { tracked: 0, low: 0, out: 0 }, items: [] }).tracked, 0);
  const many = STOCK.stockFromOverview({ summary: { tracked: 99, low: 20, out: 0 }, items: Array.from({ length: 20 }, (_, i) => ({ product_id: `x${i}`, name: `N${i}`, state: "low", count: 1 })) });
  eq("at most five products are listed", many.attention.length, 5);
  const src = strip(read("src/lib/church/store/stock.ts"));
  check("stock refuses an Inventory owner that is not the church being viewed", /owner.profile.id !== expectedProfileId/.test(read("src/lib/church/store/stock.ts")));
  check("stock reuses the existing Inventory (no table of its own, no giving)", /inventoryOverview/.test(src) && !/\.from\(|church_gift|giving/i.test(src));
}

section("D. the push job does not resend when a delivery cannot be noted: ");
{
  const rows = Array.from({ length: RUN.BATCH }, (_, i) => ({ customer_id: `cu${i}`, lang: "en", start_date: null }));
  const log = { sent: 0, records: 0, finish: [], recipientCalls: 0 };
  const db = {
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "c1", name: "Grace", username: "grace", published: true, is_demo: false }, error: null }) }; return q; },
    rpc: async (fn, args) => {
      if (fn === "church_push_claim") return { data: [{ id: "o1", profile_id: "c1", kind: "announcement", ref: "r1", payload: { path: "/grace/church/announcements", title_en: "Notice" } }], error: null };
      if (fn === "church_push_recipients") return (log.recipientCalls++, { data: rows, error: null });
      if (fn === "church_push_record") return (log.records++, { data: null, error: { message: "boom" } });
      if (fn === "church_push_finish") return (log.finish.push(args.p_status), { data: null, error: null });
      return { data: null, error: null };
    },
  };
  const r = await RUN.dispatch(db, async () => (log.sent++, true));
  eq("after the first failed note the batch stops: one push, not a repeat of the whole list", [log.sent, log.records, log.recipientCalls], [1, 1, 1]);
  check("the notification is not marked finished (it is released later)", log.finish.length === 0, JSON.stringify(log.finish));
  check("the failure is counted", r.claimed === 1 && r.sent === 1);

  const ok = { sent: 0, finish: [] };
  const db2 = { ...db, rpc: async (fn, args) => (fn === "church_push_recipients" ? { data: rows.slice(0, 3), error: null } : fn === "church_push_record" ? { data: true, error: null } : fn === "church_push_finish" ? (ok.finish.push(args.p_status), { data: null, error: null }) : db.rpc(fn, args)) };
  const r2 = await RUN.dispatch(db2, async () => (ok.sent++, true));
  check("a healthy run still sends everyone and finishes", ok.sent === 3 && r2.sent === 3 && ok.finish.join() === "sent", JSON.stringify([ok, r2]));
  const cron = strip(read("src/app/api/cron/church-push/route.ts"));
  check("the cron route still requires the secret and there is still exactly one church-push cron", /CRON_SECRET/.test(cron) && JSON.parse(read("vercel.json")).crons.filter((c) => /church-push/.test(c.path)).length === 1);
}

section("E. route, page, screens and strings: ");
{
  const route = strip(read("src/app/api/church/store-summary/route.ts"));
  check("the route goes through the shared church route kit, GET only", /churchRoute\(request, \{ write: false \}/.test(route) && !/export (async )?function (POST|PUT|PATCH|DELETE)|export const (POST|PUT|PATCH|DELETE)/.test(route));
  const handler = strip(read("src/lib/church/store/summary.ts"));
  check("the summary never reads giving, gifts, payments or the service-role client", !/church_gift|church_giving|gift|tithe|createAdminClient|customer_payments|payout/i.test(handler));
  check("the summary never selects a buyer column", !/buyer|customer_name|customer_email|phone|address/i.test(handler.match(/select\("[^"]*"\)/g)?.join("") || ""));
  const page = read("src/app/dashboard/church/store/page.tsx");
  check("the page stays owner-only and loads stock only when the Shop is available", /actor\.kind !== "owner"/.test(page) && /shopAvailable \? await loadChurchStock\(actor\.profileId\)/.test(page));
  const ui = read("src/components/church/store/ChurchStoreSummary.tsx") + read("src/components/church/store/ChurchStoreStock.tsx");
  check("the screens have loading, error with retry, empty and truncated states", /ListSkeleton/.test(ui) && /s\.retry/.test(ui) && /EmptyState/.test(ui) && /s\.truncated/.test(ui) && /role="alert"/.test(ui) && /s\.unavailable/.test(ui));
  check("the client screens import no server code (no admin client, no handler module)", !/createAdminClient|church\/store\/summary"|church\/store\/stock"\s*;?\s*$/m.test(ui.replace(/import type[^\n]*\n/g, "")));
  check("money is shown as XAF through the shared formatter", /formatPrice\(n, "XAF", lang\)/.test(ui));
  check("the layout is mobile first (single column, grids widen at sm)", /grid-cols-1 gap-2 sm:grid-cols-3/.test(ui) && /flex-col gap-3 sm:flex-row/.test(ui));
  check("the stock card links to the existing Inventory", /href="\/dashboard\/inventory"/.test(ui));

  const keys = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  for (const part of ["stock", "summary"]) {
    const en = TR.en.churchStore[part];
    const fr = TR.fr.churchStore[part];
    eq(`${part}: English and French have exactly the same keys`, keys(en).sort(), keys(fr).sort());
    const strings = keys(en).filter((k) => typeof k === "string");
    check(`${part}: no French string is a copy of the English one`, keys(en).every((k) => { const a = k.split(".").reduce((o, x) => o[x], en); const b = k.split(".").reduce((o, x) => o[x], fr); return typeof a === "function" || a.length < 12 || a !== b; }));
    void strings;
  }
  check("the French plural/function strings work", TR.fr.churchStore.stock.left(1) === "1 restant" && TR.fr.churchStore.stock.left(4) === "4 restants" && TR.en.churchStore.summary.otherCurrency(2).includes("2"));
  eq("every order status has a label in both languages", [TR.en.churchStore.summary.status, TR.fr.churchStore.summary.status].map((o) => Object.keys(o).sort().join()), [Object.keys(TR.en.churchStore.summary.status).sort().join(), Object.keys(TR.en.churchStore.summary.status).sort().join()]);
  const statuses = jiti(path.join(SRC, "lib/church/store/statuses.ts")).ORDER_STATUSES;
  eq("the status labels cover every order status", [...statuses].sort(), Object.keys(TR.en.churchStore.summary.status).sort());
  check("Ringo AI knows the Store stock and sales figures and that giving is separate", /Stock card/.test(read("src/lib/ai/knowledge/modules/churchMinistries.ts")) && /never include giving/.test(read("src/lib/ai/knowledge/modules/churchMinistries.ts")));
}

section("F. nothing it must not touch: ");
{
  const gifts = strip(read("src/lib/church/giving/gifts/store.ts"));
  check("giving code is untouched in spirit: the store summary shares no module with it", !/store\/summary|store\/stock/.test(gifts));
  check("the existing church report still carries no money (Phase 10 rule intact)", !/product_orders|church_gift/.test(["period", "build", "csv", "handlers"].map((f) => strip(read(`src/lib/church/reports/${f}.ts`))).join("\n")));
  const modules = read("src/lib/church/modules.ts");
  check("no new module or permission was added: the Store tab stays the one entry", (modules.match(/key: "/g) || []).length === 19 && !/church\.store/.test(read("src/lib/church/permissions.ts")));
}

process.exit(summary());
