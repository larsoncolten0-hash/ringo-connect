// Business Toolkit Phase 4 (inventory & stock control): the application layer. The REAL validation, error mapping, API handlers and route files
// run here against in-memory fakes; only the session resolver is stubbed. No network, no database, nothing applied. The SQL itself (adoption,
// movements, concurrency, idempotency, ledger, refund restock, guard trigger, RLS, rollback) is covered by
// supabase/support/tests/inventory_foundation.test.mjs (PGlite).
//   Run:  node scripts/tests/inventory.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { createRequire } from "module";
import { isPhase8AuthFile } from "./phase8Files.mjs"; // Phase 8: the exact auth / env files of "Continue with Google / Apple" (see phase8Files.mjs)
import { isPhase16ProtectedFile } from "./phase16Files.mjs"; // security remediation: the exact files (billing webhook / upgrade stub, package files, next-env.d.ts) it changes on purpose
import { fileURLToPath } from "url";
import { OWNER_WORKSPACE_FILES } from "./ownerWorkspaceFiles.mjs"; // Owner Workspace UX pass: the exact files it changes on purpose
// Record Sale (standalone receipts, branding, payment details, print, footer, navigation): the files that release changes on purpose. See recordSaleUnit.test.mjs / recordSaleSql.test.mjs.
const RECORD_SALE_FILES = /^(src\/(lib\/(sales\/|documents\/pdf\/(logo|render|templates\/v[12])|documents\/(handlers|http|snapshot|types|validation|brand|actions|publicShare)\.ts$|bookkeeping\/(saleReceiptGuard|recordEntry)\.ts$|corrections\/entries\.ts$)|components\/(sales\/|documents\/(BusinessProfileForm|DocumentActions|DocumentView|PublicDocumentView|PrintButton|shared)\.tsx$|overview\/OverviewView\.tsx$|reports\/ReportsTabs\.tsx$|dashboard\/DashboardShell\.tsx$)|app\/(api\/sales\/|d\/\[token\]\/(page\.tsx$|logo\/)|dashboard\/(sales|bookkeeping)\/|dashboard\/layout\.tsx$|dashboard\/reports\/entries\/page\.tsx$|api\/bookkeeping\/entries\/\[id\]\/void\/route\.ts$))|supabase\/(migrations|support)\/2026-12-06_record_sale_receipts_branding)/;

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8").replace(/\r\n/g, "\n");
const strip = (s) => s.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

const tmp = [];
const mk = (name, body) => { const f = path.join(os.tmpdir(), `inv_${name}_${process.pid}.cjs`); fs.writeFileSync(f, body); tmp.push(f); return f; };
const accessStub = mk("access", "module.exports = { resolveBookkeepingOwner: async () => globalThis.__owner };");
const serverStub = mk("server", "module.exports = { createAdminClient: () => globalThis.__admin };");
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/bookkeeping/access": accessStub, "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const V = jiti(path.join(SRC, "lib/inventory/validation.ts"));
const E = jiti(path.join(SRC, "lib/inventory/http.ts"));
const UE = jiti(path.join(SRC, "lib/inventory/uiErrors.ts"));
const H = jiti(path.join(SRC, "lib/inventory/handlers.ts"));
const K = jiti(path.join(SRC, "lib/inventory/constants.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));
const route = (p) => jiti(path.join(SRC, "app/api/inventory", p, "route.ts"));

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 300)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const ID = (n) => `44444444-4444-4444-8444-${String(n).padStart(12, "0")}`;
const RID = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
const OWNER = { userId: "11111111-1111-4111-8111-111111111111", profileId: "22222222-2222-4222-8222-222222222222" };
const makeAdmin = (responses = {}) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); const r = responses[name]; return typeof r === "function" ? r(args) : r ?? { data: null, error: null }; } }; };
const mkOwner = (responses = {}) => ({ userId: OWNER.userId, profile: { id: OWNER.profileId, currency: "XAF" }, supabase: {}, admin: makeAdmin(responses) });

