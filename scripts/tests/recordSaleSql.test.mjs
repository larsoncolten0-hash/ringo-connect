// Business Toolkit — Record Sale: the REAL path (handler -> sale_record) against the REAL SQL.
//
// What is real: the repository's Shop checkout foundation and Business Toolkit Phase 1-4 migrations (applied FIRST, so a legacy invoice and its payment receipt are issued
// the way production issued them), then the un-applied 2026-12-06 Record Sale migration, on an in-memory PostgreSQL (PGlite, a real PostgreSQL engine in WASM).
// bk_record_entry, inv_adjust_stock, doc_issue / doc_record_payment, bk_doc_issue_core, the customer book, the immutability triggers, the CHECK constraints, the
// grants and the RLS policies are genuinely evaluated, and so are the new sale_record function and the widened constraints. The application code is the REAL code:
// the sales handlers, the owner gate (resolveBookkeepingOwner), the documents handlers (including the PDF), the entry guards. Stand-ins: the PostgREST layer
// (scripts/tests/pgliteShim.mjs), roles / auth.uid(), the session (a global "who is signed in"), reduced users / plans / profiles / products tables.
// It never connects to Supabase or any real database, never reads .env.local, and the migration is only applied to the scratch database.
//   Run:  node scripts/tests/recordSaleSql.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { makeClientFactory, q } from "./pgliteShim.mjs";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");

const tmp = [];
const serverStub = path.join(os.tmpdir(), `rssql_server_${process.pid}.cjs`);
fs.writeFileSync(serverStub, "module.exports = { createClient: () => globalThis.__sessionClient(), createAdminClient: () => globalThis.__adminClient() };");
tmp.push(serverStub);
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const load = (p) => jiti(path.join(SRC, p));
const SALES = load("lib/sales/handlers.ts");
const DOC = load("lib/documents/handlers.ts");
const INV = load("lib/inventory/handlers.ts");
const REC = load("lib/receivables/handlers.ts");
const { recordEntry } = load("lib/bookkeeping/recordEntry.ts");
const { entryIsSaleReceipt } = load("lib/bookkeeping/saleReceiptGuard.ts");
const { resolveBookkeepingOwner } = load("lib/bookkeeping/access.ts");
const { renderDocumentPdf } = load("lib/documents/pdf/render.ts");
const { modelFromRows } = load("lib/documents/snapshot.ts");
const { saleRecordInstalled } = load("lib/sales/access.ts");
const { openSharedLogo } = load("lib/documents/publicShare.ts");
const { loadBrandAsset } = load("lib/documents/brand.ts");

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const ID = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const names = ["alice", "bob", "carol", "dan", "fay"];
const U = Object.fromEntries(names.map((n, i) => [n, ID("c", i + 1)]));
const PR = Object.fromEntries(names.map((n, i) => [n, ID("a", i + 1)]));
const PLN = { full: ID("d", 1), none: ID("d", 2) };
// three tiny valid PNGs (1x1: red, blue, green) standing in for three different logo files, and a stand-in for the project's storage: the ONLY thing allowed to serve
// them is the sync step, and "offline" proves nothing else (rendering, public page) ever goes to the network.
const crc32 = zlib.crc32;
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
const makePng = (r, g, b) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2; return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from([0, r, g, b]))), chunk("IEND", Buffer.alloc(0))]); };
const PNG_RED = makePng(220, 20, 20), PNG_BLUE = makePng(20, 20, 220), PNG_GREEN = makePng(20, 200, 20);
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://files.test";
let LOGOS = { "https://files.test/alice-logo-1.png": PNG_RED, "https://files.test/alice-logo-2.png": PNG_BLUE, "https://files.test/alice-logo-3.png": PNG_GREEN };
let fetchMode = "serve";
const fetchLog = [];
globalThis.fetch = async (url) => {
  fetchLog.push(String(url));
  if (fetchMode === "offline") throw new Error("network down");
  const b = LOGOS[String(url)];
  if (!b) return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
  return { ok: true, status: 200, headers: { get: () => String(b.length) }, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
};
const hex = (str) => Buffer.from(str, "latin1").toString("hex").toUpperCase();
const pdfText = (bytes) => {
  const buf = Buffer.from(bytes); let out = ""; let i = 0;
  const s = buf.toString("latin1");
  for (;;) {
    const a = s.indexOf("stream", i); if (a < 0) break;
    const start = s[a + 6] === "\r" ? a + 8 : a + 7; const end = s.indexOf("endstream", start); if (end < 0) break;
    try { out += zlib.inflateSync(buf.subarray(start, end)).toString("latin1"); } catch { out += buf.subarray(start, end).toString("latin1"); }
    i = end + 9;
  }
  return out;
};
const has = (bytes, str) => pdfText(bytes).includes(hex(str));
// the embedded logo is a 1x1 image whose single pixel survives in the (inflated) image stream: this tells WHICH logo a PDF carries
const pdfHasPixel = (bytes, rgb) => { const b = Buffer.from(bytes), s = b.toString("latin1"); let i = 0; const want = Buffer.from(rgb); for (;;) { const a = s.indexOf("stream", i); if (a < 0) return false; const st = s[a + 6] === "\r" ? a + 8 : a + 7; const e = s.indexOf("endstream", st); if (e < 0) return false; try { if (zlib.inflateSync(b.subarray(st, e)).includes(want)) return true; } catch { /* not a flate stream */ } i = e + 9; } };
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let rqn = 100;
const rq = () => RQ(++rqn);

// ------------------------------------------------------------------------ the database
const db = new PGlite();
await db.exec(`
  set timezone = 'UTC';
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function public.is_admin() returns boolean language sql stable as $$ select false $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.plans (id uuid primary key, name text not null unique, max_products int, ai_enabled boolean not null default false, business_toolkit_enabled boolean not null default false);
  create table public.users (id uuid primary key, email text not null, role text not null default 'creator', plan_id uuid references public.plans(id));
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null, name text, currency text,
    avatar_url text, theme_color text default '#4F46E5', is_demo boolean not null default false, published boolean not null default true, category text, categories text[] not null default '{}');
  alter table public.profiles enable row level security;
  create policy "profiles readable" on public.profiles for select using (true);
  create table public.products (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete cascade, name text not null,
    price numeric(10,2), image_url text, image_urls text[] not null default '{}', available boolean not null default true, inventory_count int, sort_order int not null default 0,
    product_type text not null default 'physical', digital_file_path text, digital_file_name text, digital_file_size_bytes bigint, digital_file_mime text);
  alter table public.products enable row level security;
  create policy "products public read" on public.products for select using (true);
  create table public.orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.music_orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
  create table public.protection_transactions (id uuid primary key default gen_random_uuid(), target_type text, target_id uuid);
  create table public.protection_payments (id uuid primary key default gen_random_uuid(), protection_transaction_id uuid, status text, expires_at timestamptz);
  create table public.platform_settings (id int primary key default 1, fapshi_enabled boolean not null default true);
  insert into public.platform_settings default values;
  create table public.ringo_customers (id uuid primary key default gen_random_uuid());
  create table public.email_suppressions (id uuid primary key default gen_random_uuid(), email text not null unique, reason text not null default 'manual');
`);
for (const m of ["2026-11-02_product_checkout_foundation", "2026-12-01_bookkeeping_foundation", "2026-12-02_documents_invoices_receipts", "2026-12-03_debtors_reminders", "2026-12-04_inventory_stock_control"]) {
  await db.exec(read(`supabase/migrations/${m}.sql`));
}
const MIG = read("supabase/migrations/2026-12-06_record_sale_receipts_branding.sql");
const ROLLBACK = read("supabase/support/2026-12-06_record_sale_receipts_branding.rollback.sql");
const one = async (sql) => (await db.query(sql)).rows[0];
const rows = async (sql) => (await db.query(sql)).rows;
const exec = (sql) => db.exec(sql);
const count = async (sql) => Number((await one(sql)).n);

await exec(`
  insert into public.plans (id, name, ai_enabled, business_toolkit_enabled) values ('${PLN.full}','full',true,true),('${PLN.none}','none',true,false);
  insert into public.users (id, email, plan_id) values ('${U.alice}','a@x.test','${PLN.full}'),('${U.bob}','b@x.test','${PLN.full}'),('${U.carol}','c@x.test','${PLN.full}'),
    ('${U.dan}','d@x.test','${PLN.none}'),('${U.fay}','f@x.test','${PLN.full}');
  insert into public.profiles (id, user_id, username, name, currency, avatar_url, theme_color, is_demo, category) values
    ('${PR.alice}','${U.alice}','alice','Alice Shop','XAF','https://files.test/alice-logo-1.png','#112233',false,'business_ecommerce'),
    ('${PR.bob}','${U.bob}','bob','Bob Shop','XAF',null,'#4F46E5',false,'business_ecommerce'),
    ('${PR.carol}','${U.carol}','carol','Carol Consulting','XAF',null,'#4F46E5',false,'professional_services'),
    ('${PR.dan}','${U.dan}','dan','Dan','XAF',null,'#4F46E5',false,'business_ecommerce'),
    ('${PR.fay}','${U.fay}','fay','Fay Demo','XAF',null,'#4F46E5',true,'business_ecommerce');
`);

const client = makeClientFactory(db);
globalThis.__signedIn = null;
globalThis.__sessionClient = () => { const who = globalThis.__signedIn; return { auth: { getUser: async () => ({ data: { user: who ? { id: U[who] } : null }, error: null }) }, ...client("authenticated", () => (who ? U[who] : null)) }; };
globalThis.__adminClient = () => client("service_role", () => null);
const ownerOf = async (who) => { globalThis.__signedIn = who; const r = await resolveBookkeepingOwner(); if (!r.ok) throw new Error(`owner ${who}: ${r.reason}`); return r.owner; };

// ------------------------------------------------------------------------ 0. HISTORY: a legacy invoice and its payment receipt, issued BEFORE the migration (template v1)
let alice = await ownerOf("alice");
check("before the migration the Record Sale function is not installed (the nav entry stays hidden)", (await saleRecordInstalled(alice.admin)) === false);
const legacyDraft = await DOC.createDraft(alice, { locale: "en", customer: { name: "Old Customer" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "Legacy work", quantity: "1", unit_price: "20000" }], client_request_id: rq() });
const legacyIssued = await DOC.issueDocument(alice, legacyDraft.body.document.id);
const legacyPay = await DOC.recordPayment(alice, legacyDraft.body.document.id, { amount: "5000", method: "cash", paid_on: null, reference: null, client_request_id: rq() });
const legacyInvoice = await one(`select * from bk_documents where id = ${q(legacyDraft.body.document.id)}`);
const legacyReceipt = await one(`select * from bk_documents where doc_type = 'receipt' and parent_document_id = ${q(legacyDraft.body.document.id)}`);
check("setup: the legacy invoice and its receipt were issued as template v1 without any branding keys", legacyIssued.status === 200 && legacyPay.status === 201 && legacyInvoice.template_version === 1 && legacyReceipt.template_version === 1 && !("logo_url" in legacyInvoice.seller_snapshot), JSON.stringify(legacyInvoice.seller_snapshot));
const legacyBefore = { inv: { hash: legacyInvoice.content_hash, snap: legacyInvoice.seller_snapshot, v: legacyInvoice.template_version }, rct: { hash: legacyReceipt.content_hash, snap: legacyReceipt.seller_snapshot, v: legacyReceipt.template_version } };
const legacyPdfBefore = Buffer.from((await DOC.renderPdf(alice, legacyDraft.body.document.id)).pdf);
check("setup: the legacy invoice PDF carries the original 'Generated with Ringo Connect' footer", has(legacyPdfBefore, "Generated with Ringo Connect"));
const legacyEntries = await count(`select count(*) n from bk_entries where profile_id = '${PR.alice}'`);

