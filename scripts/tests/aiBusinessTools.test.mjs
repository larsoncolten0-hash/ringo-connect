// Ringo AI x Business Toolkit, Phase A: the seven READ-ONLY business tools, their server-side gate, the Africa/Douala period logic, the tool registry
// behaviour, the knowledge/prompt wording and the scope of the change. The REAL tool code, gate, period module, report/trend/overview builders and
// Business Toolkit handlers run against in-memory read-only fakes; only the session resolver and the service client are stubbed. No network, no database,
// no model call, no migration.
//   Run:  node scripts/tests/aiBusinessTools.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { SRC, REPO, PROFILE, OTHER, USER, ID, makeDb, makeAdmin, mkOwner, earn, entry, order, counters } from "./phase7Harness.mjs";

const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `aibt_${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const accessStub = mk("access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__owner };");
const serverStub = mk("server", "module.exports = { createAdminClient: () => globalThis.__gateAdmin, createClient: () => { throw new Error('the cookie session client must not be used by the business tools'); } };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": accessStub, "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const load = (p) => jiti(path.join(SRC, p));
const T = load("lib/ai/tools/definitions/business.ts");
const { getAvailableTools, executeTool } = load("lib/ai/tools/registry.ts");
const { AI_TOOLS } = load("lib/ai/tools/index.ts");
const G = load("lib/ai/business/gate.ts");
const PER = load("lib/ai/business/period.ts");
const RP = load("lib/reports/period.ts");
const RB = load("lib/reports/build.ts");
const TR = load("lib/overview/trends.ts");
const OV = load("lib/overview/handlers.ts");
const { translations } = load("lib/i18n/translations.ts");
const { KNOWLEDGE_MODULES, getKnowledgeModule } = load("lib/ai/knowledge/index.ts");
const { buildStableSystemPrompt } = load("lib/ai/prompts/system.ts");
const { DRAFT_TYPES } = load("lib/ai/drafts/types.ts");

console.error = () => {};
const { c, check, eq } = counters();
const NOW = new Date("2026-12-10T10:00:00Z");           // 11:00 in Douala, Thursday 10 December 2026
const LATE = new Date("2026-12-09T23:30:00Z");          // 00:30 on 10 December in Douala
const BEFORE_MIDNIGHT = new Date("2026-12-09T22:30:00Z"); // 23:30 on 9 December in Douala
const C1 = ID(601), C2 = ID(602), C3 = ID(603), CX = ID(699);
const SECRETS = ["+237 600 111 222", "john.secret@mail.test", "VIP secret note"];

// ------------------------------------------------------------------------ fixtures
const TABLES = () => ({
  bk_entries: [
    entry("a1", "sale", 10000, "2026-12-10", { category: "invoice_payment", description: "INV-2026-0001" }),
    entry("a2", "sale", 3000, "2026-12-10"),
    entry("a3", "sale", 2000, "2026-12-09"),
    entry("a4", "expense", 500, "2026-12-10", { category: "rent" }),
    entry("a5", "sale", 4000, "2026-12-07"),
    entry("a6", "sale", 1000, "2026-12-06"),
    entry("a7", "sale", 9999, "2026-12-10", { voided_at: "2026-12-10T08:00:00Z", void_reason: "x" }),
    entry("a8", "sale", 777, "2026-12-10", { currency: "USD" }),
    entry("a9", "sale", 5000, "2026-12-08", { voided_at: "2026-12-08T12:00:00Z", void_reason: "Replaced by a correction" }),
    entry("a10", "sale", 5500, "2026-12-08", { replaces_entry_id: "a9" }),
    entry("a11", "sale", 1500, "2026-11-20"),
    { ...entry("x1", "sale", 55555, "2026-12-10"), profile_id: OTHER },
  ],
  product_orders: [
    order("p1", "paid", 20000, "2026-12-09T23:30:00Z", earn(2000, 18000)),   // 00:30 on 10 December in Douala
    order("p2", "paid", 6000, "2026-12-09T22:30:00Z", earn(600, 5400)),      // 23:30 on 9 December in Douala
    order("p3", "refunded", 3000, "2026-12-10T08:00:00Z", earn(300, 2700)),
    { ...order("px", "paid", 88888, "2026-12-10T08:00:00Z", earn(8, 88880)), profile_id: OTHER },
  ],
  product_order_items: [],
  bk_documents: [{ id: "d1", profile_id: PROFILE, doc_type: "invoice", status: "paid", number: "INV-2026-0001", total: "10000", amount_paid: "10000", currency: "XAF", issue_date: "2026-12-01", created_at: "2026-12-01T08:00:00Z", due_date: null }],
  bk_customers: [
    { id: C1, profile_id: PROFILE, name: "John Doe", phone: SECRETS[0], email: SECRETS[1], phone_normalized: "237600111222", email_normalized: SECRETS[1], notes: SECRETS[2], archived_at: null, auto_reminders_paused: false },
    { id: C2, profile_id: PROFILE, name: "John Smith", phone: null, email: null, phone_normalized: null, email_normalized: null, archived_at: null, auto_reminders_paused: false },
    { id: C3, profile_id: PROFILE, name: "Johnny Archived", phone: null, email: null, phone_normalized: null, email_normalized: null, archived_at: "2026-06-01T00:00:00Z", auto_reminders_paused: false },
    { id: ID(604), profile_id: PROFILE, name: "Marie Twin", phone: null, email: null, phone_normalized: null, email_normalized: null, archived_at: null, auto_reminders_paused: false },
    { id: ID(605), profile_id: PROFILE, name: "Marie Twin", phone: null, email: null, phone_normalized: null, email_normalized: null, archived_at: null, auto_reminders_paused: false },
    { id: ID(606), profile_id: PROFILE, name: "Sarah Solo", phone: null, email: null, phone_normalized: null, email_normalized: null, archived_at: null, auto_reminders_paused: false },
    { id: CX, profile_id: OTHER, name: "John Other Business", phone: null, email: null, phone_normalized: null, email_normalized: null, archived_at: null, auto_reminders_paused: false },
  ],
  // decoys: other Ringo subsystems that own their own transactions. Business tools must never read or add them.
  orders: [{ id: "r1", profile_id: PROFILE, status: "completed", total: "99999", created_at: "2026-12-10T08:00:00Z" }],
  order_items: [{ id: "ri1", order_id: "r1", line_total: "99999" }],
  music_orders: [{ id: "m1", profile_id: PROFILE, status: "paid", payment_status: "paid", total: "88888", created_at: "2026-12-10T08:00:00Z" }],
  music_order_items: [{ id: "mi1", order_id: "m1", item_type: "ticket", line_total: "88888" }],
  digital_tickets: [{ id: "t1", profile_id: PROFILE }],
  restaurant_customers: [{ id: "rc1", profile_id: PROFILE, name: "Restaurant Diner" }],
});

const RECV = () => ({ data: { today: "2026-12-10", profile_currency: "XAF", currencies: [
  { currency: "XAF", can_record_payment: true, outstanding: "40000", overdue: "10000", invoice_count: 4, overdue_count: 1,
    aging: { not_due: { amount: "30000", count: 3 }, d1_30: { amount: "10000", count: 1 } },
    customers: [{ customer_id: C1, name: "John Doe", archived: false, auto_paused: false, outstanding: "30000", overdue: "10000", invoice_count: 3, oldest_due_date: "2026-11-01", last_reminder_at: null }],
    unassigned: { outstanding: "10000", overdue: "0", invoice_count: 1 } },
  { currency: "USD", can_record_payment: false, outstanding: "100.00", overdue: "0.00", invoice_count: 1, overdue_count: 0, aging: {}, customers: [{ customer_id: C2, name: "John Smith", archived: false, auto_paused: false, outstanding: "100.00", overdue: "0.00", invoice_count: 1, oldest_due_date: null, last_reminder_at: null }], unassigned: { outstanding: "0", overdue: "0", invoice_count: 0 } },
] }, error: null });
const INVOICES = [
  { id: ID(701), number: "INV-2026-0003", issue_date: "2026-10-01", due_date: "2026-11-01", currency: "XAF", total: "30000", amount_paid: "20000", amount_due: "10000", overdue: true, days_overdue: 39, status: "partially_paid", customer_id: C1, customer_name: "John Doe", linked: true, has_email: true, has_phone: true, can_record_payment: true, last_reminder_at: null, reminders_sent: 1 },
  { id: ID(702), number: "INV-2026-0005", issue_date: "2026-12-01", due_date: "2026-12-30", currency: "XAF", total: "30000", amount_paid: "0", amount_due: "30000", overdue: false, days_overdue: 0, status: "issued", customer_id: null, customer_name: null, linked: false, has_email: false, has_phone: false, can_record_payment: true, last_reminder_at: null, reminders_sent: 0 },
  { id: ID(703), number: "INV-2026-0006", issue_date: "2026-12-02", due_date: "2026-12-20", currency: "USD", total: "100.00", amount_paid: "0.00", amount_due: "100.00", overdue: false, days_overdue: 0, status: "issued", customer_id: C2, customer_name: "John Smith", linked: true, has_email: true, has_phone: false, can_record_payment: false, last_reminder_at: null, reminders_sent: 0 },
];
const STATEMENT = (id) => id !== C1 ? { data: null, error: { message: "customer_not_found" } } : { data: {
  customer: { id: C1, name: "John Doe", phone: SECRETS[0], email: SECRETS[1], notes: SECRETS[2], auto_reminders_paused: false, archived_at: null }, profile_currency: "XAF",
  invoices: [
    { id: ID(701), number: "INV-2026-0003", status: "partially_paid", currency: "XAF", total: "30000", amount_paid: "20000", amount_due: "10000", issue_date: "2026-10-01", due_date: "2026-11-01", overdue: true, can_record_payment: true },
    { id: ID(704), number: "INV-2026-0002", status: "paid", currency: "XAF", total: "10000", amount_paid: "10000", amount_due: "0", issue_date: "2026-09-01", due_date: "2026-09-15", overdue: false, can_record_payment: false },
  ],
  payments: [
    { id: ID(711), invoice_id: ID(701), invoice_number: "INV-2026-0003", receipt_number: "RCT-2026-0007", amount: "20000", currency: "XAF", method: "mobile_money", reference: "ref-secret", paid_on: "2026-10-20", voided: false },
    { id: ID(712), invoice_id: ID(704), invoice_number: "INV-2026-0002", receipt_number: "RCT-2026-0002", amount: "10000", currency: "XAF", method: "cash", reference: null, paid_on: "2026-09-10", voided: false },
    { id: ID(713), invoice_id: ID(701), invoice_number: "INV-2026-0003", receipt_number: "RCT-2026-0009", amount: "5000", currency: "XAF", method: "cash", reference: null, paid_on: "2026-10-25", voided: true },
  ],
  totals: [{ currency: "XAF", outstanding: "10000", overdue: "10000" }],
}, error: null };

const mkItem = (n, state, count, extra = {}) => ({ product_id: ID(800 + n), name: `Item ${n}`, available: true, state, tracked: state !== "untracked", count, low_stock_threshold: 5, reserved: 0, sold_units: n, sku: null, unit_cost: null, cost_currency: null, estimated_value: null, last_movement_at: null, drift: 0, ...extra });
const INV_ITEMS = [
  mkItem(1, "out", 0), mkItem(2, "out", 0, { name: "Shea Butter" }), mkItem(3, "low", 4), mkItem(4, "low", 2, { name: "Black Soap", low_stock_threshold: 3 }), mkItem(5, "ok", 40, { name: "Nike T-Shirt" }),
  mkItem(6, "ok", 12, { name: "Crème Éclat" }), mkItem(7, "legacy", 7), mkItem(8, "untracked", null),
];
const invRpc = (items) => (a) => {
  const f = a.p_filter;
  const sel = items.filter((i) => !f || (f === "tracked" ? i.tracked && i.state !== "legacy" && i.state !== "untracked" : i.state === f));
  const cnt = (s) => items.filter((i) => i.state === s).length;
  const lim = Math.min(Math.max(a.p_limit ?? 50, 1), 100), off = a.p_offset ?? 0;
  return { data: { profile_currency: "XAF", total: sel.length, summary: { tracked: cnt("out") + cnt("low") + cnt("ok"), out: cnt("out"), low: cnt("low"), ok: cnt("ok"), legacy: cnt("legacy"), untracked: cnt("untracked"), estimated_value: "54800", value_excluded: 0, drift: 0 }, items: sel.slice(off, off + lim) }, error: null };
};

function setup(opts = {}) {
  const tables = opts.tables ?? TABLES();
  const log = [];
  const owner = mkOwner(tables, {
    doc_receivables_summary: opts.recv ?? RECV(),
    doc_receivable_invoices: (a) => ({ data: { items: INVOICES.filter((i) => !a.p_overdue_only || i.overdue).slice(a.p_offset, a.p_offset + a.p_limit), total: INVOICES.filter((i) => !a.p_overdue_only || i.overdue).length }, error: null }),
    doc_customer_statement: (a) => STATEMENT(a.p_customer_id),
    inv_overview: opts.inv ?? invRpc(INV_ITEMS),
  }, log, { currency: opts.currency });
  globalThis.__owner = opts.access ?? { ok: true, owner };
  globalThis.__gateAdmin = makeDb({ users: [{ id: USER, plans: opts.plans === undefined ? { ai_enabled: true, business_toolkit_enabled: true } : opts.plans }] });
  return { owner, log, tables };
}
const snap = (over = {}) => ({
  loadedAt: NOW.toISOString(),
  profile: { username: "shop", displayName: "Shop", location: null, category: "business_ecommerce", categories: [], musicRole: null, restaurantSubcategory: null, published: true, verified: false, currency: "XAF", hasAvatar: true, hasBio: true, hasCoverImage: true, hasLongDescription: true, hasWhatsapp: true, hasAboutEmail: true, hasAboutPhone: true, bookingsEnabled: false, createdAt: null },
  isMusic: false, isRestaurant: false, hasTicketing: false, restaurant: null, platformCommerceEnabled: true, shop: { ordersToFulfill: 0 },
  plan: { name: "pro", displayName: "Pro", maxLinks: null, maxProducts: null, pixelsEnabled: true, customThemeEnabled: true, fullAnalyticsEnabled: true, badgeRemoved: true, teamEnabled: false, maxTeamSeats: null, aiEnabled: true, aiImageEnabled: false, expiresAt: null },
  onboardingCompleted: true, loyaltyAvailability: "optional", businessToolkitAi: true,
  counts: { links: 3, socialLinks: 2, products: 4, tracks: 0, sellableStandaloneTracks: 0, unpricedStandaloneTracks: 0, releases: 0, events: 0, upcomingPublishedEvents: 0, upcomingEventsWithoutTicketing: 0, menuCategories: 0, menuItems: 0, availableMenuItems: 0, restaurantTables: 0, bookingServices: 0, activeConnections: 5, activeCommunitySubscribers: 5, activeLoyaltyPrograms: 0 },
  ...over,
});
const ctxOf = (o = {}) => ({ workspace: { userId: USER, profileId: PROFILE, username: "shop", actor: o.actor ?? { kind: "owner" } }, snapshot: snap(o.snapshot), locale: "en", now: o.now ?? NOW });
async function call(name, input, o = {}) {
  const ctx = ctxOf(o);
  const tools = getAvailableTools(ctx);
  const r = await executeTool(name, input, ctx, tools);
  return { ...r, json: JSON.parse(r.content) };
}
const BUSINESS_NAMES = ["get_business_summary", "get_sales", "get_business_trends", "get_outstanding_invoices", "get_customer_statement", "get_inventory", "get_low_stock"];
const SAMPLE = {
  get_business_summary: {}, get_sales: { period: "today", from: null, to: null }, get_business_trends: { months: 3, end: "this_month", include_year_to_date: false },
  get_outstanding_invoices: { only_overdue: false, limit: 5 }, get_customer_statement: { person_name: "John Doe" }, get_inventory: { name: null, limit: 5 }, get_low_stock: { limit: 5 },
};
const sales = async (period, o = {}, extra = {}) => (await call("get_sales", { period, from: null, to: null, ...extra }, o)).json;

// ------------------------------------------------------------------------ registry: only 7 read tools, offered only to eligible workspaces
{
  const names = AI_TOOLS.map((t) => t.name);
  check("the seven business tools are registered once each, and tool names stay unique", BUSINESS_NAMES.every((n) => names.filter((x) => x === n).length === 1) && new Set(names).size === names.length);
  check("every business tool is a READ tool: no write, draft, content, image or calendar kind", T.BUSINESS_AI_TOOLS.length === 7 && T.BUSINESS_AI_TOOLS.every((t) => t.kind === "read"));
  check("no business WRITE tool exists (no create/record/generate/update/delete tool name)", !names.some((n) => /^(create_bookkeeping_entry|create_invoice|record_invoice_payment|create_customer|record_stock_movement|generate_receipt)$/.test(n)));
  eq("the draft types: the original 8 plus the 5 business drafts (aiBusinessDrafts.test.mjs covers them)", DRAFT_TYPES.length, 13);
  const listed = getAvailableTools(ctxOf()).map((t) => t.name);
  check("an eligible workspace is offered all seven business tools", BUSINESS_NAMES.every((n) => listed.includes(n)));
  check("a workspace that is not eligible (snapshot.businessToolkitAi false) is offered none of them", !getAvailableTools(ctxOf({ snapshot: { businessToolkitAi: false } })).some((t) => BUSINESS_NAMES.includes(t.name)));
  check("a staff actor without the team permissions is not offered them; with every permission they are listed but still refused when run", !getAvailableTools(ctxOf({ actor: { kind: "staff", roleName: "x", permissions: [] } })).some((t) => BUSINESS_NAMES.includes(t.name)));
  for (const t of T.BUSINESS_AI_TOOLS) {
    const props = Object.keys(t.inputSchema.properties || {});
    check(`${t.name}: strict schema (every property required, no extra properties) and it asks for no id of any kind`, t.inputSchema.additionalProperties === false && JSON.stringify([...(t.inputSchema.required || [])].sort()) === JSON.stringify([...props].sort()) && !props.some((p) => /id$|profile|user|org|sql|query|table/i.test(p)), props.join());
  }
  const en = translations.en.ringoAi.toolStatus, fr = translations.fr.ringoAi.toolStatus;
  check("every business tool has a status label in English and French", BUSINESS_NAMES.every((n) => en[n] && fr[n] && en[n] !== fr[n]));
  const ctx = ctxOf();
  const unknown = await executeTool("get_everything", {}, ctx, getAvailableTools(ctx));
  check("an invented tool name is refused", unknown.isError && JSON.parse(unknown.content).error === "tool_not_available");
  const staff = { kind: "staff", roleName: "x", permissions: ["reports.view", "payments.view", "sales.view"] };
  setup();
  const r = await call("get_business_summary", {}, { actor: staff });
  check("a staff actor that passes the permission check is still refused by the gate (staff are not supported)", r.json.error === "business_toolkit_not_available" && r.json.reason === "staff_not_supported");
}

// ------------------------------------------------------------------------ authorization: the gate runs first and fails closed
{
  const attempt = async (label, opts, o = {}) => {
    const s = setup(opts);
    const out = {};
    for (const n of BUSINESS_NAMES) out[n] = (await call(n, SAMPLE[n], o)).json;
    const refused = BUSINESS_NAMES.every((n) => out[n].error === "business_toolkit_not_available");
    check(`${label}: all seven tools refuse and return no data`, refused && BUSINESS_NAMES.every((n) => Object.keys(out[n]).sort().join() === "error,note,reason"), JSON.stringify(out.get_sales).slice(0, 200));
    check(`${label}: no Business Toolkit table and no RPC was touched`, s.log.length === 0 && s.owner.admin.calls.length === 0, `${s.log.length} reads, ${s.owner.admin.calls.length} rpc`);
    return out;
  };
  await attempt("AI not enabled on the plan (a beta pass for Ringo AI does not stand in for it)", { plans: { ai_enabled: false, business_toolkit_enabled: true } });
  await attempt("Business Toolkit not enabled on the plan", { plans: { ai_enabled: true, business_toolkit_enabled: false } });
  await attempt("plan flags unreadable (fails closed)", { plans: null });
  for (const reason of ["not_signed_in", "no_profile", "not_owner", "demo_profile", "category_not_enabled", "plan_not_enabled"]) await attempt(`toolkit gate says ${reason}`, { access: { ok: false, reason } });
  const mismatchProfile = setup();
  mismatchProfile.owner.profile.id = OTHER;
  globalThis.__owner = { ok: true, owner: mismatchProfile.owner };
  check("the toolkit owner is for a DIFFERENT profile than the AI workspace: refused (workspace_mismatch)", (await call("get_sales", SAMPLE.get_sales)).json.reason === "workspace_mismatch");
  const mismatchUser = setup();
  mismatchUser.owner.userId = ID(1234);
  globalThis.__owner = { ok: true, owner: mismatchUser.owner };
  check("...or a different user: refused (workspace_mismatch)", (await call("get_sales", SAMPLE.get_sales)).json.reason === "workspace_mismatch");
  const direct = await G.requireBusinessAi({ workspace: { userId: USER, profileId: PROFILE, username: "x", actor: { kind: "staff", roleName: "a", permissions: [] } } });
  check("the gate refuses a staff actor before it reads anything", direct.ok === false && direct.refusal.reason === "staff_not_supported");
  setup();
  const ok = await G.requireBusinessAi(ctxOf());
  check("an eligible owner passes the gate and receives the toolkit's own owner object", ok.ok === true && ok.owner.profile.id === PROFILE);

  // cross-business and model-supplied identity
  const s = setup();
  const sl = await sales("this_month", {}, { profile_id: OTHER, user_id: OTHER });
  const sum = await call("get_business_summary", { profile_id: OTHER });
  const statement = await call("get_customer_statement", { person_name: "John Other Business", customer_id: CX, profile_id: OTHER });
  const rec = await call("get_outstanding_invoices", { only_overdue: false, limit: 5, profile_id: OTHER });
  const low = await call("get_low_stock", { limit: 5, profile_id: OTHER });
  check("a profile or user id supplied by the model is ignored: the other business's 55 555 / 88 888 never appears", !JSON.stringify([sl, sum.json]).includes("55555") && !JSON.stringify([sl, sum.json]).includes("88888"));
  check("another business's customer cannot be found by name (not_found) and its id is never used", statement.json.status === "not_found" && !s.owner.admin.calls.some(([n, a]) => n === "doc_customer_statement" && a.p_customer_id === CX));
  check("every database read is scoped to the caller's own profile", s.log.length > 0 && s.log.every((x) => x.eq.some(([col, v]) => col === "profile_id" && v === PROFILE)), JSON.stringify(s.log.filter((x) => !x.eq.some(([col]) => col === "profile_id")).map((x) => x.table)));
  check("every RPC receives the owner's own profile and user, never a model-supplied one", s.owner.admin.calls.length >= 3 && s.owner.admin.calls.every(([, a]) => a.p_profile_id === PROFILE && a.p_actor_user_id === USER), JSON.stringify(s.owner.admin.calls.map((x) => x[1])).slice(0, 300));
  check("extra model fields never change what a tool does", rec.json.invoices_matching === 3 && low.json.summary.out_of_stock === 2);
}

// ------------------------------------------------------------------------ dates: Africa/Douala, never UTC
{
  const p = (kind, now, custom) => PER.resolveBusinessPeriod(kind, now, custom);
  const rng = (r) => [r.from, r.to];
  eq("00:30 on 10 December in Douala (23:30 UTC on the 9th): today is the 10th", rng(p("today", LATE)), ["2026-12-10", "2026-12-10"]);
  eq("...and yesterday is the 9th", rng(p("yesterday", LATE)), ["2026-12-09", "2026-12-09"]);
  eq("23:30 on 9 December in Douala (22:30 UTC): today is still the 9th", rng(p("today", BEFORE_MIDNIGHT)), ["2026-12-09", "2026-12-09"]);
  eq("midnight exactly (23:00:00 UTC) already belongs to the new Douala day", rng(p("today", new Date("2026-12-09T23:00:00Z"))), ["2026-12-10", "2026-12-10"]);
  eq("one second before midnight (22:59:59 UTC) is still the old day", rng(p("today", new Date("2026-12-09T22:59:59Z"))), ["2026-12-09", "2026-12-09"]);
  eq("this week runs from Monday to today (Thursday 10 December: Monday is the 7th)", rng(p("this_week", NOW)), ["2026-12-07", "2026-12-10"]);
  eq("on a Sunday the week began the Monday before", rng(p("this_week", new Date("2026-12-06T12:00:00Z"))), ["2026-11-30", "2026-12-06"]);
  eq("on a Monday the week is just today", rng(p("this_week", new Date("2026-12-07T09:00:00Z"))), ["2026-12-07", "2026-12-07"]);
  eq("this month is the 1st to today", rng(p("this_month", NOW)), ["2026-12-01", "2026-12-10"]);
  eq("the previous month across a year boundary", rng(p("previous_month", new Date("2027-01-05T10:00:00Z"))), ["2026-12-01", "2026-12-31"]);
  eq("on the first of the month at 00:30 Douala the month so far is one day", rng(p("this_month", new Date("2026-11-30T23:30:00Z"))), ["2026-12-01", "2026-12-01"]);
  check("a full previous month is a 'month', a partial range is not", p("previous_month", NOW).period.kind === "month" && p("this_month", NOW).period.kind === "month_to_date");
  check("every period is Africa/Douala", ["today", "yesterday", "this_week", "this_month", "previous_month"].every((k) => p(k, NOW).period.timeZone === "Africa/Douala"));
  const bad = (from, to, now = NOW) => p("custom", now, { from, to }).error;
  eq("custom: a valid range", rng(p("custom", NOW, { from: "2026-11-15", to: "2026-12-10" })), ["2026-11-15", "2026-12-10"]);
  eq("custom: invalid or missing dates", [bad("2026-02-30", "2026-03-01"), bad("yesterday", "today"), bad(undefined, "2026-12-01"), bad("2026-12-01", 5)], ["invalid_period", "invalid_period", "invalid_period", "invalid_period"]);
  eq("custom: end before start / in the future (Douala today) / before 2020 / over 93 days", [bad("2026-12-05", "2026-12-01"), bad("2026-12-01", "2026-12-11"), bad("2019-12-01", "2019-12-10"), bad("2026-09-01", "2026-12-10")], ["range_order", "range_in_future", "range_too_old", "range_too_long"]);
  eq("custom: exactly 93 days is accepted, the day-of-boundary 'today' in Douala is allowed at 00:30", [p("custom", NOW, { from: "2026-09-09", to: "2026-12-10" }).ok, p("custom", LATE, { from: "2026-12-10", to: "2026-12-10" }).ok], [true, true]);
  check("the Business Toolkit period module never uses the UTC period helper of the other AI tools", !/ai\/tools\/period|resolvePeriod|getUTC(Date|Month|FullYear)\(\)/.test(strip(read("src/lib/ai/business/period.ts")).replace(/getUTCDay\(\)/g, "")) && !/tools\/period/.test(read("src/lib/ai/tools/definitions/business.ts")));
}

// ------------------------------------------------------------------------ get_sales: parity with the report builder, boundaries, currencies, voided, corrected
{
  setup();
  const today = await sales("today", { now: NOW });
  eq("hand-checked 'today' (10 December, Douala): revenue 33 000 = online 20 000 (paid 00:30 local) + invoice payment 10 000 + manual 3 000", [today.revenue_recorded_total, today.revenue_parts.online_sales_gross, today.revenue_parts.invoice_payments_recorded, today.revenue_parts.manual_sales, today.currency], [33000, 20000, 10000, 3000, "XAF"]);
  eq("...expenses 500, received directly 13 000, paid out 500, net cash 12 500 (online earnings are NOT cash)", [today.expenses_recorded, today.money_received_directly, today.money_paid_out, today.net_cash_movement], [500, 13000, 500, 12500]);
  eq("...online: gross 20 000, commission 2 000, net earnings 18 000", [today.online_sales.gross, today.online_sales.ringo_commission, today.online_sales.net_seller_earnings], [20000, 2000, 18000]);
  check("the parts add up to the total (nothing counted twice)", today.revenue_parts.online_sales_gross + today.revenue_parts.invoice_payments_recorded + today.revenue_parts.manual_sales + today.revenue_parts.other_income === today.revenue_recorded_total);
  eq("left out: the voided entry, the USD record, the currently-refunded order", [today.left_out_of_the_figures.voided_entries, today.left_out_of_the_figures.records_in_other_currencies, today.left_out_of_the_figures.orders_currently_marked_refunded], [1, 1, 1]);
  eq("counts per kind", [today.counts.paid_online_orders, today.counts.invoice_payments, today.counts.manual_sales], [1, 1, 1]);
  check("the other business (55 555, 88 888) is never in the figures", !JSON.stringify(today).includes("55555") && !JSON.stringify(today).includes("88888"));
  const yest = await sales("yesterday", { now: NOW });
  eq("'yesterday' (9 December): manual 2 000 + the order paid at 23:30 local 6 000 = 8 000", [yest.revenue_recorded_total, yest.money_received_directly], [8000, 2000]);
  const week = await sales("this_week", { now: NOW });
  eq("'this week' (7 to 10 December): 33 000 + 8 000 + 4 000 + the CORRECTED sale 5 500 = 50 500 (the voided original 5 000 and the Sunday 1 000 are out)", week.revenue_recorded_total, 50500);
  eq("the voided entries in the week are disclosed: the cancelled sale and the corrected original", week.left_out_of_the_figures.voided_entries, 2);
  const lateToday = await sales("today", { now: LATE });
  eq("at 00:30 Douala on the 10th (23:30 UTC on the 9th) 'today' is the 10th: the same 33 000", [lateToday.from, lateToday.revenue_recorded_total], ["2026-12-10", 33000]);
  const lateYesterday = await sales("yesterday", { now: LATE });
  eq("...and 'yesterday' is the 9th: 8 000, including the 23:30-local order", [lateYesterday.from, lateYesterday.revenue_recorded_total], ["2026-12-09", 8000]);
  const before = await sales("today", { now: BEFORE_MIDNIGHT });
  eq("at 23:30 Douala on the 9th 'today' is still the 9th: 8 000, and the 10th's records (incl. the 00:30-local order) are not in it", [before.from, before.revenue_recorded_total], ["2026-12-09", 8000]);
  const custom = await sales("custom", { now: NOW }, { from: "2026-12-01", to: "2026-12-10" });
  const ref = await RB.buildMonthlyReport(setup().owner, { year: 2026, month: 12, from: "2026-12-01", to: "2026-12-10", kind: "month_to_date", timeZone: "Africa/Douala" }, { now: NOW, sections: TR.LIGHT_SECTIONS });
  eq("report parity: the tool's custom range equals buildMonthlyReport for the same dates (revenue, expenses, cash, online)", [custom.revenue_recorded_total, custom.expenses_recorded, custom.money_received_directly, custom.money_paid_out, custom.online_sales.gross], [ref.revenue.totalMinor, ref.expenses.totalMinor, ref.cash.receivedDirectMinor, ref.cash.paidOutMinor, ref.online.grossMinor]);
  const month = await sales("this_month", { now: NOW });
  const mref = await RB.buildMonthlyReport(setup().owner, RP.periodFor(2026, 12, NOW).period, { now: NOW, sections: TR.LIGHT_SECTIONS });
  eq("report parity: 'this month' equals the Monthly report's current month to date", month.revenue_recorded_total, mref.revenue.totalMinor);
  const prev = await sales("previous_month", { now: NOW });
  eq("'previous month' (November) is the full month", [prev.from, prev.to, prev.revenue_recorded_total], ["2026-11-01", "2026-11-30", 1500]);
  const none = await sales("custom", { now: NOW }, { from: "2026-10-01", to: "2026-10-31" });
  eq("a period with no records is a real zero, not an error", [none.revenue_recorded_total, none.error], [0, undefined]);
  for (const [name, extra] of [["future end", { from: "2026-12-01", to: "2026-12-20" }], ["over 93 days", { from: "2026-01-01", to: "2026-12-10" }], ["bad date", { from: "2026-13-01", to: "2026-12-10" }]]) {
    const r = await sales("custom", { now: NOW }, extra);
    check(`custom range ${name}: a clear error and no figures`, !!r.error && r.revenue_recorded_total === undefined, JSON.stringify(r).slice(0, 150));
  }
  // currency separation
  const usd = setup({ currency: "USD", tables: { ...TABLES(), bk_entries: [entry("u1", "sale", "12.50", "2026-12-10", { currency: "USD" }), entry("u2", "sale", 9000, "2026-12-10")], product_orders: [] } });
  const u = await sales("today", { now: NOW });
  eq("USD profile: 12.50 is 12.5 (two decimals) and the XAF record is left out and disclosed, never converted", [u.currency, u.revenue_recorded_total, u.left_out_of_the_figures.records_in_other_currencies], ["USD", 12.5, 1]);
  void usd;
  check("every result states its definitions: invoice payments, not cash, no profit", today.definitions.some((d) => /invoice counts when a payment is recorded/.test(d)) && today.definitions.some((d) => /not profit/.test(d)) && !("profit" in today));
}

// ------------------------------------------------------------------------ get_business_summary and get_business_trends
{
  setup();
  const sum = (await call("get_business_summary", {})).json;
  const o = (await OV.overviewSummary(setup().owner, { now: NOW })).body.overview;
  eq("summary parity with the Overview: revenue, cash, online, receivables", [sum.this_month_so_far.revenue_recorded_total, sum.this_month_so_far.net_cash_movement, sum.online_sales_this_month.gross, sum.money_owed_to_the_business_as_of_today[0].outstanding], [o.revenue.totalMinor, o.cash.netMovementMinor, o.online.grossMinor, o.receivables.currencies[0].outstandingMinor]);
  eq("money owed is per currency and in major units (USD 100.00 is 100)", sum.money_owed_to_the_business_as_of_today.map((x) => [x.currency, x.outstanding, x.overdue]), [["XAF", 40000, 10000], ["USD", 100, 0]]);
  check("inventory counts and low-stock names come from the inventory reader", sum.inventory_as_of_today.tracked_products === 6 && sum.inventory_as_of_today.low_stock_items.length >= 1);
  check("the summary carries no recent-activity descriptions, no ids, no buyer data and no profit", !/description|buyer|customer_name|INV-2026-0001/i.test(JSON.stringify(sum)) && !("profit" in sum));
  const tr = (await call("get_business_trends", { months: 3, end: "this_month", include_year_to_date: false })).json;
  const sel = RP.periodFor(2026, 12, NOW).period;
  const ref = await TR.buildTrends(setup().owner, sel, 3, { now: NOW });
  eq("trend parity: the months equal buildTrends point by point", tr.months.map((m) => m.revenue_recorded), ref.points.map((p) => p.revenueMinor));
  eq("the latest month is month to date and compared with the SAME DAYS of the previous month", [tr.months[2].month_to_date, /same days \(2026-11-01 to 2026-11-10\)/.test(tr.comparison.compared_with)], [true, true]);
  eq("the comparison equals compareValues of the report figures", [tr.comparison.metrics.revenue.current, tr.comparison.metrics.revenue.previous, tr.comparison.metrics.revenue.change], [ref.comparison.metrics.revenue.currentMinor, ref.comparison.metrics.revenue.previousMinor, ref.comparison.metrics.revenue.changeMinor]);
  check("a zero or sign-changing base gives no percentage and says why", (() => { const m = Object.values(tr.comparison.metrics); return m.every((x) => x.percent_change !== null || typeof x.percent_unavailable === "string"); })());
  check("no year to date unless asked", tr.year_to_date === undefined);
  const withYtd = (await call("get_business_trends", { months: 6, end: "previous_month", include_year_to_date: true })).json;
  const yref = await TR.buildYtd(setup().owner, RP.periodFor(2026, 11, NOW).period, { now: NOW });
  eq("year to date parity with buildYtd, and it covers January to the end month", [withYtd.year_to_date.revenue_recorded, withYtd.year_to_date.from, withYtd.year_to_date.to, withYtd.comparison.compared_with.startsWith("the whole previous month")], [yref.totals.revenueMinor, "2026-01-01", "2026-11-30", true]);
  check("year to date has no receivables or inventory fields (snapshots are never summed)", !Object.keys(withYtd.year_to_date).some((k) => /receivable|inventory|outstanding|overdue|stock/i.test(k)) && /snapshots/.test(withYtd.year_to_date.note));
  for (const bad of [{ months: 4, end: "this_month", include_year_to_date: false }, { months: "6", end: "this_month", include_year_to_date: false }, { months: 12, end: "next_month", include_year_to_date: false }, { months: 6, end: "this_month" }, { months: 6, end: "this_month", include_year_to_date: "yes" }, null]) {
    const r = await call("get_business_trends", bad);
    check(`trends: invalid input ${JSON.stringify(bad)} is refused before any data is read`, r.isError && r.json.error === "invalid_input");
  }
  const t12 = await call("get_business_trends", { months: 12, end: "this_month", include_year_to_date: true });
  check("the largest request (12 months + year to date) fits the result size limit untruncated", t12.content.length < 6000 && !t12.json.truncated, String(t12.content.length));
  check("trend months are Africa/Douala calendar months (2026-12 is month to date on the 10th)", t12.json.months[11].month === "2026-12" && t12.json.months[11].month_to_date === true);
}

// ------------------------------------------------------------------------ get_outstanding_invoices
{
  const s = setup();
  const all = (await call("get_outstanding_invoices", { only_overdue: false, limit: 10 })).json;
  eq("totals per currency stay separate, in major units", all.totals_per_currency.map((x) => [x.currency, x.outstanding, x.overdue, x.open_invoices, x.not_linked_to_a_customer.open_invoices]), [["XAF", 40000, 10000, 4, 1], ["USD", 100, 0, 1, 0]]);
  eq("invoices: customer name, number, dates, amounts, overdue flag; an unlinked invoice is labelled", all.invoices.map((i) => [i.customer, i.invoice, i.amount_due, i.currency, i.overdue, i.days_overdue]), [["John Doe", "INV-2026-0003", 10000, "XAF", true, 39], ["(not linked to a customer)", "INV-2026-0005", 30000, "XAF", false, 0], ["John Smith", "INV-2026-0006", 100, "USD", false, 0]]);
  const text = JSON.stringify(all);
  check("no phone, e-mail, ids or reminder data are returned", !/has_email|has_phone|customer_id|"id"|reminder|@|\+237/.test(text) && !SECRETS.some((x) => text.includes(x)), text.slice(0, 300));
  const od = (await call("get_outstanding_invoices", { only_overdue: true, limit: 10 })).json;
  eq("only_overdue asks the existing receivables reader for overdue invoices only", [od.invoices.length, s.owner.admin.calls.filter(([n]) => n === "doc_receivable_invoices").pop()[1].p_overdue_only], [1, true]);
  const clamp = await call("get_outstanding_invoices", { only_overdue: false, limit: 500 });
  check("the limit is clamped by the server (never above 15)", s.owner.admin.calls.filter(([n]) => n === "doc_receivable_invoices").pop()[1].p_limit === 15 && !clamp.isError);
  const lowLimit = await call("get_outstanding_invoices", { only_overdue: false, limit: -3 });
  check("a nonsense limit becomes 1", !lowLimit.isError && s.owner.admin.calls.filter(([n]) => n === "doc_receivable_invoices").pop()[1].p_limit === 1);
  for (const bad of [{}, { only_overdue: "yes", limit: 5 }, { limit: 5 }, null]) check(`invalid input ${JSON.stringify(bad)} is refused`, (await call("get_outstanding_invoices", bad)).json.error === "invalid_input");
  setup({ recv: { data: null, error: { code: "42P01", message: "x" } } });
  const dead = (await call("get_outstanding_invoices", { only_overdue: false, limit: 5 })).json;
  check("when the receivables reader fails the tool says it could not read and returns no figures", dead.error === "could_not_read" && !dead.totals_per_currency);
}

// ------------------------------------------------------------------------ get_customer_statement
{
  const s = setup();
  const john = (await call("get_customer_statement", { person_name: "John" })).json;
  eq("'John' matches several customers: the tool asks, never guesses (names and archived flag only)", [john.status, john.matches.map((m) => m.name).sort(), john.total_matches >= 3], ["ambiguous", ["John Doe", "John Smith", "Johnny Archived"], true]);
  check("the ambiguous answer has no ids, phones, e-mails and no statement figures, and no statement was fetched", !/(^|[^a-z])id"|phone|email|outstanding/i.test(JSON.stringify(john)) && !s.owner.admin.calls.some(([n]) => n === "doc_customer_statement"));
  check("the archived customer is flagged in the choices", john.matches.find((m) => m.name === "Johnny Archived").archived === true);
  const twin = (await call("get_customer_statement", { person_name: "marie twin" })).json;
  check("two customers with exactly the same name: ambiguous with identical_names and an instruction to ask", twin.status === "ambiguous" && twin.identical_names === true && /tell them apart|open the customer/i.test(twin.note));
  const exact = (await call("get_customer_statement", { person_name: "john doe" })).json;
  eq("an exact name (any case) picks one customer", [exact.status, exact.customer.name], ["ok", "John Doe"]);
  check("the statement RPC was asked for that customer's id, found server-side in the owner's own contacts", s.owner.admin.calls.filter(([n]) => n === "doc_customer_statement").pop()[1].p_customer_id === C1);
  eq("totals per currency from the existing statement logic (invoiced 40 000, payments received 30 000, outstanding 10 000, overdue 10 000)", [exact.totals_per_currency[0].invoiced, exact.totals_per_currency[0].payments_received, exact.totals_per_currency[0].outstanding, exact.totals_per_currency[0].overdue], [40000, 30000, 10000, 10000]);
  eq("open invoices and the latest non-voided payments with their receipt numbers", [exact.open_invoices.map((i) => i.invoice), exact.latest_payments.map((p) => p.receipt)], [["INV-2026-0003"], ["RCT-2026-0007", "RCT-2026-0002"]]);
  const text = JSON.stringify(exact);
  check("no phone, e-mail, notes, payment reference or id is returned", !SECRETS.some((x) => text.includes(x)) && !text.includes("ref-secret") && !/"id"|invoice_id|customer_id/.test(text), text.slice(0, 200));
  const solo = (await call("get_customer_statement", { person_name: "Sarah" })).json;
  check("a single match is used even without an exact name (the RPC reports not found for a customer with no data here, handled)", solo.status === "ok" || solo.error === "could_not_read");
  const none = (await call("get_customer_statement", { person_name: "Nobody Atall" })).json;
  eq("no match: not_found with an instruction not to guess", [none.status, /do not guess/i.test(none.note)], ["not_found", true]);
  const other = (await call("get_customer_statement", { person_name: "John Other Business" })).json;
  check("another business's customer name finds nothing", other.status === "not_found" || other.matches?.every((m) => m.name !== "John Other Business"));
  const archived = (await call("get_customer_statement", { person_name: "Johnny Archived" })).json;
  check("an archived customer can be looked up (archived customers can still owe money)", archived.status === "ok" || archived.error === "could_not_read");
  const injected = (await call("get_customer_statement", { person_name: "x'); drop table bk_customers; --" })).json;
  check("a hostile name is only ever a search term (no match, no error, nothing dropped)", injected.status === "not_found" || injected.status === "ambiguous");
  for (const bad of [{}, { person_name: "J" }, { person_name: 5 }, { person_name: "x".repeat(81) }, null, { customer_id: C1 }]) check(`invalid input ${JSON.stringify(bad)?.slice(0, 40)} is refused`, (await call("get_customer_statement", bad)).json.error === "invalid_input");
  const big = setup();
  big.owner.admin.rpc = async (name, args) => (name === "doc_customer_statement" ? { data: { ...STATEMENT(C1).data, invoices: Array.from({ length: 200 }, (_, i) => ({ id: ID(900 + i), number: `N${i}`, status: "paid", currency: "XAF", total: "1", amount_paid: "1", amount_due: "0", issue_date: "2026-01-01", due_date: null, overdue: false })) }, error: null } : { data: null, error: { message: "x" } });
  const trunc = (await call("get_customer_statement", { person_name: "John Doe" })).json;
  check("a statement at the 200-invoice limit says it is incomplete", /200 invoices/.test(trunc.statement_incomplete || ""));
}

// ------------------------------------------------------------------------ get_inventory / get_low_stock
{
  const s = setup();
  const low = (await call("get_low_stock", { limit: 10 })).json;
  eq("low stock: out-of-stock first, then low, each with ITS OWN threshold", [low.out_of_stock.map((i) => i.product), low.low_stock.map((i) => [i.product, i.on_hand, i.low_stock_threshold])], [["Item 1", "Shea Butter"], [["Item 3", 4, 5], ["Black Soap", 2, 3]]]);
  eq("the lists come straight from the inventory reader's out and low filters (no threshold invented)", s.owner.admin.calls.filter(([n]) => n === "inv_overview").slice(-2).map(([, a]) => a.p_filter), ["out", "low"]);
  eq("summary counts", [low.summary.out_of_stock, low.summary.low_stock, low.summary.tracked_products], [2, 2, 6]);
  const inv = (await call("get_inventory", { name: "t-shirt", limit: 5 })).json;
  eq("a name search finds the product ('how many T-shirts do I have')", [inv.matches.map((i) => [i.product, i.on_hand, i.state]), inv.search_complete], [[["Nike T-Shirt", 40, "ok"]], true]);
  const accent = (await call("get_inventory", { name: "creme eclat", limit: 5 })).json;
  eq("the search ignores accents and case", accent.matches.map((i) => i.product), ["Crème Éclat"]);
  const states = (await call("get_inventory", { name: "item", limit: 15 })).json;
  check("tracking states pass through: legacy and untracked products are labelled, not given a made-up count", states.matches.some((i) => i.state === "legacy") && states.matches.some((i) => i.state === "untracked" && i.on_hand === null) && /legacy = a count exists but tracking was not adopted/.test(states.note));
  const list = (await call("get_inventory", { name: null, limit: 3 })).json;
  eq("no name: the first tracked products and the tracked total", [list.products.length, list.products_total_tracked, list.summary.estimated_stock_value, list.summary.currency], [3, 6, 54800, "XAF"]);
  check("the estimated stock value is described as informational, not profit or cash", /not an accounting valuation, profit or cash/.test(list.note));
  const miss = (await call("get_inventory", { name: "zzz", limit: 5 })).json;
  eq("no product matches: an empty, complete search", [miss.matches.length, miss.search_complete], [0, true]);
  // a large catalogue is scanned page by page, within bounds
  const many = Array.from({ length: 250 }, (_, i) => mkItem(10 + i, "ok", 10, { name: i === 240 ? "Hidden Gem Candle" : `Bulk ${i}` }));
  const bs = setup({ inv: invRpc(many) });
  const deep = (await call("get_inventory", { name: "candle", limit: 5 })).json;
  eq("a product on the third page of a 250-product catalogue is found, and the search is reported complete", [deep.matches.map((i) => i.product), deep.search_complete, bs.owner.admin.calls.filter(([n]) => n === "inv_overview").length], [["Hidden Gem Candle"], true, 3]);
  const huge = Array.from({ length: 700 }, (_, i) => mkItem(10 + i, "ok", 10, { name: `Bulk ${i}` }));
  setup({ inv: invRpc(huge) });
  const capped = (await call("get_inventory", { name: "zzz", limit: 5 })).json;
  eq("a catalogue over 500 products is scanned up to the bound and the search says it is incomplete", [capped.search_complete], [false]);
  check("get_inventory: missing fields fall back to defaults (list the tracked products)", !(await call("get_inventory", {})).isError);
  for (const bad of [{ name: 5, limit: 5 }, { name: "x".repeat(81), limit: 5 }, null]) check(`get_inventory: invalid input ${JSON.stringify(bad)?.slice(0, 30)} is refused`, (await call("get_inventory", bad)).json.error === "invalid_input");
  check("get_low_stock: a missing limit falls back to the default, a non-object is refused", !(await call("get_low_stock", {})).isError && (await call("get_low_stock", null)).json.error === "invalid_input");
  setup({ inv: () => ({ data: null, error: { code: "42P01", message: "x" } }) });
  check("when the inventory reader fails: could_not_read and no figures", (await call("get_low_stock", { limit: 5 })).json.error === "could_not_read");
}

// ------------------------------------------------------------------------ result size and the time limit
{
  setup();
  const sizes = {};
  for (const n of BUSINESS_NAMES) { const r = await call(n, SAMPLE[n]); sizes[n] = r.content.length; }
  check("every tool's typical result is small, far below the 6 000-character limit and never truncated", Object.values(sizes).every((x) => x < 4500), JSON.stringify(sizes));
  const biggest = await call("get_outstanding_invoices", { only_overdue: false, limit: 15 });
  check("the largest list (15 invoices) fits", !biggest.json.truncated);
  const hang = setup();
  hang.owner.admin.rpc = () => new Promise(() => {});
  const t0 = Date.now();
  const slow = await call("get_low_stock", { limit: 5 });
  const took = Date.now() - t0;
  check("a reader that never answers is cut off by the tool's own 8-second budget (before the registry's 10 s), with a clear message", slow.json.error === "too_slow" && took >= 7900 && took < 9900 && /shorter period|fewer months/.test(slow.json.note), `${took} ms ${slow.content.slice(0, 120)}`);
}

// ------------------------------------------------------------------------ double counting and source of truth
{
  const withDecoys = setup();
  const results = {};
  for (const n of BUSINESS_NAMES) results[n] = (await call(n, SAMPLE[n])).content;
  const touched = [...new Set(withDecoys.log.map((x) => x.table))].sort();
  check("the tools only read the Business Toolkit's own tables", touched.every((t) => ["bk_entries", "product_orders", "product_order_items", "bk_documents", "bk_customers"].includes(t)), touched.join());
  check("restaurant orders, music orders, ticket sales and platform customers are never read", !touched.some((t) => ["orders", "order_items", "music_orders", "music_order_items", "digital_tickets", "restaurant_customers", "music_customers", "ringo_customers", "customer_sessions", "event_ticket_types", "bookings"].includes(t)));
  const clean = setup({ tables: { ...TABLES(), orders: [], order_items: [], music_orders: [], music_order_items: [], digital_tickets: [], restaurant_customers: [] } });
  const cleanSales = (await call("get_sales", SAMPLE.get_sales)).content;
  setup();
  eq("removing the restaurant, music and ticket records changes nothing: the totals never included them", (await call("get_sales", SAMPLE.get_sales)).content, cleanSales);
  void clean;
  const all = JSON.stringify(results);
  check("the 99 999 restaurant order and the 88 888 music/ticket order appear in no result", !all.includes("99999") && !all.includes("88888"));
  const t = (await sales("today", { now: NOW }));
  check("Shop orders are counted once (inside the online sales, once in revenue), not added on top", t.revenue_recorded_total === 33000 && t.online_sales.gross === 20000);
  const noPaymentEntry = setup({ tables: { ...TABLES(), bk_entries: TABLES().bk_entries.filter((e) => e.category !== "invoice_payment") } });
  const np = await sales("today", { now: NOW });
  eq("an invoice payment is counted through its bookkeeping entry only: a paid invoice DOCUMENT adds nothing to revenue by itself", np.revenue_parts.invoice_payments_recorded, 0);
  void noPaymentEntry;
  setup();
  const rec = (await call("get_outstanding_invoices", { only_overdue: false, limit: 5 })).json;
  check("receivables are reported separately and never added to revenue or cash", rec.note.includes("not revenue and not cash") && !("revenue_recorded_total" in rec));
  const s7 = setup();
  await call("get_business_summary", {});
  check("the summary keeps revenue, cash, online earnings, money owed and stock as separate sections (no cross-concept total)", !/grand_total|combined|total_money|net_worth/i.test(read("src/lib/ai/tools/definitions/business.ts")));
  void s7;
}

// ------------------------------------------------------------------------ source scans, knowledge, prompt and scope
{
  const biz = strip(read("src/lib/ai/tools/definitions/business.ts")), gate = strip(read("src/lib/ai/business/gate.ts")), per = strip(read("src/lib/ai/business/period.ts"));
  check("the AI business code writes nothing and runs no SQL of its own: no insert/update/delete/upsert, no rpc call, no raw table access", ![biz, gate, per].some((s) => /\.(insert|update|delete|upsert|rpc)\s*\(/.test(s)) && !/\.from\("(?!users")/.test(biz + per) && (gate.match(/\.from\("/g) || []).length === 1);
  check("it reads only through the existing Business Toolkit functions", ["overviewSummary", "buildMonthlyReport", "buildTrends", "buildYtd", "receivablesSummary", "receivableInvoices", "contactStatement", "listCustomers", "inventoryOverview", "deriveTotals"].every((n) => new RegExp(`\\b${n}\\b`).test(biz)));
  check("it never imports the cookie session client or the AI draft machinery", !/createClient|ai\/drafts|ai_drafts/.test(biz + gate));
  check("the gate checks ai_enabled AND business_toolkit_enabled, the owner, and the toolkit's own gate", /ai_enabled/.test(gate) && /business_toolkit_enabled/.test(gate) && /resolveBookkeepingOwner/.test(gate) && /staff_not_supported/.test(gate) && /workspace_mismatch/.test(gate));
  const snapSrc = strip(read("src/lib/ai/context/snapshot.ts"));
  check("the snapshot offers the tools only for a toolkit category AND a plan with ai_enabled AND business_toolkit_enabled (and fails closed)", /categoryHasToolkit/.test(snapSrc) && /planRow\.ai_enabled === true/.test(snapSrc) && /loadToolkitPlanFlags/.test(snapSrc) && /catch \{\s*return \{ ai: false, toolkit: false \};/.test(strip(read("src/lib/ai/business/eligibility.ts"))) && /BOOKKEEPING_CATEGORIES/.test(strip(read("src/lib/ai/business/eligibility.ts"))));
  const mod = getKnowledgeModule("business_ai");
  check("knowledge: business_ai is registered once, live, with who/actions/prerequisites/limitations", !!mod && KNOWLEDGE_MODULES.filter((m) => m.id === "business_ai").length === 1 && mod.status === "live" && mod.whoCanUse && mod.actions.length >= 4 && mod.prerequisites.length >= 3 && mod.limitations.length >= 4);
  for (const [name, re] of [["lists every tool", BUSINESS_NAMES.every((n) => mod.body.includes(n))], ["Africa/Douala and the Douala day", /Africa\/Douala/.test(mod.body)], ["no profit", /profit is not reported/.test(mod.body)], ["source of truth: restaurant, music and ticket sales are separate", /Restaurant orders, music sales and ticket sales are NOT part of the Toolkit totals/.test(mod.body)], ["category availability: toolkit categories, stock only for Business & E-commerce, restaurant/music/events excluded", /Stock tracking \(get_inventory, get_low_stock, prepare_stock_adjustment\) exists only for Business & E-commerce/.test(mod.body) && /Restaurant, music and events pages do NOT have the Toolkit/.test(mod.body)], ["future writes need the Confirm and Apply card, not a typed yes", /Confirm and Apply button on a card; a typed "yes" in the chat will not apply anything/.test(mod.body)], ["ambiguous customers are asked, never guessed", /never guess and never invent a customer/.test(mod.body)], ["owner only, no staff", /no staff or accountant access/.test(mod.whoCanUse)]]) check(`knowledge: ${name}`, !!re);
  check("knowledge: it does not promise a date or a price", !/\b(soon|next week|coming in|will launch)\b/i.test(mod.body) && !/\b\d[\d\s.,]*\s?(xaf|fcfa|usd|eur)\b/i.test(mod.body));
  const stable = buildStableSystemPrompt();
  check("prompt: the outdated 'no sales data at all for business pages' claim is gone", !/business_ecommerce, real_estate, professional_services, transport_logistics, etc\.\), there is NO sales\/revenue data at all/.test(stable));
  check("prompt: the Business Toolkit tools are named, limited to eligible pages, read-only, with the toolkit definitions and no profit", BUSINESS_NAMES.every((n) => stable.includes(n)) && /ONLY for a page whose category has the Business Toolkit/.test(stable) && /profit is NEVER reported/.test(stable) && /These tools only READ/.test(stable));
  check("prompt: it stays category-aware (other categories still have no sales data to read; never every category)", /Never claim every category has sales data/.test(stable) && /For any OTHER page/.test(stable));
  check("prompt: the stable prefix still carries no volatile or per-user data", !/\d{4}-\d{2}-\d{2}T|Douala|demo@|username: /.test(stable));
  for (const id of ["reports", "customers", "invoices", "inventory", "receivables"]) check(`knowledge: the '${id}' module no longer says there is flatly no tool for the user's figures`, /Business tools of the business_ai topic/.test(getKnowledgeModule(id).body));

  const git = (args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/"));
  let changed = [];
  try { changed = [...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])]; } catch { /* not a git checkout */ }
  const ALLOWED = [
    /^src\/lib\/ai\/business\//, /^src\/lib\/ai\/tools\/(index|types)\.ts$/, /^src\/lib\/ai\/tools\/definitions\/(businessDrafts|drafts|restaurantPayments)\.ts$/, /^src\/lib\/ai\/drafts\//, /^src\/app\/api\/ai\/drafts\//, /^src\/components\/ai\/DraftCard\.tsx$/, /^src\/lib\/(bookkeeping\/(decision|recordEntry)|inventory\/access)\.ts$/, /^src\/app\/api\/bookkeeping\/entries\/route\.ts$/, /^supabase\/(migrations|support)\/2026-12-05_ringo_ai_business_drafts/, /^scripts\/tests\/(aiBusinessDrafts|aiBusinessApplySql|bookkeeping|customers|entryCorrection|inventory|receivables|reports)\.test\.m?js$/, /^src\/lib\/ai\/tools\/definitions\/business\.ts$/, /^src\/lib\/ai\/context\/snapshot\.ts$/, /^src\/lib\/ai\/prompts\/system\.ts$/,
    /^src\/lib\/ai\/knowledge\/index\.ts$/, /^src\/lib\/ai\/knowledge\/modules\/(businessAi|reports|customers|documents|inventory|receivables)\.ts$/, /^src\/lib\/i18n\/translations\.ts$/,
    /^scripts\/tests\/(aiBusinessTools\.test|phase7Harness|overview\.test)\.m?js$/, /^docs\//,
  ];
  // the later Record Sale release (standalone receipts, branding, payment details, print, navigation) is its own change set, covered by recordSaleUnit.test.mjs / recordSaleSql.test.mjs
  const RECORD_SALE = /^(src\/(lib\/(sales\/|documents\/|bookkeeping\/saleReceiptGuard\.ts$|corrections\/entries\.ts$)|components\/(sales\/|documents\/|overview\/OverviewView\.tsx$|reports\/ReportsTabs\.tsx$|dashboard\/DashboardShell\.tsx$)|app\/(api\/sales\/|d\/\[token\]\/|dashboard\/(sales|bookkeeping)\/|dashboard\/layout\.tsx$|dashboard\/reports\/entries\/page\.tsx$|api\/bookkeeping\/entries\/\[id\]\/void\/route\.ts$))|supabase\/(migrations|support)\/2026-12-06_record_sale_receipts_branding|scripts\/tests\/(recordSale(Unit|Sql)\.test|pgliteShim|documents|documentsShare|documentsAi|documentsUi|trends|overview|reports|customers|inventory|receivables|bookkeeping)(?:\.test)?\.m?js)/;
  // Ringo guidance (Profile Health / Ringo Home, Phase 1) is its own change set, covered by profileHealth.test.mjs
  const GUIDANCE_FILES = /^(src\/(app\/\[username\]\/page\.tsx$|app\/dashboard\/(home\/|analytics\/page\.tsx$)|components\/(guidance\/|AnalyticsView\.tsx$|Editor\.tsx$|editor\/ProfileCompletionCard\.tsx$|dashboard\/DashboardShell\.tsx$)|lib\/(profileHealth\/|i18n\/translations\.ts$|ai\/knowledge\/(index|navigation)\.ts$|ai\/knowledge\/modules\/guidance\.ts$))|scripts\/tests\/profileHealth\.test\.mjs$)/;
  const outside = changed.filter((f) => !ALLOWED.some((re) => re.test(f)) && !RECORD_SALE.test(f) && !GUIDANCE_FILES.test(f));
  check("only the intended Ringo AI business files changed (AI tools and drafts, gate, registry, snapshot, prompt, knowledge, labels, the shared recordEntry/category gate, the un-applied migration, tests)", outside.length === 0, outside.join(", "));
  check("no package file, no Toolkit/documents/receivables/reports/customers library and no other API route changed; the only migration is the un-applied AI drafts one", !changed.filter((f) => !RECORD_SALE.test(f)).some((f) => /^(package(-lock)?\.json$|src\/lib\/(documents|receivables|reports|customers|overview|corrections)\/|src\/app\/api\/(?!ai\/drafts\/|bookkeeping\/entries\/route\.ts))/.test(f) || (/^supabase\//.test(f) && !/2026-12-05_ringo_ai_business_drafts/.test(f))), changed.join());
}

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${c.pass} passed, ${c.fail} failed`);
process.exit(c.fail ? 1 : 0);