// ------------------------------------------------------------------------ validation
{
  const ok = (r) => r.ok === true;
  eq("start: opening 12 + threshold 3", V.parseStartBody({ opening_quantity: 12, low_stock_threshold: 3, client_request_id: RID(1) }), { ok: true, value: { opening_quantity: 12, low_stock_threshold: 3, client_request_id: RID(1) } });
  check("start: opening may be omitted (adoption of a legacy count)", ok(V.parseStartBody({ client_request_id: RID(1) })));
  check("start: 0 is a valid opening quantity", ok(V.parseStartBody({ opening_quantity: 0, client_request_id: RID(1) })));
  for (const [name, v] of [["negative", -1], ["fraction", 1.5], ["string", "5"], ["too big", K.STOCK_LIMITS.maxCount + 1], ["NaN", NaN]]) check(`start: opening ${name} rejected`, !ok(V.parseStartBody({ opening_quantity: v, client_request_id: RID(1) })));
  check("start: request id required", !ok(V.parseStartBody({ opening_quantity: 1 })) && !ok(V.parseStartBody({ opening_quantity: 1, client_request_id: "x" })));
  check("start: threshold bounds", !ok(V.parseStartBody({ low_stock_threshold: -1, client_request_id: RID(1) })) && !ok(V.parseStartBody({ low_stock_threshold: 1_000_001, client_request_id: RID(1) })) && ok(V.parseStartBody({ low_stock_threshold: 0, client_request_id: RID(1) })));
  check("bodies must be objects", [null, [], "x", 5].every((b) => !ok(V.parseStartBody(b)) && !ok(V.parseAdjustBody(b)) && !ok(V.parseCountBody(b)) && !ok(V.parseRestockBody(b)) && !ok(V.parseStopBody(b)) && !ok(V.parseSettingsBody(b))));

  const adj = (o) => V.parseAdjustBody({ kind: "decrease", quantity: 2, reason: "broken", client_request_id: RID(2), ...o });
  check("adjust: every manual kind accepted, nothing else", K.ADJUST_KINDS.every((k) => ok(adj({ kind: k }))) && ["correction", "return_restock", "opening", "tracking_stopped", "", null, 5, "DROP"].every((k) => !ok(adj({ kind: k }))));
  check("adjust: the browser cannot send a stored balance or a signed delta", adj({ balance: 999, qty_delta: -5, profile_id: "x", inventory_count: 7 }).value && !("balance" in adj({ balance: 999 }).value) && !("inventory_count" in adj({ inventory_count: 7 }).value));
  check("adjust: quantity is a whole number from 1 to 1,000,000", !ok(adj({ quantity: 0 })) && !ok(adj({ quantity: -3 })) && !ok(adj({ quantity: 1.2 })) && !ok(adj({ quantity: "2" })) && !ok(adj({ quantity: 1_000_001 })) && ok(adj({ quantity: 1_000_000 })));
  check("adjust: reason 200 / note 500 characters (counted by character, emoji safe)", ok(adj({ reason: "é".repeat(200) })) && !ok(adj({ reason: "x".repeat(201) })) && ok(adj({ note: "😀".repeat(500) })) && !ok(adj({ note: "x".repeat(501) })) && !ok(adj({ reason: 5 })));
  check("adjust: blank reason becomes null", adj({ reason: "   " }).value.reason === null);
  check("adjust: unit cost is an exact decimal string, never a float; garbage rejected", adj({ unit_cost: "12.50" }).value.unit_cost === "12.50" && adj({ unit_cost: "12,5" }).value.unit_cost === "12.5" && adj({ unit_cost: 0.1 }).value.unit_cost === "0.1" && adj({ unit_cost: "" }).value.unit_cost === null
    && ["-1", "1e3", "abc", "1.2345", "1.", "NaN"].every((c) => !ok(adj({ unit_cost: c }))));
  check("adjust: invoice reference must be a UUID", ok(adj({ invoice_id: ID(9) })) && adj({ invoice_id: ID(9) }).value.invoice_id === ID(9) && !ok(adj({ invoice_id: "INV-1" })));

  check("count: target 0..1e9, reason required by the database but length-checked here", ok(V.parseCountBody({ target: 0, reason: "recount", client_request_id: RID(3) })) && !ok(V.parseCountBody({ target: -1, client_request_id: RID(3) })) && !ok(V.parseCountBody({ target: 2.5, client_request_id: RID(3) })) && !ok(V.parseCountBody({ target: 1e9 + 1, client_request_id: RID(3) })));
  check("restock: order uuid + whole quantity + request id", ok(V.parseRestockBody({ order_id: ID(4), quantity: 1, client_request_id: RID(4) })) && !ok(V.parseRestockBody({ order_id: "x", quantity: 1, client_request_id: RID(4) })) && !ok(V.parseRestockBody({ order_id: ID(4), quantity: 0, client_request_id: RID(4) })) && !ok(V.parseRestockBody({ order_id: ID(4), quantity: 1 })));
  check("stop: only an optional note and a request id", ok(V.parseStopBody({ client_request_id: RID(5) })) && ok(V.parseStopBody({ note: "wound down", client_request_id: RID(5) })) && !ok(V.parseStopBody({ note: "x".repeat(501), client_request_id: RID(5) })));
  check("settings: threshold required, SKU 60, cost decimal", ok(V.parseSettingsBody({ low_stock_threshold: 5, sku: "A-1", unit_cost: "3.5" })) && !ok(V.parseSettingsBody({ sku: "A" })) && !ok(V.parseSettingsBody({ low_stock_threshold: 5, sku: "x".repeat(61) })) && V.parseSettingsBody({ low_stock_threshold: 5, sku: " " }).value.sku === null);
}