// ------------------------------------------------------------------------ 1. the migration: only what it says, idempotent, rollback-safe
await db.exec(MIG);
await db.exec(MIG);
check("migration: running it twice is harmless (idempotent) and leaves one receipt-shape and one source_type CHECK", (await count(`select count(*) n from pg_constraint where conrelid = 'public.bk_documents'::regclass and conname in ('bk_documents_receipt_shape_check','bk_documents_source_type_check')`)) === 2);
const code = MIG.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
check("migration: no drop of a table or column, no truncate, no delete, and no update of products, entries or stock", !/drop\s+table|drop\s+column|(^|;)\s*truncate\s|\bdelete\s+from\b/i.test(code) && !/\bupdate\s+(bk_entries|bk_stock|bk_customers|products|profiles|users|plans)/i.test(code.replace(/on conflict[^;]*do update set[^;]*;/gi, "")));
check("migration: it never touches the checkout / order / earnings objects or the ambassador payout destinations", !/create_product_order|release_product_order_stock|product_orders|commerce_sale_earnings|ambassador|payout/i.test(code));
check("migration: it reuses the existing financial functions (bk_record_entry, inv_adjust_stock, bk_doc_issue_core) instead of writing those tables itself", /bk_record_entry\(/.test(code) && /inv_adjust_stock\(/.test(code) && /bk_doc_issue_core\(/.test(code) && !/insert\s+into\s+bk_entries|insert\s+into\s+bk_stock_movements|update\s+products/i.test(code));
check("migration: sale_record is callable by service_role only", (await count(`select count(*) n from information_schema.routine_privileges where routine_name = 'sale_record' and grantee in ('anon','authenticated','PUBLIC')`)) === 0 && (await count(`select count(*) n from information_schema.routine_privileges where routine_name = 'sale_record' and grantee = 'service_role'`)) === 1);
check("after the migration the Record Sale function is installed", (await saleRecordInstalled(alice.admin)) === true);

// history untouched
const lInv = await one(`select * from bk_documents where id = ${q(legacyInvoice.id)}`);
const lRct = await one(`select * from bk_documents where id = ${q(legacyReceipt.id)}`);
eq("history: the legacy invoice and receipt keep their stamped version, frozen snapshot and content hash exactly", { inv: { hash: lInv.content_hash, snap: lInv.seller_snapshot, v: lInv.template_version }, rct: { hash: lRct.content_hash, snap: lRct.seller_snapshot, v: lRct.template_version } }, legacyBefore);
// the owner now changes the logo and colour: an issued document must not move
await exec(`update profiles set avatar_url = 'https://files.test/alice-logo-2.png', theme_color = '#ff0000' where id = '${PR.alice}'`);
const legacyPdfAfter = Buffer.from((await DOC.renderPdf(alice, legacyDraft.body.document.id)).pdf);
check("history: the legacy PDF is byte-for-byte identical after the migration and after a logo/colour change (reproducible)", Buffer.compare(legacyPdfBefore, legacyPdfAfter) === 0);

// ------------------------------------------------------------------------ 2. Record Sale: tracked product, 100 -> 99, one entry, one movement, one standalone receipt
alice = await ownerOf("alice");
const prod = (await one(`insert into products (profile_id, name, price, inventory_count) values ('${PR.alice}','Red Shirt',5000,100) returning id`)).id;
const prodUntracked = (await one(`insert into products (profile_id, name, price, inventory_count) values ('${PR.alice}','Blue Hat',2000,null) returning id`)).id;
const prodLegacy = (await one(`insert into products (profile_id, name, price, inventory_count) values ('${PR.alice}','Old Scarf',1000,7) returning id`)).id;
const prodDigital = (await one(`insert into products (profile_id, name, price, product_type) values ('${PR.alice}','Ebook',3000,'digital') returning id`)).id;
const prodBob = (await one(`insert into products (profile_id, name, price, inventory_count) values ('${PR.bob}','Bob Shirt',5000,50) returning id`)).id;
const started = await INV.startTracking(alice, prod, { opening_quantity: 100, low_stock_threshold: 5, client_request_id: rq() });
check("setup: the product's stock is tracked from 100 with the Toolkit's own function", [200, 201].includes(started.status), JSON.stringify(started.body).slice(0, 200));
const stock = async (id) => (await one(`select inventory_count c from products where id = '${id}'`)).c;
const movements = (id) => rows(`select kind, qty_delta, balance_before, balance_after, reason, source_type from bk_stock_movements where product_id = '${id}' and kind = 'sold_elsewhere' order by created_at`);
const entriesN = () => count(`select count(*) n from bk_entries where profile_id = '${PR.alice}'`);
const saleReceiptsN = () => count(`select count(*) n from bk_documents where profile_id = '${PR.alice}' and source_type = 'sale'`);
const receiptCounter = async () => Number((await one(`select coalesce(max(last_number),0) n from bk_document_counters where profile_id = '${PR.alice}' and doc_type = 'receipt'`)).n);
const entriesBefore = await entriesN(), receiptsBefore = await saleReceiptsN(), counterBefore = await receiptCounter();

const productsList = await SALES.listSaleProducts(alice);
const listed = productsList.body.items.find((p) => p.id === prod);
eq("the product list shows the stock and whether it is tracked", [listed.tracked, listed.stock, productsList.body.items.find((p) => p.id === prodUntracked).tracked, productsList.body.items.find((p) => p.id === prodUntracked).stock], [true, 100, false, null]);

const r1 = rq();
const s1 = await SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prod, quantity: 1 }], method: "mobile_money", client_request_id: r1 });
check("sale: an existing product at its own price is recorded (201) and returns the receipt", s1.status === 201 && s1.body.duplicate === false && /^RCT-/.test(s1.body.receipt.number), JSON.stringify(s1).slice(0, 300));
eq("inventory: 100 -> 99", await stock(prod), 99);
eq("stock movement: exactly one, sold_elsewhere, 100 -> 99, reason 'Recorded sale'", await movements(prod), [{ kind: "sold_elsewhere", qty_delta: -1, balance_before: 100, balance_after: 99, reason: "Recorded sale", source_type: null }]);
eq("bookkeeping: exactly one new entry (a settled sale of 5 000, no customer in its description)", (await rows(`select kind, amount::float8 a, cash_settled, category, description, linked_order_id from bk_entries where profile_id = '${PR.alice}' order by created_at desc limit 1`)), [{ kind: "sale", a: 5000, cash_settled: true, category: null, description: "Red Shirt x1", linked_order_id: null }]);
eq("bookkeeping: the entry count grew by exactly one", (await entriesN()) - entriesBefore, 1);
const rc1 = await one(`select * from bk_documents where id = ${q(s1.body.receipt.id)}`);
const entry1 = await one(`select id from bk_entries where profile_id = '${PR.alice}' order by created_at desc limit 1`);
eq("receipt: a STANDALONE receipt (no parent invoice), issued, version 2, tied to the one bookkeeping sale, no revenue of its own", [rc1.doc_type, rc1.status, rc1.parent_document_id, rc1.source_type, rc1.source_id, rc1.template_version, Number(rc1.amount_paid), Number(rc1.total)], ["receipt", "issued", null, "sale", entry1.id, 2, 0, 5000]);
eq("receipt: exactly one new numbered receipt (no invoice was created for a normal sale)", [await saleReceiptsN() - receiptsBefore, (await receiptCounter()) - counterBefore, await count(`select count(*) n from bk_documents where profile_id = '${PR.alice}' and doc_type = 'invoice' and created_at > now() - interval '1 minute' and id <> '${legacyInvoice.id}'`)], [1, 1, 0]);
eq("receipt: one line carries the product id, name, quantity and price", (await rows(`select description, quantity::float8 q, unit_price::float8 p, product_id from bk_document_lines where document_id = '${rc1.id}'`)), [{ description: "Red Shirt", q: 1, p: 5000, product_id: prod }]);
eq("receipt: the frozen payment facts", [rc1.type_snapshot.kind, rc1.type_snapshot.method, Number(rc1.type_snapshot.amount)], ["sale", "mobile_money", 5000]);
check("receipt: walk-in (no customer) has an empty customer snapshot and no customer link", Object.keys(rc1.customer_snapshot).length === 0 && (await count(`select count(*) n from bk_document_customer_links where document_id = '${rc1.id}'`)) === 0);
const ptr1 = await one(`select source_url, asset_id from bk_brand_logo_current where profile_id = '${PR.alice}'`);
check("receipt: the frozen seller snapshot references the immutable COPY of the logo (not its URL) and carries the accent colour", rc1.seller_snapshot.logo_asset_id === ptr1.asset_id && ptr1.source_url === "https://files.test/alice-logo-2.png" && !JSON.stringify(rc1.seller_snapshot).includes("files.test") && rc1.seller_snapshot.accent_color === "#ff0000", JSON.stringify(rc1.seller_snapshot));
check("receipt: the first sale copied the profile picture into the immutable store exactly once", fetchLog.filter((u) => u.endsWith("alice-logo-2.png")).length === 1 && (await count(`select count(*) n from bk_brand_assets where profile_id = '${PR.alice}'`)) === 1);
check("receipt: the content hash is sealed (64 hex)", /^[0-9a-f]{64}$/.test(rc1.content_hash));
const shown = await DOC.getDocument(alice, rc1.id);
check("receipt: it opens through the existing document view as a sale receipt with its own lines, share and PDF actions and no payment/void actions", shown.status === 200 && shown.body.model.payment.sale === true && shown.body.model.lines.length === 1 && shown.body.actions.share === true && shown.body.actions.pdf === true && !shown.body.actions.recordPayment && !shown.body.actions.void, JSON.stringify(shown.body.actions));
const pdf1 = await DOC.renderPdf(alice, rc1.id);
const pdf1b = Buffer.from(pdf1.pdf);
check("receipt: the PDF renders (no 'Generated with Ringo Connect' footer, shows the item and the total)", pdf1.status === 200 && pdf1b.subarray(0, 4).toString() === "%PDF" && !has(pdf1b, "Generated with Ringo Connect") && has(pdf1b, "Red Shirt"), String(pdf1b.length));
const share = await DOC.createShare(alice, rc1.id, { expires_in_days: 7 }, "https://ringo.test");
check("receipt: the EXISTING share-link system makes a link for it (no new sharing mechanism)", share.status === 201 && /\/d\//.test(share.body.url || ""), JSON.stringify(share.body).slice(0, 200));

// ------------------------------------------------------------------------ 3. idempotency and concurrency
const dup = await SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prod, quantity: 1 }], method: "mobile_money", client_request_id: r1 });
check("repeat: the same request id replays the first sale (200, duplicate) and records nothing", dup.status === 200 && dup.body.duplicate === true && dup.body.receipt.id === s1.body.receipt.id && (await stock(prod)) === 99 && (await movements(prod)).length === 1 && (await entriesN()) - entriesBefore === 1);
const rc = rq();
const burst = await Promise.all([1, 2, 3, 4, 5].map(() => SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prod, quantity: 2 }], method: "cash", client_request_id: rc })));
check("concurrency: five simultaneous submissions of one sale produce exactly one sale, one entry, one receipt and ONE stock decrement (99 -> 97)", burst.filter((x) => x.status === 201).length === 1 && burst.filter((x) => x.status === 200).length === 4 && (await stock(prod)) === 97 && (await movements(prod)).length === 2 && new Set(burst.map((x) => x.body.receipt.id)).size === 1, burst.map((x) => x.status).join());
const clash = await SALES.recordSale(alice, { locale: "en", lines: [{ description: "x", quantity: 1, unit_price: 100 }], method: "cash", client_request_id: legacyDraft.body.document.client_request_id ?? rq() });
check("repeat: a request id that already belongs to something else is never mistaken for a sale", clash.status !== 500);

