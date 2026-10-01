// Business Toolkit Phase 7D (customers needing attention): the REAL attention builder, route file, tab list, screen and translations run against an
// in-memory read-only fake; only the session resolver is stubbed. No network, no database, no migration, nothing persisted.
//   Run:  node scripts/tests/customerAttention.test.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { SRC, REPO, PROFILE, OTHER, USER, ID, makeJiti, mkOwner, counters } from "./phase7Harness.mjs";

const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
const tmp = [];
const jiti = makeJiti(tmp, "attn");
const A = jiti(path.join(SRC, "lib/customers/attention.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const route = jiti(path.join(SRC, "app/api/customers/attention/route.ts"));

console.error = () => {};
const { c, check, eq } = counters();
const NOW = new Date("2026-12-10T10:00:00Z");
const C = (n) => ID(200 + n), D = (n) => ID(300 + n), PAY = (n) => ID(400 + n);

const cust = (n, name, created, extra = {}) => ({ id: C(n), profile_id: PROFILE, name, phone: `+2376000000${n}`, email: `${name.toLowerCase().replace(/ /g, "")}@secret.test`, created_at: created, archived_at: null, ...extra });
const inv = (n, status, total, paid, issue, extra = {}) => ({ id: D(n), profile_id: PROFILE, doc_type: "invoice", status, currency: "XAF", total: String(total), amount_paid: String(paid), issue_date: issue, due_date: null, ...extra });
const link = (n, customerN) => ({ document_id: D(n), profile_id: PROFILE, customer_id: customerN === null ? null : C(customerN) });

const FIXTURE = () => ({
  bk_customers: [
    cust(1, "Alice", "2026-01-05T09:00:00Z"), cust(2, "Bob", "2026-02-01T09:00:00Z"), cust(3, "Carol", "2026-01-10T09:00:00Z", { archived_at: "2026-06-01T00:00:00Z" }),
    cust(4, "Dave", "2026-11-20T09:00:00Z"), cust(5, "Erin", "2026-09-01T09:00:00Z"), cust(6, "Frank", "2026-09-15T09:00:00Z"), cust(7, "Gina", "2026-09-20T09:00:00Z"),
    cust(8, "Hank", "2026-11-10T12:00:00Z"), cust(9, "Old Archived", "2026-03-01T09:00:00Z", { archived_at: "2026-07-01T00:00:00Z" }), cust(10, "Voidy", "2026-08-01T09:00:00Z"),
    cust(11, "Ivy", "2026-11-09T12:00:00Z"), cust(12, "Alice", "2026-05-05T09:00:00Z"),
    { ...cust(99, "Other Business Customer", "2026-01-01T09:00:00Z"), id: ID(299), profile_id: OTHER },
  ],
  bk_documents: [
    inv(1, "issued", 30000, 0, "2026-12-05", { due_date: "2026-12-30" }), inv(2, "partially_paid", 10000, 4000, "2026-12-01", { due_date: "2026-12-20" }),
    inv(3, "issued", 10000, 0, "2026-10-01", { due_date: "2026-10-31" }), inv(4, "issued", 20000, 0, "2026-09-01", { due_date: "2026-11-20" }),
    inv(5, "paid", 7000, 7000, "2026-11-01"), inv(6, "issued", 5000, 0, "2026-12-02"), inv(7, "paid", 8000, 8000, "2026-03-01"), inv(8, "paid", 9000, 9000, "2026-07-01"),
    inv(9, "void", 4000, 0, "2026-11-20"), inv(10, "issued", "100.00", "0.00", "2026-12-06", { currency: "USD" }), inv(11, "issued", 3000, 0, "2026-11-01", { due_date: "2026-12-01" }),
    { ...inv(50, "issued", 77777, 0, "2026-12-05"), id: ID(350), profile_id: OTHER },
  ],
  bk_document_customer_links: [link(1, 1), link(2, 1), link(3, 2), link(4, 3), link(5, 6), link(6, null), link(7, 7), link(8, 10), link(9, 5), link(10, 1), link(11, 12), { document_id: ID(350), profile_id: OTHER, customer_id: ID(299) }],
  bk_document_payments: [
    { id: PAY(1), profile_id: PROFILE, invoice_id: D(7), paid_on: "2026-11-20", voided_at: null },
    { id: PAY(2), profile_id: PROFILE, invoice_id: D(8), paid_on: "2026-11-01", voided_at: "2026-11-02T08:00:00Z" },
    { id: PAY(3), profile_id: PROFILE, invoice_id: D(3), paid_on: "2025-01-01", voided_at: null },
  ],
});
const SUMMARY = (extra = {}) => ({ data: { today: "2026-12-10", profile_currency: "XAF", currencies: [
  { currency: "XAF", outstanding: "79000", overdue: "33000", invoice_count: 6, overdue_count: 3,
    customers: [
      { customer_id: C(1), name: "Alice", archived: false, outstanding: "36000", overdue: "0", invoice_count: 2, oldest_due_date: "2026-12-20" },
      { customer_id: C(2), name: "Bob", archived: false, outstanding: "10000", overdue: "10000", invoice_count: 1, oldest_due_date: "2026-10-31" },
      { customer_id: C(3), name: "Carol", archived: true, outstanding: "20000", overdue: "20000", invoice_count: 1, oldest_due_date: "2026-11-20" },
      { customer_id: C(12), name: "Alice", archived: false, outstanding: "3000", overdue: "3000", invoice_count: 1, oldest_due_date: "2026-12-01" },
    ], unassigned: { outstanding: "5000", overdue: "0", invoice_count: 1 } },
  { currency: "USD", outstanding: "100.00", overdue: "0.00", invoice_count: 1,
    customers: [{ customer_id: C(1), name: "Alice", archived: false, outstanding: "100.00", overdue: "0.00", invoice_count: 1, oldest_due_date: null }], unassigned: { outstanding: "0", overdue: "0", invoice_count: 0 } },
], ...extra }, error: null });
const owner = (tables = FIXTURE(), over = {}, log = [], opts = {}) => mkOwner(tables, { doc_receivables_summary: SUMMARY(), ...over }, log, opts);
const attn = async (o = owner(), now = NOW) => (await A.customerAttention(o, { now })).body.attention;
const ids = (items) => items.map((i) => `${i.customerId}`);

// ------------------------------------------------------------------------ pure helpers and constants
{
  eq("the approved windows and caps are code constants", [A.RECENT_INVOICE_DAYS, A.QUIET_DAYS, A.QUIET_MIN_CUSTOMER_AGE_DAYS, A.LIST_CAP, A.RECEIVABLES_CUSTOMER_CAP], [30, 90, 30, 100, 100]);
  eq("date shifting is calendar arithmetic across month, leap-year and year boundaries", [A.shiftDateKey("2026-03-01", -1), A.shiftDateKey("2028-03-01", -1), A.shiftDateKey("2026-01-01", -1), A.shiftDateKey("2026-12-10", -90), A.shiftDateKey("2026-12-10", -30)], ["2026-02-28", "2028-02-29", "2025-12-31", "2026-09-11", "2026-11-10"]);
}

// ------------------------------------------------------------------------ overdue and outstanding (from the debtors summary)
{
  const a = await attn();
  eq("overdue: customers with an overdue amount, largest first; an archived customer that owes money stays, flagged", a.overdue.items.map((r) => [r.name, r.archived, r.currency, r.overdueMinor, r.outstandingMinor, r.invoiceCount, r.oldestDueDate, r.daysOverdue]), [
    ["Carol", true, "XAF", 20000, 20000, 1, "2026-11-20", 20], ["Bob", false, "XAF", 10000, 10000, 1, "2026-10-31", 40], ["Alice", false, "XAF", 3000, 3000, 1, "2026-12-01", 9]]);
  eq("overdue total", a.overdue.total, 3);
  eq("outstanding / not yet due: customers who owe but have nothing overdue, per currency (no overdue date is shown for them)", a.outstanding.items.map((r) => [r.name, r.currency, r.minorDigits, r.outstandingMinor, r.overdueMinor, r.oldestDueDate, r.daysOverdue, r.invoiceCount]), [["Alice", "USD", 2, 10000, 0, null, null, 1], ["Alice", "XAF", 0, 36000, 0, null, null, 2]]);
  check("a customer with overdue money is only in the overdue list, never also in 'not yet due'", !a.outstanding.items.some((r) => [C(2), C(3), C(12)].includes(r.customerId)));
  eq("two different customers with the SAME name stay two rows (identity is the id, never the name)", ids(a.overdue.items).filter((x) => x === C(1) || x === C(12)), [C(12)]);
  check("customers are keyed by bk_customers.id: every row has a customer id, and the screen links by it", [...a.overdue.items, ...a.outstanding.items, ...a.recent.items, ...a.quiet.items].every((r) => /^[0-9a-f-]{36}$/.test(r.customerId)));
  eq("unassigned open invoices are shown as a count and an amount per currency (not assigned, not guessed)", a.unassigned, [{ currency: "XAF", minorDigits: 0, outstandingMinor: 5000, overdueMinor: 0, invoiceCount: 1 }]);
  eq("no cap is reported when every open invoice belongs to a listed customer or to the unassigned bucket", a.receivables.omitted, []);
  check("amounts of different currencies are never added: there is no combined field anywhere", !JSON.stringify(Object.keys(a)).match(/total_?minor|combined|grand/i) && a.outstanding.items.filter((r) => r.customerId === C(1)).length === 2);
}

// ------------------------------------------------------------------------ cap disclosure and list caps
{
  const base = SUMMARY().data;
  const more = { ...base, currencies: [{ ...base.currencies[0], invoice_count: 11 }, base.currencies[1]] };
  const a = await attn(owner(FIXTURE(), { doc_receivables_summary: { data: more, error: null } }));
  eq("open invoices that belong to customers NOT in the top-100 list are detected exactly (11 - 1 unassigned - 5 listed = 5) and disclosed per currency", a.receivables.omitted, [{ currency: "XAF", omittedInvoices: 5 }]);
  const many = Array.from({ length: 150 }, (_, i) => ({ customer_id: ID(5000 + i), name: `Debtor ${i}`, archived: false, outstanding: String(1000 + i), overdue: String(1000 + i), invoice_count: 1, oldest_due_date: "2026-11-01" }));
  const big = { ...base, currencies: [{ currency: "XAF", outstanding: "1", overdue: "1", invoice_count: 150, customers: many, unassigned: { outstanding: "0", overdue: "0", invoice_count: 0 } }] };
  const b = await attn(owner(FIXTURE(), { doc_receivables_summary: { data: big, error: null } }));
  eq("a list is capped at 100 rows, the true count is reported, largest first", [b.overdue.items.length, b.overdue.total, b.overdue.items[0].overdueMinor, b.overdue.items[99].overdueMinor], [100, 150, 1149, 1050]);
  const none = await attn(owner(FIXTURE(), { doc_receivables_summary: { data: null, error: { code: "PGRST202", message: "x" } } }));
  check("when the debtors summary is unavailable that is reported (not an empty 'all clear'), and the other lists still load", none.receivables.available === false && none.overdue.total === 0 && none.recent.available && none.quiet.available);
}

// ------------------------------------------------------------------------ recently invoiced and unpaid
{
  const a = await attn();
  eq("recent: customers with an invoice issued in the last 30 days that is not fully paid; per currency, summed per customer", a.recent.items.map((r) => [r.name, r.currency, r.minorDigits, r.unpaidMinor, r.invoiceCount, r.latestIssueDate]), [["Alice", "USD", 2, 10000, 1, "2026-12-06"], ["Alice", "XAF", 0, 36000, 2, "2026-12-05"]]);
  const all = JSON.stringify(a.recent.items);
  check("not in the list: an old invoice (2 Oct), a fully paid one, a void one, one issued 40 days ago (1 Nov), an unlinked one (the unassigned bucket) and the other business's", !a.recent.items.some((r) => [C(2), C(3), C(6), C(12), C(5)].includes(r.customerId)) && !all.includes("77777"));
  eq("recent: nothing capped", [a.recent.capped, a.recent.total], [false, 2]);
  const t = FIXTURE();
  for (let i = 0; i < 501; i++) { const n = 1000 + i; t.bk_customers.push(cust(n, `Bulk ${n}`, "2026-01-01T09:00:00Z")); t.bk_documents.push(inv(n, "issued", 100, 0, "2026-12-05")); t.bk_document_customer_links.push(link(n, n)); }
  const big = await attn(owner(t));
  check("a bound of 500 invoices is read; when it is reached the list says so", big.recent.capped === true && big.recent.items.length === 100 && big.recent.total <= 500 + 2, `${big.recent.capped} ${big.recent.items.length} ${big.recent.total}`);
}

// ------------------------------------------------------------------------ quiet customers
{
  const a = await attn();
  eq("quiet: active customers older than 30 days with no invoice and no non-voided payment in the last 90 days, oldest customer first", a.quiet.items.map((r) => [r.name, r.customerSince]), [["Voidy", "2026-08-01"], ["Erin", "2026-09-01"], ["Ivy", "2026-11-09"]]);
  const q = JSON.stringify(a.quiet.items);
  check("not quiet: Alice/Bob (invoice in 90 days), Frank (paid invoice), Gina (a payment on an old invoice)", !["Alice", "Bob", "Frank", "Gina"].some((n) => q.includes(`"${n}"`)));
  check("archived customers are never quiet (Carol, Old Archived)", !q.includes("Carol") && !q.includes("Old Archived"));
  check("a customer added only 20 days ago (Dave) and one added exactly 30 days ago (Hank) are not yet quiet; one added 31 days ago (Ivy) is", !q.includes("Dave") && !q.includes("Hank") && q.includes("Ivy"));
  check("a VOIDED payment and a VOID invoice do not count as activity (Voidy and Erin stay quiet)", q.includes("Voidy") && q.includes("Erin"));
  check("the other business's customer never appears", !q.includes("Other Business"));
  eq("quiet flags: complete, not capped", [a.quiet.incomplete, a.quiet.customersCapped, a.quiet.total], [false, false, 3]);
  const t = FIXTURE();
  for (let i = 0; i < 2001; i++) t.bk_documents.push(inv(2000 + i, "paid", 1, 1, "2026-12-01", { id: ID(60000 + i) }));
  const inc = await attn(owner(t));
  check("when the activity read hits its bound the quiet list is flagged as possibly incomplete", inc.quiet.incomplete === true && inc.quiet.available === true);
  const t2 = FIXTURE();
  for (let i = 0; i < 1001; i++) t2.bk_customers.push(cust(3000 + i, `Old ${i}`, "2026-01-02T09:00:00Z"));
  const capped = await attn(owner(t2));
  check("more than 1 000 candidate customers: only the first 1 000 are checked and the list says so; at most 100 rows are returned with the true count", capped.quiet.customersCapped === true && capped.quiet.items.length === 100 && capped.quiet.total > 100);
}

// ------------------------------------------------------------------------ privacy, scoping, no persistence
{
  const log = [];
  const o = owner(FIXTURE(), {}, log);
  const a = await attn(o);
  const text = JSON.stringify(a);
  check("no phone number and no e-mail of any customer appears in the response", !/\+2376000000|@secret\.test/.test(text));
  check("no phone or e-mail column is selected at all, and no name is used as a filter or key", log.every((x) => !/phone|email|notes/.test(x.select)) && log.every((x) => !x.eq.some(([col]) => /^(name|phone|email)/.test(col))), log.map((x) => x.select).join(" | "));
  eq("only the four business tables are read", [...new Set(log.map((x) => x.table))].sort(), ["bk_customers", "bk_document_customer_links", "bk_document_payments", "bk_documents"]);
  check("every read is scoped to the caller's own profile; another business's customers, invoices, links and payments are absent", log.every((x) => x.eq.some(([col, v]) => col === "profile_id" && v === PROFILE)) && !text.includes("77777") && !text.includes("Other Business"));
  eq("the debtors summary is called once, with the owner's own ids", o.admin.calls.map((x) => x[0]), ["doc_receivables_summary"]);
  eq("...with the profile and user from the session", [o.admin.calls[0][1].p_profile_id, o.admin.calls[0][1].p_actor_user_id], [PROFILE, USER]);
  const src = strip(read("src/lib/customers/attention.ts"));
  check("nothing is written or stored: no insert/update/delete/upsert, the only RPC is the existing read-only summary", !/\.(insert|update|delete|upsert)\s*\(/.test(src) && (src.match(/\.rpc\(/g) || []).length === 1 && /doc_receivables_summary/.test(src));
  check("no platform customer identity is read or merged (accounts, sessions, login codes, connections, subscribers, follow-ups, restaurant or music customers)", !/ringo_customers|customer_sessions|customer_login_codes|customer_connections|community_subscribers|customer_followups|restaurant_customers|music_customers|product_orders|orders\b/.test(src));
  check("no table of its own: no create/alter, no task, reminder or follow-up record is created", !/create table|alter table|bk_reminders|bk_customer_events/i.test(src));
  const failing = owner(); failing.profile = undefined;
  const r = await A.customerAttention(failing, { now: NOW });
  check("an unexpected failure is a generic 500", r.status === 500 && JSON.stringify(r.body) === JSON.stringify({ error: "internal_error" }));
  const failLinks = await attn(owner(FIXTURE(), {}, [], { fail: (table) => table === "bk_document_customer_links" }));
  check("an unreadable link table degrades only the recent and quiet lists (marked unavailable); the debtors lists are intact", failLinks.recent.available === false && failLinks.quiet.available === false && failLinks.overdue.total === 3);
}

// ------------------------------------------------------------------------ route
{
  globalThis.__owner = { ok: true, owner: owner() };
  const ok = await route.GET();
  const body = await ok.json();
  check("the route answers the owner with the attention lists", ok.status === 200 && body.attention?.overdue?.total === 3);
  check("private, no-store, noindex, no referrer", /private/.test(ok.headers.get("cache-control")) && /no-store/.test(ok.headers.get("cache-control")) && /noindex/.test(ok.headers.get("x-robots-tag")) && ok.headers.get("referrer-policy") === "no-referrer");
  for (const reason of ["not_signed_in", "no_profile", "not_owner", "demo_profile", "category_not_enabled", "plan_not_enabled"]) {
    globalThis.__owner = { ok: false, reason };
    const r = await route.GET();
    const b = await r.json();
    check(`denied (${reason}): ${r.status}, no data`, r.status >= 401 && r.status <= 403 && !b.attention);
  }
  const rs = strip(read("src/app/api/customers/attention/route.ts"));
  check("the route file exports only GET, takes no input and goes through withOwner", (rs.match(/export async function (\w+)/g) || []).join() === "export async function GET" && /withOwner/.test(rs) && !/request|searchParams|profile_?id/i.test(rs.replace(/\(owner\) =>/g, "")));
}

// ------------------------------------------------------------------------ screen, navigation, EN/FR
{
  const ui = strip(read("src/components/customers/AttentionView.tsx"));
  check("the screen loads from the one attention route and writes nothing", /callApi\("GET", "\/api\/customers\/attention"\)/.test(ui) && !/callApi\("(POST|PUT|PATCH|DELETE)"/.test(ui) && !/fetch\(/.test(ui) && !/localStorage|sessionStorage/.test(ui));
  check("rows are keyed and linked by customer id, never by name, phone or e-mail", /key=\{`\$\{r\.customerId\}-\$\{r\.currency\}`\}/.test(ui) && /\/dashboard\/customers\/\$\{id\}/.test(ui) && !/key=\{[^}]*name/.test(ui) && !/phone|email/i.test(ui));
  check("the screen adds no money values and never combines currencies (amounts come from the server, grouped by currency)", !/Minor\s*[+]\s*\w|[+]\s*\w+\.\w*Minor/.test(ui) && /currencyHeading/.test(ui) && /groups\(/.test(ui));
  check("loading, empty, error and unavailable states; archived badge; cap and incomplete disclosures; unassigned bucket with a link to Debtors", /u\.loading/.test(ui) && /empty\[active\]/.test(ui) && /role="alert"/.test(ui) && /u\.receivablesUnavailable/.test(ui) && /u\.archivedBadge/.test(ui) && /u\.capRows/.test(ui) && /u\.capReceivables/.test(ui) && /u\.capRecent/.test(ui) && /u\.quietIncomplete/.test(ui) && /u\.quietCapped/.test(ui) && /u\.unassignedTitle/.test(ui) && /\/dashboard\/documents\/receivables/.test(ui));
  check("four lists as accessible tabs with counts", /role="tablist"/.test(ui) && /role="tab"/.test(ui) && /aria-selected/.test(ui) && /role="tabpanel"/.test(ui) && /counts\[k\]/.test(ui));
  const tabs = strip(read("src/components/customers/CustomersTabs.tsx"));
  check("Customers navigation: Directory and Needs attention", /href: "\/dashboard\/customers", label: t\.customerAttention\.ui\.tabDirectory/.test(tabs) && /href: "\/dashboard\/customers\/attention", label: t\.customerAttention\.ui\.tabAttention/.test(tabs));
  check("both pages show the tabs; the attention page exists", /CustomersTabs/.test(read("src/app/dashboard/customers/page.tsx")) && /AttentionView/.test(read("src/app/dashboard/customers/attention/page.tsx")) && /CustomersTabs/.test(read("src/app/dashboard/customers/attention/page.tsx")));
  check("the Business Overview links to Needs attention", /\/dashboard\/customers\/attention/.test(read("src/components/overview/OverviewView.tsx")) && /u\.openAttention/.test(read("src/components/overview/OverviewView.tsx")));
  let diff = "x";
  try { diff = execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src/components/customers/CustomersView.tsx", "src/components/customers/CustomerProfileView.tsx", "src/components/customers/CustomerForm.tsx", "src/components/customers/PossibleOrders.tsx", "src/components/customers/shared.tsx", "src/lib/customers/handlers.ts", "src/lib/customers/access.ts", "src/lib/customers/match.ts", "src/lib/customers/profile.ts", "src/lib/customers/search.ts", "src/lib/customers/constants.ts", "src/app/api/customers/route.ts", "src/app/dashboard/customers/layout.tsx", "src/app/dashboard/customers/[id]", "src/app/api/customers/[id]", "src/components/receivables", "src/lib/receivables", "src/app/api/receivables"], { cwd: REPO }).toString().trim(); } catch { diff = ""; }
  check("Phase 6 and Phase 3 customer code is untouched (directory, profile, matching, handlers, contacts, debtors)", diff === "", diff);

  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  eq("EN and FR customerAttention namespaces have exactly the same keys", flat(translations.en.customerAttention).sort(), flat(translations.fr.customerAttention).sort());
  for (const lang of ["en", "fr"]) {
    const U = translations[lang].customerAttention.ui;
    check(`${lang}: function strings return text`, [U.helpRecent(30), U.helpQuiet(90, 30), U.openInvoices(1), U.openInvoices(3), U.invoicesRecent(1), U.invoicesRecent(2), U.oldestDue("1 Dec", 1), U.oldestDue("1 Dec", 9), U.latestInvoice("x"), U.customerSince("x"), U.currencyHeading("XAF"), U.unassignedBody(1, "5", "0"), U.unassignedBody(2, "5", "0"), U.capReceivables("XAF", 100, 1), U.capReceivables("XAF", 100, 4), U.capRows(100, 150), U.capRecent(500), U.quietCapped(1000)].every((s) => typeof s === "string" && s.length > 2));
    check(`${lang}: the intro says nothing is saved, sent or created`, /saved|enregistr/i.test(U.intro) && /reminder|rappel/i.test(U.intro) && /task|tâche/i.test(U.intro));
  }
  const used = new Set([...read("src/components/customers/AttentionView.tsx").matchAll(/\bu\.([A-Za-z]+)/g)].map((m) => m[1]));
  check("every translation key the screen uses exists in both languages", [...used].every((k) => k in translations.en.customerAttention.ui && k in translations.fr.customerAttention.ui), [...used].filter((k) => !(k in translations.en.customerAttention.ui)).join());
  const en = Object.entries(translations.en.customerAttention.ui).filter(([, v]) => typeof v === "string"), fr = translations.fr.customerAttention.ui;
  check("French strings are really translated; the tab, badge and card names differ", en.every(([k, v]) => v.length <= 14 || v !== fr[k]) && ["tabDirectory", "tabAttention", "archivedBadge", "cardQuiet", "cardOverdue"].every((k) => translations.en.customerAttention.ui[k] !== fr[k]), en.filter(([k, v]) => v.length > 14 && v === fr[k]).map(([k]) => k).join());
  check("Overview link text exists in both languages", translations.en.overview.ui.openAttention && translations.fr.overview.ui.openAttention && translations.en.overview.ui.openAttention !== translations.fr.overview.ui.openAttention);
}

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${c.pass} passed, ${c.fail} failed`);
process.exit(c.fail ? 1 : 0);