// ------------------------------------------------------------------------ error mapping
{
  const map = (code, message) => E.invError({ code, message });
  for (const [msg, status] of [["product_not_found", 404], ["order_not_found", 404], ["insufficient_stock", 409], ["stock_limit_exceeded", 409], ["not_tracked", 409], ["already_tracked", 409], ["order_not_refunded", 409], ["exceeds_returnable", 409], ["order_item_not_found", 409], ["no_change", 409],
    ["count_mismatch", 409], ["stock_changed_retry", 409], ["duplicate_sku", 409], ["digital_not_supported", 400], ["category_not_enabled", 403], ["reason_required", 400], ["opening_quantity_required", 400], ["invalid_unit_cost", 400], ["invalid_threshold", 400]]) {
    const r = map("P0001", msg);
    check(`error ${msg} -> ${status}`, r.status === status && r.body.error === msg, JSON.stringify(r));
  }
  check("a code inside a longer sentence still matches; look-alike words do not", map("P0001", "ERROR: insufficient_stock (7)").body.error === "insufficient_stock" && map("P0001", "xno_changex").body.error !== "no_change");
  check("missing function/table -> 503 inventory_unavailable (migration not applied)", map("PGRST202", "x").status === 503 && map("42P01", 'relation "bk_stock_movements" does not exist').body.error === "inventory_unavailable" && map("42883", "function inv_overview does not exist").status === 503);
  check("Phase 2 access errors fall through (not_owner, toolkit_not_enabled, demo)", map("P0001", "not_owner").status === 403 && map("P0001", "toolkit_not_enabled").status === 403 && map("P0001", "demo_profile_not_supported").status === 403);
  check("unknown database errors never leak their text", !JSON.stringify(map("XX000", "secret internal detail select * from products")).includes("secret"));
  check("every mapped code has a translated EN and FR message", K && Object.keys(E.KNOWN_INVENTORY_ERRORS ? Object.fromEntries(E.KNOWN_INVENTORY_ERRORS.map((c) => [c, 1])) : {}).every((c) => { const k = UE.invErrorKey(c); return k && translations.en.inventory.errors[k] && translations.fr.inventory.errors[k]; })
    || E.KNOWN_INVENTORY_ERRORS.filter((c) => !UE.invErrorKey(c)).join(",") === "");
  const unmapped = E.KNOWN_INVENTORY_ERRORS.filter((c) => { const k = UE.invErrorKey(c); return !(k && translations.en.inventory.errors[k] && translations.fr.inventory.errors[k]); });
  check("no machine code is left without a human sentence in both languages", unmapped.length === 0, unmapped.join(","));
  check("a raw code is never an output of the UI mapper", UE.invErrorKey("xyz") === null && UE.invErrorKey(undefined) === null);
}