// ------------------------------------------------------------------------ 4. custom item, mixed, untracked, digital, legacy count
const sCustom = await SALES.recordSale(alice, { locale: "fr", lines: [{ description: "Website Design", quantity: 1, unit_price: 150000 }], method: "bank_transfer", client_request_id: rq() });
check("custom item: a free-text item is recorded for 150 000 with a receipt and NO stock movement", sCustom.status === 201 && Number(sCustom.body.receipt.total) === 150000 && Number((await one(`select count(*) n from bk_stock_movements where reason = 'Recorded sale'`)).n) === 2);
const customEntry = await one(`select amount::float8 a, description from bk_entries where profile_id = '${PR.alice}' order by created_at desc limit 1`);
eq("custom item: one bookkeeping sale of 150 000 named after the item", customEntry, { a: 150000, description: "Website Design x1" });
const sMixed = await SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prod, quantity: 3, unit_price: 4500 }, { description: "Gift wrap", quantity: "2", unit_price: "500" }], method: "cash", client_request_id: rq() });
check("mixed: a discounted catalogue line plus a custom line = ONE sale of 14 500, ONE receipt with two lines, stock down by 3 only", sMixed.status === 201 && Number(sMixed.body.receipt.total) === 14500 && (await stock(prod)) === 94 && (await count(`select count(*) n from bk_document_lines where document_id = '${sMixed.body.receipt.id}'`)) === 2);
const before3 = { stock: await stock(prodUntracked), moves: await count(`select count(*) n from bk_stock_movements where product_id = '${prodUntracked}'`) };
const sUntracked = await SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prodUntracked, quantity: 4 }], method: "cash", client_request_id: rq() });
check("untracked product: the sale is recorded at the product's price and stock is NOT invented (still unlimited/null, no movement)", sUntracked.status === 201 && Number(sUntracked.body.receipt.total) === 8000 && (await stock(prodUntracked)) === before3.stock && before3.stock === null && (await count(`select count(*) n from bk_stock_movements where product_id = '${prodUntracked}'`)) === before3.moves);
const sLegacy = await SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prodLegacy, quantity: 2 }], method: "cash", client_request_id: rq() });
check("a product with a count but no tracking (legacy): the sale is recorded and the untracked count is left alone (tracking is the owner's choice)", sLegacy.status === 201 && (await stock(prodLegacy)) === 7);
const sDigital = await SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prodDigital, quantity: 1 }], method: "cash", client_request_id: rq() });
check("digital product: recorded, no stock logic", sDigital.status === 201 && Number(sDigital.body.receipt.total) === 3000);

// ------------------------------------------------------------------------ 5. failure rolls EVERYTHING back
const snap = async () => ({ entries: await entriesN(), receipts: await saleReceiptsN(), counter: await receiptCounter(), stock: await stock(prod), moves: (await movements(prod)).length, docs: await count(`select count(*) n from bk_documents where profile_id = '${PR.alice}'`) });
const base = await snap();
const tooMuch = await SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prod, quantity: 1 }, { product_id: prod, quantity: 5000 }], method: "cash", client_request_id: rq() });
check("insufficient stock: rejected (409) and NOTHING is recorded, not even the first line's stock movement", tooMuch.status === 409 && tooMuch.body.error === "insufficient_stock" && JSON.stringify(await snap()) === JSON.stringify(base), JSON.stringify(tooMuch.body));
await exec(`create or replace function rs_fail_on_note() returns trigger language plpgsql as $$ begin if new.notes = 'FAIL-AFTER-STOCK-AND-ENTRY' then raise exception 'injected_failure'; end if; return new; end $$;
  create trigger rs_fail_on_note_trg before insert on bk_documents for each row execute function rs_fail_on_note();`);
const injected = await SALES.recordSale(alice, { locale: "en", lines: [{ product_id: prod, quantity: 1 }], method: "cash", notes: "FAIL-AFTER-STOCK-AND-ENTRY", client_request_id: rq() });
check("failure while issuing the receipt (after the stock moved and the entry was written): the whole sale is undone (stock, movement, entry, receipt number)", injected.status === 500 && JSON.stringify(await snap()) === JSON.stringify(base), JSON.stringify({ s: injected.status, after: await snap(), base }));
await exec(`drop trigger rs_fail_on_note_trg on bk_documents; drop function rs_fail_on_note();`);
const afterFail = await SALES.recordSale(alice, { locale: "en", lines: [{ description: "Next sale", quantity: 1, unit_price: 100 }], method: "cash", client_request_id: rq() });
check("failure: no receipt number was consumed by the failed attempts (the next number is the next in sequence)", afterFail.status === 201 && (await receiptCounter()) === base.counter + 1);

// ------------------------------------------------------------------------ 6. validation (handler and database)
const bad = async (label, lines, extra = {}) => { const r = await SALES.recordSale(alice, { locale: "en", lines, method: "cash", client_request_id: rq(), ...extra }); check(`validation: ${label} is refused and records nothing`, r.status >= 400 && r.status < 500 && JSON.stringify(await snap()) === JSON.stringify(await snap()), JSON.stringify(r)); return r; };
const b0 = JSON.stringify(await snap());
await bad("no lines", []);
await bad("more than 20 lines", Array.from({ length: 21 }, () => ({ description: "x", quantity: 1, unit_price: 1 })));
await bad("a zero quantity", [{ description: "x", quantity: 0, unit_price: 100 }]);
await bad("a negative quantity", [{ description: "x", quantity: -1, unit_price: 100 }]);
await bad("a fractional product quantity", [{ product_id: prod, quantity: 1.5 }]);
await bad("a negative price", [{ description: "x", quantity: 1, unit_price: -5 }]);
await bad("a fractional XAF price", [{ description: "x", quantity: 1, unit_price: 10.5 }]);
await bad("a missing description", [{ description: "  ", quantity: 1, unit_price: 100 }]);
await bad("a zero total", [{ description: "free", quantity: 1, unit_price: 0 }]);
await bad("an unknown payment method", [{ description: "x", quantity: 1, unit_price: 100 }], { method: "crypto" });
await bad("a future date", [{ description: "x", quantity: 1, unit_price: 100 }], { sold_on: "2999-01-01" });
await bad("a bad request id", [{ description: "x", quantity: 1, unit_price: 100 }], { client_request_id: "nope" });
await bad("an unknown product id", [{ product_id: ID("9", 9), quantity: 1 }]);
await bad("a product of ANOTHER business", [{ product_id: prodBob, quantity: 1 }]);
const noPrice = (await one(`insert into products (profile_id, name, price, inventory_count) values ('${PR.alice}','No Price',null,3) returning id`)).id;
await bad("a product with no price and no price given", [{ product_id: noPrice, quantity: 1 }]);
eq("validation: none of the refused attempts changed anything", JSON.stringify(await snap()), b0);
const foreignStockUntouched = (await stock(prodBob)) === 50;
check("validation: the other business's stock was never touched", foreignStockUntouched);
const huge = await SALES.recordSale(alice, { locale: "en", lines: [{ description: "x", quantity: 999999999, unit_price: 9999999999 }], method: "cash", client_request_id: rq() });
check("validation: an amount over the limit is refused", huge.status >= 400 && huge.status < 500, JSON.stringify(huge));

// ------------------------------------------------------------------------ 7. customers
const cust = await REC.saveContact(alice, null, { name: "Jean Buyer", phone: "677 11 22 33", email: null, notes: null, client_request_id: rq() });
const custId = cust.body.customer.id;
const sCust = await SALES.recordSale(alice, { locale: "en", lines: [{ description: "Haircut", quantity: 1, unit_price: 3000 }], customer_id: custId, method: "cash", client_request_id: rq() });
const custReceipt = await one(`select customer_snapshot from bk_documents where id = ${q(sCust.body.receipt.id)}`);
check("customer: an existing customer is linked (receipt snapshot has the name; the link points at the ONE customer)", sCust.status === 201 && custReceipt.customer_snapshot.name === "Jean Buyer" && (await count(`select count(*) n from bk_document_customer_links where document_id = '${sCust.body.receipt.id}' and customer_id = '${custId}'`)) === 1);
check("customer: recording a sale never creates a customer", (await count(`select count(*) n from bk_customers where profile_id = '${PR.alice}'`)) === 1);
const dupCust = await REC.saveContact(alice, null, { name: "Jean Duplicate", phone: "677112233", email: null, notes: null, client_request_id: rq() });
check("customer: creating a customer with an existing phone is reported (409), never duplicated", dupCust.status === 409 && (await count(`select count(*) n from bk_customers where profile_id = '${PR.alice}'`)) === 1);
const bobOwner = await ownerOf("bob");
const bobCust = (await REC.saveContact(bobOwner, null, { name: "Bob Customer", phone: null, email: null, notes: null, client_request_id: rq() })).body.customer.id;
alice = await ownerOf("alice");
const sForeign = await SALES.recordSale(alice, { locale: "en", lines: [{ description: "x", quantity: 1, unit_price: 100 }], customer_id: bobCust, method: "cash", client_request_id: rq() });
check("customer: another business's customer is refused (404) and records nothing", sForeign.status === 404 && sForeign.body.error === "customer_not_found" && (await entriesN()) === (await entriesN()));
await REC.setContactArchived(alice, custId, { archived: true });
const sArch = await SALES.recordSale(alice, { locale: "en", lines: [{ description: "x", quantity: 1, unit_price: 100 }], customer_id: custId, method: "cash", client_request_id: rq() });
check("customer: an archived customer is refused", sArch.status === 404);
await REC.setContactArchived(alice, custId, { archived: false });
const stmt = await REC.contactStatement(alice, custId);
check("customer: a sale receipt is NOT a debt (the customer statement lists invoices only)", stmt.status === 200 && JSON.stringify(stmt.body).indexOf(sCust.body.receipt.id) === -1);

// ------------------------------------------------------------------------ 8. gates
const danOwner = await ownerOf("dan").catch(() => null);
check("gate: an owner without the Toolkit plan cannot even resolve the Toolkit owner", danOwner === null);
globalThis.__signedIn = "alice";
const wrongActor = await alice.admin.rpc("sale_record", { p_profile_id: PR.alice, p_actor_user_id: U.bob, p_locale: "en", p_lines: [{ description: "x", quantity: "1", unit_price: "100" }], p_customer_id: null, p_method: "cash", p_sold_on: null, p_notes: null, p_client_request_id: rq() });
check("gate (database): another user acting for Alice's profile is refused", !!wrongActor.error && /not_owner/.test(wrongActor.error.message));
const demoCall = await alice.admin.rpc("sale_record", { p_profile_id: PR.fay, p_actor_user_id: U.fay, p_locale: "en", p_lines: [{ description: "x", quantity: "1", unit_price: "100" }], p_customer_id: null, p_method: "cash", p_sold_on: null, p_notes: null, p_client_request_id: rq() });
check("gate (database): a demo profile is refused", !!demoCall.error && /demo_profile_not_supported/.test(demoCall.error.message));
const noPlan = await alice.admin.rpc("sale_record", { p_profile_id: PR.dan, p_actor_user_id: U.dan, p_locale: "en", p_lines: [{ description: "x", quantity: "1", unit_price: "100" }], p_customer_id: null, p_method: "cash", p_sold_on: null, p_notes: null, p_client_request_id: rq() });
check("gate (database): a plan without the Business Toolkit is refused", !!noPlan.error && /toolkit_not_enabled/.test(noPlan.error.message));
const asAuth = await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U.alice}', false)`).then(async () => { try { await db.query(`select sale_record('${PR.alice}','${U.alice}','en','[]'::jsonb,null,'cash',null,null,'${rq()}')`); return "allowed"; } catch (e) { return "refused"; } finally { await db.exec("reset role"); } });
eq("gate (database): the browser role (authenticated) cannot call sale_record directly", asAuth, "refused");
const carolOwner = await ownerOf("carol");
const carolSale = await SALES.recordSale(carolOwner, { locale: "en", lines: [{ description: "Consulting hour", quantity: 2, unit_price: 25000 }], method: "bank_transfer", client_request_id: rq() });
check("categories: a professional-services page records a custom-item sale in its own books (no stock involved)", carolSale.status === 201 && (await count(`select count(*) n from bk_entries where profile_id = '${PR.carol}'`)) === 1 && (await count(`select count(*) n from bk_stock_movements where profile_id = '${PR.carol}'`)) === 0);
alice = await ownerOf("alice");