// ------------------------------------------------------------------------ handlers (owner scoping, RPC wiring, money)
{
  const o = mkOwner({ inv_adjust_stock: { data: { duplicate: false, balance: 8 }, error: null } });
  const r = await H.adjustStock(o, ID(1), { kind: "stock_in", quantity: 3, unit_cost: "250", reason: "delivery", client_request_id: RID(1), profile_id: "evil", p_profile_id: "evil" });
  const [name, args] = o.admin.calls[0];
  check("adjust: ONE database function call, with the owner's OWN profile and user ids from the session", o.admin.calls.length === 1 && name === "inv_adjust_stock" && args.p_profile_id === OWNER.profileId && args.p_actor_user_id === OWNER.userId, JSON.stringify(o.admin.calls));
  check("adjust: request body cannot override the profile; kind/quantity/cost/request id are passed through", args.p_kind === "stock_in" && args.p_quantity === 3 && args.p_unit_cost === "250" && args.p_client_request_id === RID(1) && args.p_product_id === ID(1) && JSON.stringify(args).indexOf("evil") === -1);
  check("adjust: fresh request -> 201", r.status === 201 && r.body.balance === 8);
  const dup = await H.adjustStock(mkOwner({ inv_adjust_stock: { data: { duplicate: true, balance: 8 }, error: null } }), ID(1), { kind: "stock_in", quantity: 3, client_request_id: RID(1) });
  check("adjust: a replayed request id returns the original result with 200 (no second change)", dup.status === 200 && dup.body.duplicate === true);
  const inv = mkOwner();
  await H.adjustStock(inv, ID(1), { kind: "sold_elsewhere", quantity: 1, reason: "market", invoice_id: ID(7), client_request_id: RID(2) });
  check("sold elsewhere with an invoice reference passes source_type invoice (reference only; no invoice write)", inv.admin.calls[0][1].p_source_type === "invoice" && inv.admin.calls[0][1].p_source_id === ID(7) && inv.admin.calls.length === 1);

  const none = mkOwner();
  const bad = [await H.adjustStock(none, "not-a-uuid", {}), await H.startTracking(none, "x", {}), await H.correctCount(none, "x", {}), await H.stopTracking(none, "x", {}), await H.restockReturned(none, "x", {}), await H.updateSettings(none, "x", {}), await H.productDetail(none, "x", {}), await H.refundedOrders(none, "x")];
  check("a malformed product id is a 404 and never reaches the database", bad.every((x) => x.status === 404) && none.admin.calls.length === 0);
  const inv2 = await H.adjustStock(none, ID(1), { kind: "decrease", quantity: 0, client_request_id: RID(1) });
  check("invalid input is a 400 validation_failed and never reaches the database", inv2.status === 400 && inv2.body.error === "validation_failed" && none.admin.calls.length === 0);

  const err = mkOwner({ inv_adjust_stock: { data: null, error: { code: "P0001", message: "insufficient_stock" } } });
  const e = await H.adjustStock(err, ID(1), { kind: "decrease", quantity: 99, reason: "x", client_request_id: RID(3) });
  check("a database refusal becomes its mapped status", e.status === 409 && e.body.error === "insufficient_stock");

  const s = mkOwner({ inv_start_tracking: { data: { duplicate: false, balance: 4 }, error: null }, inv_stop_tracking: { data: { duplicate: false }, error: null }, inv_set_stock_count: { data: { duplicate: false, balance: 2 }, error: null }, inv_return_restock: { data: { duplicate: false, balance: 5 }, error: null }, inv_update_settings: { data: { ok: true }, error: null } });
  const a = await H.startTracking(s, ID(1), { opening_quantity: 4, client_request_id: RID(4) });
  const b = await H.correctCount(s, ID(1), { target: 2, reason: "recount", client_request_id: RID(5) });
  const c = await H.restockReturned(s, ID(1), { order_id: ID(2), quantity: 1, client_request_id: RID(6) });
  const d = await H.stopTracking(s, ID(1), { client_request_id: RID(7) });
  const f = await H.updateSettings(s, ID(1), { low_stock_threshold: 8, sku: "A", unit_cost: "2" });
  check("each operation maps to exactly one controlled function", s.admin.calls.map((x) => x[0]).join() === "inv_start_tracking,inv_set_stock_count,inv_return_restock,inv_stop_tracking,inv_update_settings" && [a, b, c, d].every((x) => x.status === 201) && f.status === 200);
  check("every call carries the owner's profile + actor, never request data", s.admin.calls.every(([, g]) => g.p_profile_id === OWNER.profileId && g.p_actor_user_id === OWNER.userId));
  check("restock: order id, product id and quantity forwarded; no refund/payment function is ever called", s.admin.calls[2][1].p_order_id === ID(2) && s.admin.calls[2][1].p_product_id === ID(1) && s.admin.calls[2][1].p_quantity === 1 && s.admin.calls.every(([n]) => /^inv_/.test(n)));

  // reads: exact decimals in, integer minor units out
  const ov = mkOwner({ inv_overview: { data: { profile_currency: "XAF", total: 1, summary: { tracked: 1, out: 0, low: 0, ok: 1, legacy: 0, untracked: 0, estimated_value: "12500.000", value_excluded: 0, drift: 0 },
    items: [{ product_id: ID(1), name: "Shirt", available: true, state: "ok", tracked: true, count: 5, low_stock_threshold: 5, reserved: 1, sold_units: 2, sku: null, unit_cost: "2500.000", cost_currency: "XAF", estimated_value: "12500.000", last_movement_at: null, drift: 0 }] }, error: null } });
  const ovr = await H.inventoryOverview(ov, { filter: "ok" });
  check("overview: money returned as integer minor units, Reserved and Sold kept as separate fields", ovr.status === 200 && ovr.body.summary.estimated_value_minor === 12500 && ovr.body.items[0].unit_cost_minor === 2500 && ovr.body.items[0].estimated_value_minor === 12500 && ovr.body.items[0].reserved === 1 && ovr.body.items[0].sold_units === 2 && !("estimated_value" in JSON.parse(JSON.stringify(ovr.body.summary))), JSON.stringify(ovr.body).slice(0, 300));
  check("overview: filter validated; an unknown filter is a 400 without a database call", (await H.inventoryOverview(mkOwner(), { filter: "bogus" })).status === 400 && ov.admin.calls[0][1].p_filter === "ok" && ov.admin.calls[0][1].p_limit === 50);
  const ov2 = mkOwner({ inv_overview: { data: { profile_currency: "USD", total: 0, summary: { estimated_value: "0.10" }, items: [{ unit_cost: "0.1", estimated_value: "0.30", cost_currency: "USD" }] }, error: null } });
  const ovr2 = await H.inventoryOverview(ov2, {});
  check("decimals never pass through floating point (0.10 -> 10, 0.30 -> 30)", ovr2.body.summary.estimated_value_minor === 10 && ovr2.body.items[0].unit_cost_minor === 10 && ovr2.body.items[0].estimated_value_minor === 30, JSON.stringify(ovr2.body));
  const det = mkOwner({ inv_product_detail: { data: { profile_currency: "XAF", product: { id: ID(1), name: "Shirt", count: 3 }, tracked: true, legacy_count: false, reserved: 0, sold_units: 0, drift: 0, estimated_value: null, settings: { active: true, low_stock_threshold: 5, sku: null, unit_cost: null, tracking_started_at: "2026-12-01" }, movement_total: 1,
    movements: [{ id: ID(8), kind: "opening", qty_delta: 3, balance_before: null, balance_after: 3, unit_cost: "100.000", created_at: "2026-12-01" }], order_events: [] }, error: null } });
  const dr = await H.productDetail(det, ID(1), {});
  check("detail: product, settings, movements (with cost in minor units) and order events pass through", dr.status === 200 && dr.body.tracked === true && dr.body.movements[0].unit_cost_minor === 100 && dr.body.settings.unit_cost_minor === null && dr.body.estimated_value_minor === null);
  const unavailable = await H.inventoryOverview(mkOwner({ inv_overview: { data: null, error: { code: "PGRST202", message: "Could not find the function" } } }), {});
  check("before the migration every read is a clean 503", unavailable.status === 503 && unavailable.body.error === "inventory_unavailable");
}