// ------------------------------------------------------------------------ 9. no double counting
const salesTotal = Number((await one(`select coalesce(sum(amount),0)::float8 s from bk_entries where profile_id = '${PR.alice}' and voided_at is null and kind = 'sale'`)).s);
const expected = 5000 + 2 * 5000 + 150000 + 14500 + 8000 + 2000 + 3000 + 100 + 3000 + 5000; // legacy payment + every successful sale above
const entrySum = await rows(`select amount::float8 a, category from bk_entries where profile_id = '${PR.alice}' and voided_at is null and kind = 'sale' order by created_at`);
check("double counting: every recorded sale is exactly ONE sale entry (receipts add no revenue; only the legacy invoice payment adds its own)", entrySum.length === (await entriesN()) - legacyEntries + legacyEntries && Math.abs(salesTotal - (entrySum.reduce((t, e) => t + e.a, 0))) < 0.001 && entrySum.filter((e) => e.category === "invoice_payment").length === 1, JSON.stringify({ salesTotal, expected, n: entrySum.length }));
eq("double counting: one sale entry per sale receipt (1:1 through source_id)", await count(`select count(*) n from bk_documents d where d.profile_id = '${PR.alice}' and d.source_type = 'sale' and not exists (select 1 from bk_entries e where e.id = d.source_id)`), 0);
eq("double counting: no two receipts share one entry", await count(`select count(*) n from (select source_id from bk_documents where source_type = 'sale' group by source_id having count(*) > 1) x`), 0);
const twin = await db.query(`insert into bk_documents (profile_id, doc_type, status, locale, currency, customer_snapshot, subtotal, discount_total, tax_total, total, source_type, source_id, created_by)
  values ('${PR.alice}','receipt','draft','en','XAF','{}',1,0,0,1,'sale','${entry1.id}','${U.alice}')`).then(() => "inserted", () => "refused");
eq("double counting: the database refuses a SECOND live receipt for the same sale entry", twin, "refused");
const orphan = await db.query(`insert into bk_documents (profile_id, doc_type, status, locale, currency, customer_snapshot, subtotal, discount_total, tax_total, total, created_by)
  values ('${PR.alice}','receipt','draft','en','XAF','{}',1,0,0,1,'${U.alice}')`).then(() => "inserted", () => "refused");
eq("integrity: a receipt with neither an invoice nor a sale behind it is still refused", orphan, "refused");
const wrongSource = await db.query(`insert into bk_documents (profile_id, doc_type, status, locale, currency, customer_snapshot, subtotal, discount_total, tax_total, total, source_type, source_id, created_by)
  values ('${PR.alice}','receipt','draft','en','XAF','{}',1,0,0,1,'bogus','${entry1.id}','${U.alice}')`).then(() => "inserted", () => "refused");
eq("integrity: an unknown source type is refused", wrongSource, "refused");

// invoice payments keep working exactly once through their own path
const invDraft = await DOC.createDraft(alice, { locale: "en", customer: { name: "Invoice Customer" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "Consulting", quantity: "1", unit_price: "10000" }], client_request_id: rq() });
await DOC.issueDocument(alice, invDraft.body.document.id);
const payBefore = await entriesN();
const pay = await DOC.recordPayment(alice, invDraft.body.document.id, { amount: "10000", method: "cash", paid_on: null, reference: null, client_request_id: rq() });
const payReceipt = await one(`select * from bk_documents where id = ${q(pay.body.receipt.document.id)}`);
check("invoice payment: still ONE entry, ONE receipt (a child of its invoice, now template v2), invoice paid", pay.status === 201 && (await entriesN()) - payBefore === 1 && payReceipt.parent_document_id === invDraft.body.document.id && payReceipt.source_type === null && payReceipt.template_version === 2 && (await one(`select status from bk_documents where id = '${invDraft.body.document.id}'`)).status === "paid");
const payView = await DOC.getDocument(alice, payReceipt.id);
check("invoice payment: its receipt is NOT a sale receipt (it keeps its invoice reference and balance)", payView.body.model.payment.sale === false && payView.body.parent?.id === invDraft.body.document.id);

// ------------------------------------------------------------------------ 10. the bookkeeping entry of a sale is protected
const guard = await entryIsSaleReceipt(alice.admin, entry1.id);
eq("guard: the sale's bookkeeping entry is recognised as belonging to a sale receipt", guard, "yes");
eq("guard: an ordinary manual entry is not", await entryIsSaleReceipt(alice.admin, (await recordEntry(alice, { kind: "sale", amount: "700", description: "manual" })).body.entry.id), "no");
const replace = await recordEntry(alice, { kind: "sale", amount: "999", replaces_entry_id: entry1.id });
check("guard: the sale entry cannot be replaced through the generic entry path (409 entry_linked_to_sale)", replace.status === 409 && replace.body.error === "entry_linked_to_sale", JSON.stringify(replace));
const voidRoute = load("app/api/bookkeeping/entries/[id]/void/route.ts");
globalThis.__signedIn = "alice";
const voided = await voidRoute.POST(new Request("https://x.test", { method: "POST", body: JSON.stringify({ reason: "mistake" }), headers: { "content-type": "application/json" } }), { params: { id: entry1.id } });
check("guard: the sale entry cannot be voided on its own (409 entry_linked_to_sale)", voided.status === 409 && (await voided.json()).error === "entry_linked_to_sale");
check("guard: the entry is still live afterwards", (await one(`select voided_at from bk_entries where id = '${entry1.id}'`)).voided_at === null);

// ------------------------------------------------------------------------ 11. online purchases and inventory views are unchanged
const detail = await INV.productDetail(alice, prod, {});
check("inventory view: the Toolkit inventory page still reads the same single balance and the ledger rows (with the recorded sales)", detail.status === 200 && detail.body.product.count === 94 || detail.body.product?.count === (await stock(prod)), JSON.stringify(detail.body.product));
check("inventory view: the recorded sales appear as 'sold elsewhere' movements in the product history", detail.status === 200 && detail.body.movements.filter((m) => m.kind === "sold_elsewhere").length >= 3);
const poCols = (await rows(`select column_name from information_schema.columns where table_name = 'product_orders'`)).map((r) => r.column_name);
check("online sales: product_orders and its reservation columns are exactly as the checkout migration left them (the Record Sale migration adds nothing there)", poCols.includes("stock_released_at") && !poCols.some((c) => /sale|receipt/i.test(c)));
const reserved = await db.query(`insert into product_orders (profile_id, status, total, currency, order_number) values ('${PR.alice}','awaiting_payment', 5000, 'XAF', 'T-1') returning id`).then((r) => r.rows[0].id, () => null);
if (reserved) {
  await db.query(`insert into product_order_items (order_id, product_id, quantity, unit_price, line_total, name_snapshot) values ('${reserved}','${prod}',2,2500,5000,'Red Shirt')`).catch(() => null);
  const d2 = await INV.productDetail(alice, prod, {});
  check("online sales: an awaiting-payment Ringo order still shows as RESERVED in the same inventory view (read from product_orders, untouched)", d2.status === 200 && d2.body.reserved === 2, JSON.stringify({ reserved: d2.body.reserved }));
} else check("online sales: (order fixture unavailable in this reduced schema; reservation view covered by inventory.test.mjs)", true);

// ------------------------------------------------------------------------ 12. payment details and branding on invoices
const savedPd = await DOC.putBusinessProfile(alice, { display_name: "Alice Shop", legal_name: null, address: null, phone: null, email: null, tax_id: null, registration_no: null, default_terms: "Thanks!", default_due_days: null, tax_label: null, tax_rate_bp: null,
  payment_details: { bank_name: "Afriland", account_name: "Alice Shop SARL", account_number: "00123", momo_provider: "MTN", momo_number: "677000000", instructions: "Quote the invoice number", evil_key: "x" } });