// ------------------------------------------------------------------------ routes (owner gate, methods, no body-supplied identity)
{
  const files = ["", "products/[id]", "products/[id]/start", "products/[id]/stop", "products/[id]/adjust", "products/[id]/count", "products/[id]/settings", "products/[id]/refunded-orders", "products/[id]/restock"];
  check("all nine route files exist", files.every((f) => fs.existsSync(path.join(SRC, "app/api/inventory", f, "route.ts"))));
  const methods = { "": ["GET"], "products/[id]": ["GET"], "products/[id]/refunded-orders": ["GET"], "products/[id]/settings": ["PUT"], "products/[id]/start": ["POST"], "products/[id]/stop": ["POST"], "products/[id]/adjust": ["POST"], "products/[id]/count": ["POST"], "products/[id]/restock": ["POST"] };
  for (const f of files) {
    const src = read(`src/app/api/inventory/${f}/route.ts`);
    const exported = [...src.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]);
    eq(`route /${f}: exposes only ${methods[f]}`, exported, methods[f]);
    check(`route /${f}: force-dynamic, goes through withOwner, no database access of its own`, /force-dynamic/.test(src) && /withOwner/.test(src) && !/createAdminClient|supabase|\.from\(|\.rpc\(/.test(strip(src)));
  }
  globalThis.__owner = { ok: false, reason: "not_signed_in" };
  const GET = route("").GET;
  const denied = await GET(new Request("http://x/api/inventory"));
  check("signed-out request is denied before any handler runs", denied.status === 401 || denied.status === 403, denied.status);
  globalThis.__owner = { ok: false, reason: "demo_profile" };
  const dem = await route("products/[id]/adjust").POST(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "stock_in", quantity: 1, client_request_id: RID(1) }) }), { params: { id: ID(1) } });
  check("a demo / non-entitled caller is denied", dem.status >= 400 && dem.status < 500, dem.status);
  const admin = makeAdmin({ inv_adjust_stock: { data: { duplicate: false, balance: 1 }, error: null } });
  globalThis.__owner = { ok: true, owner: { userId: OWNER.userId, profile: { id: OWNER.profileId, currency: "XAF" }, supabase: {}, admin } };
  const okr = await route("products/[id]/adjust").POST(new Request("http://x", { method: "POST", body: JSON.stringify({ kind: "stock_in", quantity: 1, client_request_id: RID(1), profile_id: "someone-else" }) }), { params: { id: ID(1) } });
  check("an entitled owner gets 201, never-cached private headers, and the call used the SESSION's profile", okr.status === 201 && /no-store/.test(okr.headers.get("cache-control") || "") && admin.calls[0][1].p_profile_id === OWNER.profileId);
  const garbage = await route("products/[id]/adjust").POST(new Request("http://x", { method: "POST", body: "{not json" }), { params: { id: ID(1) } });
  check("a non-JSON body is a 400, not a crash", garbage.status === 400, garbage.status);
}

// ------------------------------------------------------------------------ write boundary (static)
{
  const handlers = strip(read("src/lib/inventory/handlers.ts"));
  check("handlers: only inv_* controlled functions are called; no table is read or written directly", [...handlers.matchAll(/"(inv_[a-z_]+)"/g)].every((m) => ["inv_start_tracking", "inv_adjust_stock", "inv_set_stock_count", "inv_return_restock", "inv_stop_tracking", "inv_update_settings", "inv_overview", "inv_product_detail", "inv_refunded_orders"].includes(m[1])) && !/\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(handlers));
  const allInventoryTs = ["constants", "http", "uiErrors", "access", "validation", "handlers"].map((n) => strip(read(`src/lib/inventory/${n}.ts`))).join("\n");
  check("the Phase 4 library never touches orders, payments, invoices, bookkeeping, refunds or the checkout", !/product_orders|customer_payments|bk_entries|bk_documents|doc_record_payment|bk_record_entry|settlement|refund_|create_product_order|release_product_order_stock/i.test(allInventoryTs));
  check("the Phase 4 library never sends a stored quantity (no inventory_count write anywhere in it)", !/inventory_count/.test(allInventoryTs));
  const ui = ["InventoryView", "ProductInventoryView", "shared"].map((n) => strip(read(`src/components/inventory/${n}.tsx`))).join("\n");
  check("UI: talks only to /api/inventory (no direct Supabase client, no table access)", !/createClient|supabase|\.from\(|\.rpc\(/.test(ui) && /\/api\/inventory/.test(ui));
  check("UI: every write carries a client_request_id generated once per dialog (double-click safe)", (ui.match(/client_request_id/g) || []).length >= 2 && /useState\(newRequestId\)/.test(ui));
  check("UI: stopping needs a confirmation dialog; sold elsewhere explains it changes nothing else", /StopDialog/.test(ui) && /stopBody/.test(ui) && /soldElsewhereHelp/.test(ui));
  check("UI: Reserved and Sold are separate figures with their own help text", /u\.reserved/.test(ui) && /u\.sold\b/.test(ui) && /reservedHelp/.test(ui) && /soldHelp/.test(ui));
  check("UI: estimated value is labelled informational", /estimateNote/.test(ui));
  check("UI: only the opening quantity or adoption path starts tracking; an untracked product is never auto-started", /startTracking|adoptTracking/.test(ui) && !/useEffect\([^)]*start/.test(ui));
  check("UI: no hard-coded English in the inventory components (every visible sentence is a translation key)", !/>[A-Z][a-z]+ [a-z]+[^<{]*</.test(ui.replace(/className="[^"]*"/g, "")), (ui.match(/>[A-Z][a-z]+ [a-z]+[^<{]*</g) || []).join("|"));
}

// ------------------------------------------------------------------------ editor protection, nav and pages (static)
{
  const cat = read("src/components/editor/CatalogCard.tsx");
  const row = read("src/components/editor/ProductRow.tsx");
  check("editor: tracked product ids are read from bk_stock_settings (owner-read RLS), failure = none managed", /from\("bk_stock_settings"\)[\s\S]{0,160}eq\("active", true\)/.test(cat) && /catch \{[\s\S]{0,120}stays editable|every count stays editable/.test(cat));
  check("editor: the save payload leaves inventory_count out for tracked products and keeps it for the rest", /stockManaged\.has\(p\.id\) \? \{\} : \{ inventory_count:/.test(cat));
  check("editor: the row shows the count read-only with a link to Inventory for tracked products; the input is unchanged for others", /stockManaged \? \(/.test(row) && /\/dashboard\/inventory\/\$\{product\.id\}/.test(row) && /t\.music\.inventoryPlaceholder/.test(row) && /t\.inventory\.editor\.managed/.test(row));
  const layout = read("src/app/dashboard/layout.tsx");
  const shell = read("src/components/dashboard/DashboardShell.tsx");
  check("nav: computed with the same owner-only gate as Invoices, hidden for staff", /inventoryNavVisible\(\{ userId: user\.id, profile: ownProfile \}\)/.test(layout) && /!isActingAsStaff && ownProfile \? inventoryNavVisible/.test(layout) && /hasInventory && !organization\?\.isStaff/.test(shell) && /hasInventory=\{hasInventory\}/.test(layout));
  const accessSrc = strip(read("src/lib/inventory/access.ts"));
  check("access: plan flag + category/demo gate + table-existence, any failure hides the entry", /business_toolkit_enabled/.test(accessSrc) && /decideBookkeepingAccess/.test(accessSrc) && /bk_stock_settings/.test(accessSrc) && /catch \{\s*return false;/.test(accessSrc));
  const pl = read("src/app/dashboard/inventory/layout.tsx");
  check("pages: layout requires the owner and the tables, otherwise redirects; both pages exist", /requireInventoryOwner/.test(pl) && /inventoryAvailable/.test(pl) && /redirect\("\/dashboard"\)/.test(pl) && fs.existsSync(path.join(SRC, "app/dashboard/inventory/page.tsx")) && fs.existsSync(path.join(SRC, "app/dashboard/inventory/[id]/page.tsx")));
  check("the editor diff is limited to the stock field (no other editor behaviour changed)", (() => { try { const d = execFileSync("git", ["diff", "--numstat", "--", "src/components/editor/CatalogCard.tsx", "src/components/editor/ProductRow.tsx"], { cwd: REPO }).toString(); if (!d.trim() || d.trim().split("\n").every((l) => OWNER_WORKSPACE_FILES.has(l.split("\t")[2]))) return true; /* UX refinement phase: its exact, presentational editor changes (labels, 44px targets) are on the explicit phase13 list */ /* once committed, the editor files equal HEAD: nothing further changed */ const n = d.trim().split("\n").map((l) => l.split("\t")); return n.length === 2 && n.every((x) => Number(x[0]) <= 24 && Number(x[1]) <= 8); } catch { return true; } })());
}

// ------------------------------------------------------------------------ EN / FR
{
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
  const en = flat(translations.en.inventory), fr = flat(translations.fr.inventory);
  eq("EN and FR inventory namespaces have exactly the same keys", en.sort(), fr.sort());
  const leaves = (o) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? leaves(v) : [[k, v]]));
  const emptyStr = [...leaves(translations.en.inventory), ...leaves(translations.fr.inventory)].filter(([, v]) => typeof v === "string" && !v.trim());
  check("no empty string in either language", emptyStr.length === 0);
  const sameAsEn = leaves(translations.fr.inventory.ui).filter(([k, v], i) => typeof v === "string" && v === leaves(translations.en.inventory.ui)[i][1] && !["sku", "kind"].includes(k) && v.length > 12);
  check("French sentences are really translated (no long string identical to English)", sameAsEn.length === 0, sameAsEn.map(([k]) => k).join(","));
  for (const [lang, ui] of [["en", translations.en.inventory.ui], ["fr", translations.fr.inventory.ui]]) {
    check(`${lang}: function strings return text`, [ui.estimateNote("XAF"), ui.valueExcluded(1), ui.valueExcluded(3), ui.drift(-2), ui.startLegacy(7), ui.balanceChange(null, 5), ui.balanceChange(4, null), translations[lang].inventory.editor.managed(3)].every((s) => typeof s === "string" && s.length > 3));
    check(`${lang}: Reserved and Sold have different words; every movement kind and order status is translated`, ui.reserved !== ui.sold && K.ADJUST_KINDS.every((k) => ui.kind[k]) && ["correction", "return_restock", "opening", "tracking_stopped"].every((k) => ui.kind[k]) && ["awaiting_payment", "paid", "fulfilled", "cancelled", "expired", "refunded", "payment_review"].every((s) => ui.orderStatus[s]) && ["out", "low", "ok", "legacy", "untracked"].every((s) => ui.state[s]));
  }
  check("nav label exists in both languages", translations.en.nav.inventory && translations.fr.nav.inventory && translations.en.nav.inventory !== translations.fr.nav.inventory);
}

// ------------------------------------------------------------------------ protected paths untouched
{
  let changed = [];
  try { changed = execFileSync("git", ["status", "--porcelain"], { cwd: REPO }).toString().split("\n").filter(Boolean).map((l) => l.slice(3).replace(/"/g, "")); } catch { /* not a git checkout */ }
  const protectedRe = /^(supabase\/migrations\/(?!2026-12-04_inventory)|src\/lib\/(productCheckout|payments|fapshi|documents|receivables|bookkeeping)\/|src\/middleware|src\/app\/api\/(documents|receivables|bookkeeping|payments|fapshi|music|restaurant|tickets|webhooks|cron)|src\/app\/auth|src\/lib\/supabase\/)/;
  const touched = changed.filter((f) => protectedRe.test(f) && !isPhase8AuthFile(f) && !RECORD_SALE_FILES.test(f) && !OWNER_WORKSPACE_FILES.has(f) && !["src/app/api/bookkeeping/entries/route.ts", "src/lib/bookkeeping/recordEntry.ts", "src/lib/bookkeeping/decision.ts", "src/lib/inventory/access.ts", "supabase/migrations/2026-12-05_ringo_ai_business_drafts.sql", "supabase/support/2026-12-05_ringo_ai_business_drafts.rollback.sql"].includes(f)); // Phase 7: the invoice-payment replace guard on the entries route (tested in bookkeeping.test.mjs)
  check("no protected path (earlier migrations, checkout, payments, documents, receivables, bookkeeping, auth, middleware, music, restaurant, tickets, crons) is modified", touched.length === 0, touched.join(", "));
  check("package files untouched", !changed.some((f) => /^(package\.json|package-lock\.json)$/.test(f) && !isPhase16ProtectedFile(f)));
  const mig = read("supabase/migrations/2026-12-04_inventory_stock_control.sql");
  check("the migration never writes orders, payments, bookkeeping or invoices (code outside comments)", !/(insert into|update|delete from)\s+(product_orders|product_order_items|customer_payments|bk_entries|bk_documents|bk_document_payments)\b/i.test(mig.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")));
}

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