check("payment details: saved through the business-profile form's single request (unknown keys are dropped by the database)", savedPd.status === 200 && JSON.stringify(Object.keys(savedPd.body.payment_details).sort()) === JSON.stringify(["account_name", "account_number", "bank_name", "instructions", "momo_number", "momo_provider"]), JSON.stringify(savedPd.body));
const badPd = await DOC.putBusinessProfile(alice, { display_name: "Alice Shop", payment_details: { bank_name: "x".repeat(200) } });
check("payment details: an over-long value is refused", badPd.status === 400, JSON.stringify(badPd));
const clearedLater = JSON.stringify(savedPd.body.payment_details);
const inv2 = await DOC.createDraft(alice, { locale: "en", customer: { name: "Pay Customer" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "Design", quantity: "1", unit_price: "40000" }], client_request_id: rq() });
await DOC.issueDocument(alice, inv2.body.document.id);
const inv2Row = await one(`select * from bk_documents where id = ${q(inv2.body.document.id)}`);
check("invoice: a NEW invoice is issued as template v2 with the logo, accent colour and payment details frozen in its snapshot", inv2Row.template_version === 2 && inv2Row.seller_snapshot.accent_color === "#ff0000" && /^[0-9a-f-]{36}$/.test(inv2Row.seller_snapshot.logo_asset_id || "") && inv2Row.seller_snapshot.payment_details.bank_name === "Afriland", JSON.stringify(inv2Row.seller_snapshot));
const inv2Pdf = Buffer.from((await DOC.renderPdf(alice, inv2.body.document.id)).pdf);
check("invoice: the PDF shows the payment details and carries NO Ringo footer", has(inv2Pdf, "Afriland") && has(inv2Pdf, "How to pay") && has(inv2Pdf, "677000000") && !has(inv2Pdf, "Generated with Ringo Connect"));
const inv2Before = { snap: inv2Row.seller_snapshot, hash: inv2Row.content_hash };
await exec(`update profiles set avatar_url = 'https://files.test/alice-logo-3.png', theme_color = '#00ff00' where id = '${PR.alice}'`);
await DOC.putBusinessProfile(alice, { display_name: "Alice Shop", default_terms: null, payment_details: { bank_name: "Other Bank" } });
const inv2After = await one(`select seller_snapshot, content_hash from bk_documents where id = ${q(inv2.body.document.id)}`);
eq("history: changing the logo, colour and payment details later does NOT change the issued invoice (snapshot and hash)", { snap: inv2After.seller_snapshot, hash: inv2After.content_hash }, inv2Before);
const inv2PdfAfter = Buffer.from((await DOC.renderPdf(alice, inv2.body.document.id)).pdf);
check("history: its PDF still shows the ORIGINAL payment details after the change (reproducible)", has(inv2PdfAfter, "Afriland") && !has(inv2PdfAfter, "Other Bank"));
const inv3 = await DOC.createDraft(alice, { locale: "en", customer: { name: "Later Customer" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "Later", quantity: "1", unit_price: "1000" }], client_request_id: rq() });
await DOC.issueDocument(alice, inv3.body.document.id);
const inv3Row = await one(`select seller_snapshot from bk_documents where id = ${q(inv3.body.document.id)}`);
check("invoice: the next invoice picks up the new branding and details", inv3Row.seller_snapshot.accent_color === "#00ff00" && inv3Row.seller_snapshot.payment_details.bank_name === "Other Bank");
const noBrand = await ownerOf("bob");
await DOC.putBusinessProfile(noBrand, { display_name: "Bob Shop", default_terms: null });
const inv4 = await DOC.createDraft(noBrand, { locale: "en", customer: { name: "Bob Cust" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "x", quantity: "1", unit_price: "1000" }], client_request_id: rq() });
await DOC.issueDocument(noBrand, inv4.body.document.id);
const inv4Pdf = Buffer.from((await DOC.renderPdf(noBrand, inv4.body.document.id)).pdf);
check("invoice: a business with no logo and no payment details still gets a clean invoice (fallback: no 'How to pay' block, no footer)", inv4Pdf.subarray(0, 4).toString() === "%PDF" && !has(inv4Pdf, "How to pay") && !has(inv4Pdf, "Generated with Ringo Connect"));
void clearedLater;
alice = await ownerOf("alice");


// ------------------------------------------------------------------------ 12b. HISTORICAL BRANDING IS FROZEN (logo, accent colour, payment details, seller identity)
fetchMode = "serve";
await exec(`update profiles set avatar_url = 'https://files.test/alice-logo-1.png', theme_color = '#112233', name = 'Alice Shop' where id = '${PR.alice}'`);
await DOC.putBusinessProfile(alice, { display_name: "Alice Original Shop", legal_name: "Alice Original SARL", address: "1 Old Street", phone: "677111111", email: null, tax_id: null, registration_no: null, default_terms: null, default_due_days: null, tax_label: null, tax_rate_bp: null, payment_details: { bank_name: "FirstBank", momo_number: "677111111" } });
const dA = await DOC.createDraft(alice, { locale: "en", customer: { name: "Frozen Customer" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "Frozen work", quantity: "1", unit_price: "9000" }], client_request_id: rq() });
await DOC.issueDocument(alice, dA.body.document.id);
const docA = await one(`select * from bk_documents where id = ${q(dA.body.document.id)}`);
const assetA = await one(`select id, sha256 from bk_brand_assets where id = ${q(docA.seller_snapshot.logo_asset_id)}`);
check("frozen: Logo A (red) was copied into the immutable store and referenced by the document's snapshot together with its sha256", !!assetA && docA.seller_snapshot.logo_sha256 === assetA.sha256 && docA.template_version === 2);
const pdfA0 = Buffer.from((await DOC.renderPdf(alice, docA.id)).pdf);
check("frozen: the PDF carries Logo A (red pixel), the first accent colour, FirstBank and the original identity", pdfHasPixel(pdfA0, [220, 20, 20]) && !pdfHasPixel(pdfA0, [20, 200, 20]) && has(pdfA0, "FirstBank") && has(pdfA0, "Alice Original Shop") && has(pdfA0, "1 Old Street"));
const shareA = await DOC.createShare(alice, docA.id, { expires_in_days: 7 }, "https://ringo.test");
const tokenA = (shareA.body.url || "").split("/d/")[1];
const logoShared0 = await openSharedLogo(alice.admin, tokenA, "1.2.3.4");
check("frozen: the share link's logo route serves Logo A's exact bytes", logoShared0.kind === "ok" && Buffer.compare(Buffer.from(logoShared0.bytes), PNG_RED) === 0, logoShared0.kind);

// the business now REPLACES the logo (green), changes the accent colour, the payment details and its whole identity, and issues a new document
await exec(`update profiles set avatar_url = 'https://files.test/alice-logo-3.png', theme_color = '#00ff00' where id = '${PR.alice}'`);
await DOC.putBusinessProfile(alice, { display_name: "Alice Renamed Shop", legal_name: "Alice Renamed SARL", address: "9 New Avenue", phone: "677999999", email: null, tax_id: null, registration_no: null, default_terms: null, default_due_days: null, tax_label: null, tax_rate_bp: null, payment_details: { bank_name: "SecondBank", momo_number: "677999999" } });
const dC = await DOC.createDraft(alice, { locale: "en", customer: { name: "New Customer" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "New work", quantity: "1", unit_price: "1000" }], client_request_id: rq() });
await DOC.issueDocument(alice, dC.body.document.id);
const docC = await one(`select * from bk_documents where id = ${q(dC.body.document.id)}`);
check("frozen: the new document references a DIFFERENT copy (Logo C, green) and the new colour, details and identity", docC.seller_snapshot.logo_asset_id !== docA.seller_snapshot.logo_asset_id && docC.seller_snapshot.accent_color === "#00ff00" && docC.seller_snapshot.payment_details.bank_name === "SecondBank" && docC.seller_snapshot.display_name === "Alice Renamed Shop");
// the network goes DOWN and the old picture's file is deleted: nothing may change for the old document
fetchMode = "offline";
LOGOS = {};
const fetchesBefore = fetchLog.length;
const pdfA1 = Buffer.from((await DOC.renderPdf(alice, docA.id)).pdf);
check("frozen: re-rendering Document A after the logo, colour, payment details and identity changed, with the network down and the old file gone, is BYTE-FOR-BYTE identical", Buffer.compare(pdfA0, pdfA1) === 0);
check("frozen: ...it still uses Logo A, the first accent colour, FirstBank, the original name and address (never the new ones)", pdfHasPixel(pdfA1, [220, 20, 20]) && !pdfHasPixel(pdfA1, [20, 200, 20]) && has(pdfA1, "FirstBank") && !has(pdfA1, "SecondBank") && has(pdfA1, "Alice Original Shop") && !has(pdfA1, "Alice Renamed Shop") && has(pdfA1, "1 Old Street") && !has(pdfA1, "9 New Avenue"));
check("frozen: rendering (owner download and public logo/PDF) made no network request at all", fetchLog.length === fetchesBefore);
const pdfC = Buffer.from((await DOC.renderPdf(alice, docC.id)).pdf);
check("frozen: the NEW document renders with Logo C (green) and the new identity (so the old one is frozen, not merely unchanged)", pdfHasPixel(pdfC, [20, 200, 20]) && !pdfHasPixel(pdfC, [220, 20, 20]) && has(pdfC, "Alice Renamed Shop") && has(pdfC, "SecondBank"));
await exec(`update profiles set avatar_url = null where id = '${PR.alice}'`);
const pdfA2 = Buffer.from((await DOC.renderPdf(alice, docA.id)).pdf);
check("frozen: DELETING the profile picture does not change Document A either (identical bytes, Logo A)", Buffer.compare(pdfA0, pdfA2) === 0 && pdfHasPixel(pdfA2, [220, 20, 20]));
const logoShared1 = await openSharedLogo(alice.admin, tokenA, "1.2.3.4");
check("frozen: the share link still serves Logo A after the picture was replaced and then deleted", logoShared1.kind === "ok" && Buffer.compare(Buffer.from(logoShared1.bytes), PNG_RED) === 0);
const sharedPdf = await load("lib/documents/publicShare.ts").openSharedPdf(alice.admin, tokenA, "1.2.3.4");
check("frozen: the public PDF behind the link is the same bytes too", sharedPdf.kind === "ok" && Buffer.compare(Buffer.from(sharedPdf.result.pdf), pdfA0) === 0);
const docAAfter = await one(`select seller_snapshot, content_hash from bk_documents where id = ${q(docA.id)}`);
eq("frozen: Document A's stored snapshot and content hash never moved", { snap: docAAfter.seller_snapshot, hash: docAAfter.content_hash }, { snap: docA.seller_snapshot, hash: docA.content_hash });
const assetBytes = await loadBrandAsset(alice.admin, PR.alice, assetA.id);
check("frozen: the stored copy still holds Logo A's exact bytes", !!assetBytes && Buffer.compare(Buffer.from(assetBytes.bytes), PNG_RED) === 0);
check("frozen: another business cannot read this logo copy", (await loadBrandAsset(alice.admin, PR.bob, assetA.id)) === null);
const updAsset = await db.query(`update bk_brand_assets set bytes = '\\x00'::bytea where id = '${assetA.id}'`).then(() => "updated", () => "refused");
const delAsset = await db.query(`delete from bk_brand_assets where id = '${assetA.id}'`).then(() => "deleted", () => "refused");
eq("frozen: a stored logo copy can never be changed or deleted (even by the database owner role)", [updAsset, delAsset], ["refused", "refused"]);
const bytesRead = await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U.alice}', false)`).then(async () => { try { await db.query(`select bytes from bk_brand_assets limit 1`); return "read"; } catch { return "refused"; } finally { await db.exec("reset role"); } });
const bytesReadSvc = await db.exec(`set role service_role`).then(async () => { try { await db.query(`select bytes from bk_brand_assets limit 1`); return "read"; } catch { return "refused"; } finally { await db.exec("reset role"); } });
eq("frozen: the image bytes are not selectable by the browser role or even by a plain service-role table read (only the controlled function returns them)", [bytesRead, bytesReadSvc], ["refused", "refused"]);
// an out-of-date copy is never frozen into a new document; a failed sync never blocks issuing
await exec(`update profiles set avatar_url = 'https://files.test/alice-logo-9.png' where id = '${PR.alice}'`);
const snapNoSync = await one(`select bk_doc_seller_snapshot('${PR.alice}') s`);
check("frozen: a profile picture that has not been copied yet is NOT frozen as a stale or live reference (the snapshot carries no logo)", snapNoSync.s.logo_asset_id === null && snapNoSync.s.logo_sha256 === null);
fetchMode = "serve";
const dN = await DOC.createDraft(alice, { locale: "en", customer: { name: "No Logo Customer" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "x", quantity: "1", unit_price: "500" }], client_request_id: rq() });
const issuedN = await DOC.issueDocument(alice, dN.body.document.id);
const docN = await one(`select seller_snapshot from bk_documents where id = ${q(dN.body.document.id)}`);
check("frozen: when the picture cannot be read (404) the document is still issued, without a logo", issuedN.status === 200 && docN.seller_snapshot.logo_asset_id === null);
const rejected = await alice.admin.rpc("doc_set_brand_logo", { p_profile_id: PR.alice, p_actor_user_id: U.alice, p_source_url: "https://files.test/x.png", p_content_type: "image/png", p_b64: Buffer.from("this is not a png at all").toString("base64") });
const rejected2 = await alice.admin.rpc("doc_set_brand_logo", { p_profile_id: PR.alice, p_actor_user_id: U.alice, p_source_url: "http://files.test/x.png", p_content_type: "image/png", p_b64: PNG_RED.toString("base64") });
const rejected3 = await alice.admin.rpc("doc_set_brand_logo", { p_profile_id: PR.alice, p_actor_user_id: U.bob, p_source_url: "https://files.test/x.png", p_content_type: "image/png", p_b64: PNG_RED.toString("base64") });
check("frozen: the database refuses a non-image, a non-https source and another user's attempt", !!rejected.error && /invalid_logo/.test(rejected.error.message) && !!rejected2.error && !!rejected3.error && /not_owner/.test(rejected3.error.message));
await exec(`update profiles set avatar_url = 'https://files.test/alice-logo-3.png', theme_color = '#00ff00' where id = '${PR.alice}'`);
alice = await ownerOf("alice");

// ------------------------------------------------------------------------ 12c. VOID A RECORDED SALE: atomic, exactly once, history kept
const voidRoute2 = load("app/api/sales/[id]/void/route.ts");
const voidCall = (id, who, reason = "customer changed mind") => { globalThis.__signedIn = who; return voidRoute2.POST(new Request("https://x.test", { method: "POST", body: JSON.stringify({ reason }), headers: { "content-type": "application/json" } }), { params: { id } }); };
const sold = async (lines, extra = {}) => { alice = await ownerOf("alice"); const r = await SALES.recordSale(alice, { locale: "en", lines, method: "cash", client_request_id: rq(), ...extra }); if (r.status !== 201) throw new Error("setup sale failed " + JSON.stringify(r)); return r.body.receipt; };
const entryIdOf = async (receiptId) => (await one(`select source_id from bk_documents where id = ${q(receiptId)}`)).source_id;
const liveSaleSum = async () => Number((await one(`select coalesce(sum(amount),0)::float8 s from bk_entries where profile_id = '${PR.alice}' and voided_at is null and kind = 'sale'`)).s);
const backMoves = (id) => rows(`select kind, qty_delta, balance_before, balance_after, reason, note from bk_stock_movements where product_id = '${id}' and reason = 'Sale voided' order by created_at`);
const entryEvents = async (entryId) => (await rows(`select event_type from bk_entry_events where entry_id = '${entryId}' order by created_at`)).map((e) => e.event_type);

// a sale of 3 tracked units + a custom line, for a customer, then voided
const custV = (await REC.saveContact(alice, null, { name: "Void Customer", phone: null, email: null, notes: null, client_request_id: rq() })).body.customer.id;
const rcV = await sold([{ product_id: prod, quantity: 3, unit_price: 4000 }, { description: "Engraving", quantity: 1, unit_price: 500 }], { customer_id: custV });
const entryV = await entryIdOf(rcV.id);
const stockBeforeVoid = await stock(prod), liveBefore = await liveSaleSum(), entriesBeforeVoid = await entriesN(), productsBefore = await count(`select count(*) n from products where profile_id = '${PR.alice}'`);
check("void setup: the sale took 3 units and its entry is live", (await one(`select voided_at from bk_entries where id = '${entryV}'`)).voided_at === null && (await movements(prod)).at(-1).qty_delta === -3);
const v1 = await voidCall(rcV.id, "alice");
const v1b = await v1.json();
check("void: the owner voids the sale (200) and the answer says one product's stock was restored", v1.status === 200 && v1b.receipt.status === "void" && v1b.already_voided === false && v1b.stock_restored === 1 && v1b.stock_not_restored === 0, JSON.stringify(v1b));
const rVoided = await one(`select status, voided_at, voided_by, void_reason, number, total::float8 t from bk_documents where id = ${q(rcV.id)}`);
check("void: the receipt is marked VOID (kept, with its number, total, reason and who voided it), never deleted", rVoided.status === "void" && rVoided.voided_at !== null && rVoided.voided_by === U.alice && rVoided.void_reason === "customer changed mind" && rVoided.t === 12500 && (await count(`select count(*) n from bk_document_lines where document_id = '${rcV.id}'`)) === 2);
eq("void: inventory restored by exactly 3 (the exact quantity the sale took)", (await stock(prod)) - stockBeforeVoid, 3);
eq("void: ONE restoring movement through the existing ledger (increase +3, 'Sale voided', the receipt number), and the original sale movement is still there", [await backMoves(prod), (await rows(`select 1 from bk_stock_movements where product_id = '${prod}' and kind = 'sold_elsewhere' and qty_delta = -3 and client_request_id = md5((select client_request_id::text from bk_documents where id = '${rcV.id}') || ':1')::uuid`)).length], [[{ kind: "increase", qty_delta: 3, balance_before: stockBeforeVoid, balance_after: stockBeforeVoid + 3, reason: "Sale voided", note: rcV.number }], 1]);
const eV = await one(`select voided_at, void_reason, amount::float8 a from bk_entries where id = '${entryV}'`);
check("void: the bookkeeping sale is VOIDED (kept, marked, with an event) - not deleted, and no negative or second entry was created", eV.voided_at !== null && /Sale voided/.test(eV.void_reason) && eV.a === 12500 && (await entriesN()) === entriesBeforeVoid && (await entryEvents(entryV)).filter((x) => x === "voided").length === 1);
eq("void: revenue dropped by exactly the sale (12 500), once", liveBefore - (await liveSaleSum()), 12500);
check("void: the customer and the product are untouched", (await count(`select count(*) n from bk_customers where id = '${custV}' and archived_at is null`)) === 1 && (await count(`select count(*) n from products where profile_id = '${PR.alice}'`)) === productsBefore);
const shownV = await DOC.getDocument(alice, rcV.id);
check("void: the receipt still opens, says void, and offers no further void", shownV.status === 200 && shownV.body.status === "void" && shownV.body.void_reason === "customer changed mind" && shownV.body.actions.voidSale === false && shownV.body.model.isVoid === true);
const pdfV = Buffer.from((await DOC.renderPdf(alice, rcV.id)).pdf);
check("void: its PDF still renders (history kept) and is watermarked VOID", pdfV.subarray(0, 4).toString() === "%PDF" && has(pdfV, "VOID") && has(pdfV, "Engraving"));
check("void: the document hash still verifies (the PDF route's tamper check passes after a void)", (await DOC.renderPdf(alice, rcV.id)).status === 200);

// a second void is idempotent: nothing is reversed twice
const stockAfter1 = await stock(prod), liveAfter1 = await liveSaleSum();
const v2 = await voidCall(rcV.id, "alice", "again");
const v2b = await v2.json();
check("void twice: the second call answers 200 already_voided and changes NOTHING (stock, movements, entry events, revenue, reason)", v2.status === 200 && v2b.already_voided === true && v2b.stock_restored === 0 && (await stock(prod)) === stockAfter1 && (await backMoves(prod)).length === 1 && (await entryEvents(entryV)).filter((x) => x === "voided").length === 1 && (await liveSaleSum()) === liveAfter1 && (await one(`select void_reason from bk_documents where id = ${q(rcV.id)}`)).void_reason === "customer changed mind");

// concurrent voids of one sale: one reversal
const rcC = await sold([{ product_id: prod, quantity: 2 }]);
const entryC = await entryIdOf(rcC.id);
const stockC0 = await stock(prod), liveC0 = await liveSaleSum();
const burstV = await Promise.all([1, 2, 3, 4, 5].map(() => voidCall(rcC.id, "alice", "race")));
const burstBodies = await Promise.all(burstV.map((r) => r.json()));
check("void concurrency: five simultaneous voids answer 200 and exactly ONE reversal happens (one restore of 2, one entry void, one receipt void)", burstV.every((r) => r.status === 200) && burstBodies.filter((b) => b.already_voided === false).length === 1 && (await stock(prod)) === stockC0 + 2 && (await backMoves(prod)).length === 2 && (await entryEvents(entryC)).filter((x) => x === "voided").length === 1 && stockC0 + 2 === (await stock(prod)) && liveC0 - (await liveSaleSum()) === 5000 * 2, JSON.stringify({ burstBodies: burstBodies.map((b) => b.already_voided), stock: await stock(prod), stockC0 }));

// a failing reversal rolls EVERYTHING back (stock, entry, receipt), and the void can be retried afterwards
const rcF = await sold([{ product_id: prod, quantity: 1 }]);
const entryF = await entryIdOf(rcF.id);
const snapF = async () => ({ stock: await stock(prod), moves: (await backMoves(prod)).length, entryVoided: (await one(`select voided_at is not null v from bk_entries where id = '${entryF}'`)).v, status: (await one(`select status from bk_documents where id = ${q(rcF.id)}`)).status, live: await liveSaleSum(), events: (await entryEvents(entryF)).length });
const baseF = await snapF();
await exec(`create or replace function rs_fail_void() returns trigger language plpgsql as $$ begin if new.void_reason = 'FAIL-VOID' then raise exception 'injected_failure'; end if; return new; end $$;
  create trigger rs_fail_void_trg before update on bk_documents for each row execute function rs_fail_void();`);
const vf = await voidCall(rcF.id, "alice", "FAIL-VOID");
check("void failure: an error while marking the receipt (after the entry was voided and the stock put back) is a 500 and undoes EVERYTHING", vf.status === 500 && JSON.stringify(await snapF()) === JSON.stringify(baseF) && baseF.status === "issued" && baseF.entryVoided === false, JSON.stringify({ s: vf.status, now: await snapF(), baseF }));
await exec(`drop trigger rs_fail_void_trg on bk_documents; drop function rs_fail_void();`);
const vRetry = await voidCall(rcF.id, "alice", "retry works");
check("void failure: after the fault is gone the same void succeeds, once", vRetry.status === 200 && (await one(`select status from bk_documents where id = ${q(rcF.id)}`)).status === "void" && (await stock(prod)) === baseF.stock + 1);

// custom-only and untracked sales: nothing to restore
const rcCustom = await sold([{ description: "Consulting", quantity: 1, unit_price: 25000 }]);
const stockU0 = await stock(prod), movesU0 = await count(`select count(*) n from bk_stock_movements where profile_id = '${PR.alice}'`);
const vCustom = await (await voidCall(rcCustom.id, "alice")).json();
check("void: a custom item sale is voided without any stock movement", vCustom.already_voided === false && vCustom.stock_restored === 0 && (await count(`select count(*) n from bk_stock_movements where profile_id = '${PR.alice}'`)) === movesU0 && (await stock(prod)) === stockU0);
const rcUnt = await sold([{ product_id: prodUntracked, quantity: 2 }]);
const vUnt = await (await voidCall(rcUnt.id, "alice")).json();
check("void: an untracked product's sale is voided and its (null) stock is never invented", vUnt.already_voided === false && vUnt.stock_restored === 0 && (await stock(prodUntracked)) === null);
// tracking stopped after the sale: nothing to restore, and it is reported, not invented
const prodStop = (await one(`insert into products (profile_id, name, price, inventory_count) values ('${PR.alice}','Stopped Item',1000,10) returning id`)).id;
await INV.startTracking(alice, prodStop, { opening_quantity: 10, low_stock_threshold: 1, client_request_id: rq() });
const rcStop = await sold([{ product_id: prodStop, quantity: 4 }]);
await INV.stopTracking(alice, prodStop, { note: "stop", client_request_id: rq() });
const countAfterStop = await stock(prodStop);
const vStop = await (await voidCall(rcStop.id, "alice")).json();
check("void: if stock tracking was stopped after the sale the sale is still voided, the stock is NOT touched, and the answer reports it was not restored", vStop.already_voided === false && vStop.stock_restored === 0 && vStop.stock_not_restored === 1 && (await stock(prodStop)) === countAfterStop);

// who may void
const rcAuth = await sold([{ product_id: prod, quantity: 1 }]);
const stockAuth = await stock(prod);
const asBob = await voidCall(rcAuth.id, "bob");
check("authorization: another business cannot void it (404, nothing changes)", asBob.status === 404 && (await one(`select status from bk_documents where id = ${q(rcAuth.id)}`)).status === "issued" && (await stock(prod)) === stockAuth);
const anon = await voidCall(rcAuth.id, null);
check("authorization: with no signed-in session the void is refused (401/403) and nothing changes", [401, 403].includes(anon.status) && (await one(`select status from bk_documents where id = ${q(rcAuth.id)}`)).status === "issued");
const wrongActorV = await alice.admin.rpc("sale_void", { p_profile_id: PR.alice, p_actor_user_id: U.bob, p_receipt_id: rcAuth.id, p_reason: "x" });
check("authorization (database): another user acting for Alice's profile is refused", !!wrongActorV.error && /not_owner/.test(wrongActorV.error.message));
const otherProfileV = await alice.admin.rpc("sale_void", { p_profile_id: PR.bob, p_actor_user_id: U.bob, p_receipt_id: rcAuth.id, p_reason: "x" });
check("authorization (database): Bob acting for his OWN profile cannot reach Alice's receipt", !!otherProfileV.error && /document_not_found/.test(otherProfileV.error.message));
const noReasonV = await alice.admin.rpc("sale_void", { p_profile_id: PR.alice, p_actor_user_id: U.alice, p_receipt_id: rcAuth.id, p_reason: "  " });
check("validation: a void needs a reason", !!noReasonV.error && /reason_required/.test(noReasonV.error.message) && (await one(`select status from bk_documents where id = ${q(rcAuth.id)}`)).status === "issued");
const asBrowser = await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U.alice}', false)`).then(async () => { try { await db.query(`select sale_void('${PR.alice}','${U.alice}','${rcAuth.id}','x')`); return "allowed"; } catch { return "refused"; } finally { await db.exec("reset role"); } });
eq("authorization (database): the browser role cannot call sale_void directly", asBob.status === 404 ? asBrowser : "x", "refused");
check("scope: only a SALE receipt can be voided this way (an invoice-payment receipt and an invoice are refused)", (await alice.admin.rpc("sale_void", { p_profile_id: PR.alice, p_actor_user_id: U.alice, p_receipt_id: payReceipt.id, p_reason: "x" })).error?.message?.includes("document_not_found") && (await alice.admin.rpc("sale_void", { p_profile_id: PR.alice, p_actor_user_id: U.alice, p_receipt_id: invDraft.body.document.id, p_reason: "x" })).error?.message?.includes("document_not_found"));
const voidedStillGuard = await entryIsSaleReceipt(alice.admin, entryV);
check("history: after a void the entry is kept (voided) and a voided receipt no longer locks it", voidedStillGuard === "no" && (await one(`select count(*) n from bk_entries where id = '${entryV}'`)).n === "1" || Number((await one(`select count(*) n from bk_entries where id = '${entryV}'`)).n) === 1);
globalThis.__signedIn = "alice";
alice = await ownerOf("alice");

// ------------------------------------------------------------------------ 13. rollback safety
const rbRefuse = await db.exec(ROLLBACK).then(() => "ran", (e) => e.message.split("\n")[0]);
await db.exec("rollback").catch(() => null); // the script opens its own transaction; a refusal aborts it
check("rollback: refuses while sale receipts, v2 documents or payment details exist (and changes nothing)", /exist|must/.test(String(rbRefuse)) && (await saleReceiptsN()) > 0, rbRefuse);
check("rollback: the refusal left the constraints and functions in place", (await saleRecordInstalled(alice.admin)) === true);

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`recordSaleSql: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
