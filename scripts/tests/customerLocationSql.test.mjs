// Business Toolkit — customer LOCATION on the receipt: the REAL path (handler -> bk_customer_save -> sale_record -> receipt) against the REAL SQL.
//
// What is real: the repository's Shop checkout foundation and Business Toolkit Phase 1-4 migrations, the Record Sale migration (2026-12-06) and the un-applied
// 2026-12-15 customer-location migration, on in-memory PostgreSQL (PGlite, a real PostgreSQL engine in WASM): the customer book, bk_record_entry, inv_adjust_stock,
// bk_doc_issue_core, the immutability triggers, the CHECK constraints, the grants and the RLS policies are genuinely evaluated. The application code is the REAL code: the
// receivables handlers (customer save), the sales handlers (record sale), the documents handlers (view, PDF) and the public receipt page. Stand-ins: the PostgREST layer
// (scripts/tests/pgliteShim.mjs), roles / auth.uid(), the session, reduced users / plans / profiles / products tables.
// It never connects to Supabase or any real database, never reads .env.local, and the migration is only ever applied to scratch in-memory databases.
//
// Two worlds are built: OLD (migrations up to 2026-12-06) and NEW (plus 2026-12-15). The same sales are recorded in both and the financial results are compared, so
// "the location changes nothing but the location" is proven by running the old and the new function side by side, not argued.
//   Run:  node scripts/tests/customerLocationSql.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { makeClientFactory, q } from "./pgliteShim.mjs";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");

const tmp = [];
const serverStub = path.join(os.tmpdir(), `cl_server_${process.pid}.cjs`);
fs.writeFileSync(serverStub, "module.exports = { createClient: () => globalThis.__sessionClient(), createAdminClient: () => globalThis.__adminClient() };");
tmp.push(serverStub);
const jiti = require("jiti")(import.meta.url, { alias: { "@/lib/supabase/server": serverStub, "@": SRC }, interopDefault: true, cache: false });
const load = (p) => jiti(path.join(SRC, p));
const SALES = load("lib/sales/handlers.ts");
const DOC = load("lib/documents/handlers.ts");
const REC = load("lib/receivables/handlers.ts");
const { resolveBookkeepingOwner } = load("lib/bookkeeping/access.ts");
const SNAP = load("lib/documents/snapshot.ts");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const ts = require("typescript");
const compileTsx = (rel, extra = (x) => x) => {
  const out = ts.transpileModule(read(rel), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true } }).outputText
    .replace(/require\("react\/jsx-runtime"\)/g, `require(${JSON.stringify(require.resolve("react/jsx-runtime"))})`)
    .replace(/require\("@\/([^"]+)"\)/g, (_, p) => `require(${JSON.stringify(path.join(SRC, p + ".ts").split(path.sep).join("/"))})`);
  const file = path.join(os.tmpdir(), `cl_${path.basename(rel).replace(/\W/g, "_")}_${process.pid}.cjs`);
  fs.writeFileSync(file, extra(out));
  tmp.push(file);
  return file;
};
const printFile = compileTsx("src/components/documents/PrintButton.tsx");
const PublicDocumentView = jiti(compileTsx("src/components/documents/PublicDocumentView.tsx", (o) => o.replace(/require\("\.\/PrintButton"\)/g, `require(${JSON.stringify(printFile.split(path.sep).join("/"))})`))).default;
const zlib = require("zlib");

console.error = () => {};
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 500)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

globalThis.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }); // the sellers here have no picture: nothing is fetched
const hex = (str) => Buffer.from(str, "latin1").toString("hex").toUpperCase();
const pdfText = (bytes) => {
  const buf = Buffer.from(bytes); let out = ""; let i = 0; const s = buf.toString("latin1");
  for (;;) {
    const a = s.indexOf("stream", i); if (a < 0) break;
    const start = s[a + 6] === "\r" ? a + 8 : a + 7; const end = s.indexOf("endstream", start); if (end < 0) break;
    try { out += zlib.inflateSync(buf.subarray(start, end)).toString("latin1"); } catch { out += buf.subarray(start, end).toString("latin1"); }
    i = end + 9;
  }
  return out;
};
const pdfHas = (bytes, str) => pdfText(bytes).includes(hex(str));

const ID = (p, n) => `${p}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const USER = ID("c", 1), PROFILE = ID("a", 1), PLAN = ID("d", 1);
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let rqn = 100;
const rq = () => RQ(++rqn);

const MIG = ["2026-11-02_product_checkout_foundation", "2026-12-01_bookkeeping_foundation", "2026-12-02_documents_invoices_receipts", "2026-12-03_debtors_reminders", "2026-12-04_inventory_stock_control", "2026-12-06_record_sale_receipts_branding"];
const MIG_LOC = read("supabase/migrations/2026-12-15_customer_location.sql");
const ROLLBACK_LOC = read("supabase/support/2026-12-15_customer_location.rollback.sql");
const VERIFY_LOC = read("supabase/support/2026-12-15_customer_location.verify.sql");

// ------------------------------------------------------------------------ a database, built from the repository's own migrations
async function makeWorld(applyLocation) {
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
  for (const m of MIG) await db.exec(read(`supabase/migrations/${m}.sql`));
  if (applyLocation) await db.exec(MIG_LOC);
  await db.exec(`
    insert into public.plans (id, name, ai_enabled, business_toolkit_enabled) values ('${PLAN}','full',true,true);
    insert into public.users (id, email, plan_id) values ('${USER}','b@x.test','${PLAN}');
    insert into public.profiles (id, user_id, username, name, currency, avatar_url, theme_color, is_demo, category) values
      ('${PROFILE}','${USER}','bob','Bob Shop','XAF',null,'#4F46E5',false,'business_ecommerce');
  `);
  const client = makeClientFactory(db);
  const activate = () => {
    globalThis.__signedIn = true;
    globalThis.__sessionClient = () => ({ auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) }, ...client("authenticated", () => USER) });
    globalThis.__adminClient = () => client("service_role", () => null);
  };
  const owner = async () => { activate(); const r = await resolveBookkeepingOwner(); if (!r.ok) throw new Error(`owner: ${r.reason}`); return r.owner; };
  const one = async (sql) => (await db.query(sql)).rows[0];
  const rows = async (sql) => (await db.query(sql)).rows;
  const count = async (sql) => Number((await one(sql)).n);
  return { db, owner, one, rows, count, exec: (s) => db.exec(s) };
}

// ------------------------------------------------------------------------ the shared scenario: the same sales in the OLD world and the NEW world
// Everything here is valid in BOTH worlds (no location anywhere), and the financial facts it leaves behind are compared.
async function baseline(w) {
  const o = await w.owner();
  const p1 = (await w.one(`insert into products (profile_id, name, price, inventory_count) values ('${PROFILE}','Red Shirt',5000,100) returning id`)).id;
  const started = await (load("lib/inventory/handlers.ts")).startTracking(o, p1, { opening_quantity: 100, low_stock_threshold: 5, client_request_id: rq() });
  if (![200, 201].includes(started.status)) throw new Error("tracking: " + JSON.stringify(started.body).slice(0, 200));
  const cust = await REC.saveContact(o, null, { name: "John Doe", phone: "+237 677 00 11 22", email: null, notes: null, client_request_id: rq() });
  const sale1 = await SALES.recordSale(o, { locale: "en", lines: [{ product_id: p1, quantity: 2 }, { description: "Delivery", quantity: "1", unit_price: "1500" }], customer_id: cust.body.customer.id, method: "mobile_money", sold_on: undefined, client_request_id: rq() });
  const sale2 = await SALES.recordSale(o, { locale: "fr", lines: [{ product_id: p1, quantity: 1 }], method: "cash", client_request_id: rq() });
  const draft = await DOC.createDraft(o, { locale: "en", customer: { name: "Invoice Client", address: "Akwa, Douala" }, due_date: null, notes: null, tax_enabled: false, lines: [{ description: "Consulting", quantity: "1", unit_price: "20000" }], client_request_id: rq() });
  const issued = await DOC.issueDocument(o, draft.body.document.id);
  return { o, p1, cust, sale1, sale2, draft, issued };
}
async function facts(w, s) {
  const ids = [s.sale1.body.receipt.id, s.sale2.body.receipt.id];
  const receipts = [];
  for (const id of ids) receipts.push(await w.one(`select number, doc_type, status, currency, total::float8 total, subtotal::float8 subtotal, discount_total::float8 disc, tax_total::float8 tax, amount_paid::float8 paid,
      customer_snapshot, type_snapshot->>'method' method, type_snapshot->>'kind' kind, (type_snapshot->>'amount')::float8 pay_amount, template_version from bk_documents where id = '${id}'`));
  return {
    status: [s.sale1.status, s.sale2.status, s.issued.status],
    receipts,
    lines: await w.rows(`select d.number, l.position, l.description, l.quantity::float8 q, l.unit_price::float8 p, l.line_total::float8 t from bk_document_lines l join bk_documents d on d.id = l.document_id where d.doc_type = 'receipt' order by d.number, l.position`),
    entries: await w.rows(`select kind, amount::float8 a, cash_settled, entry_date::text d, category from bk_entries order by created_at, amount`),
    movements: await w.rows(`select kind, qty_delta, balance_before, balance_after, reason from bk_stock_movements order by created_at`),
    stock: (await w.one(`select inventory_count c from products where id = '${s.p1}'`)).c,
    counters: await w.rows(`select doc_type, last_number from bk_document_counters order by doc_type`),
    invoice: await w.one(`select number, status, total::float8 total, customer_snapshot from bk_documents where id = '${s.draft.body.document.id}'`),
    docs: await w.count(`select count(*) n from bk_documents`),
    entriesN: await w.count(`select count(*) n from bk_entries`),
    links: await w.count(`select count(*) n from bk_document_customer_links`),
    customers: await w.rows(`select name, phone, phone_normalized, email, notes from bk_customers order by name`),
  };
}

const oldW = await makeWorld(false);
const oldS = await baseline(oldW);
const oldF = await facts(oldW, oldS);

const W = await makeWorld(true);
const S = await baseline(W);
const newF = await facts(W, S);

// ------------------------------------------------------------------------ 1. the migration itself
const code = MIG_LOC.replace(/--.*$/gm, "").replace(/'[^']*'/g, "''");
check("migration: it only adds one nullable column and replaces/creates the two functions (no drop, no truncate, no delete, no other table touched)", !/drop\s+(table|column|function)|(^|;)\s*truncate\s|\bdelete\s+from\b/i.test(code) && (code.match(/alter\s+table\s+(\w+)/gi) || []).length === 1 && /alter\s+table\s+bk_customers\s+add\s+column\s+if\s+not\s+exists\s+address\s+text/i.test(code));
check("migration: the column is nullable text with no default and a 300 character limit", /add column if not exists address text check \(address is null or char_length\(address\) <= 300\)/.test(MIG_LOC));
check("migration: it never mentions commissions, payouts, ambassadors, orders, earnings or payments", !/commission|payout|ambassador|product_orders|commerce_sale_earnings|fapshi|customer_payments/i.test(code));
check("migration: it states its dependencies and refuses to run without them", /Apply 2026-12-06 \(Record Sale\) first/.test(MIG_LOC) && /Apply 2026-12-03 \(customer book\) first/.test(MIG_LOC));
check("migration: one transaction, idempotent, PROPOSED / NOT APPLIED, with its rollback and verify named", /^begin;$/m.test(MIG_LOC) && /^commit;$/m.test(MIG_LOC) && /Idempotent/.test(MIG_LOC) && /PROPOSED, NOT APPLIED/.test(MIG_LOC) && /rollback\.sql/.test(MIG_LOC) && /verify\.sql/.test(MIG_LOC));
{
  // sale_record: the old and the new bodies differ by exactly two lines
  const bodyOf = (sql, name) => { const a = sql.indexOf(`create or replace function ${name}(`); return sql.slice(a, sql.indexOf("end $$;", a)).split("\n"); };
  const oldLines = bodyOf(read("supabase/migrations/2026-12-06_record_sale_receipts_branding.sql"), "sale_record"), newLines = bodyOf(MIG_LOC, "sale_record");
  const removed = oldLines.filter((l) => !newLines.includes(l)), added = newLines.filter((l) => !oldLines.includes(l));
  check("sale_record: exactly two lines differ from the 2026-12-06 definition (the customer select and the snapshot keys), nothing else", oldLines.length === newLines.length && removed.length === 2 && added.length === 2
    && /select name, phone, email into v_cust/.test(removed.join("\n")) && /select name, phone, email, address into v_cust/.test(added.join("\n")) && /'address', v_cust\.address/.test(added.join("\n")), `${removed.length}/${added.length}`);
  const sigOld = /create or replace function sale_record\(\s*p_profile_id uuid, p_actor_user_id uuid, p_locale text, p_lines jsonb, p_customer_id uuid, p_method text, p_sold_on date, p_notes text, p_client_request_id uuid\)/;
  check("sale_record: the SAME signature (so every caller and every grant keeps working)", sigOld.test(MIG_LOC) && sigOld.test(read("supabase/migrations/2026-12-06_record_sale_receipts_branding.sql")));
  const svOld = bodyOf(read("supabase/migrations/2026-12-03_debtors_reminders.sql"), "bk_customer_save"), svNew = bodyOf(MIG_LOC, "bk_customer_save");
  const svAdded = svNew.filter((l) => !svOld.includes(l)).join("\n"), svRemoved = svOld.filter((l) => !svNew.includes(l)).join("\n");
  check("bk_customer_save: a NEW overload; every changed line is about the address (the original function is not redefined)", svAdded.split("\n").every((l) => /address/i.test(l) || /^\s*values \(/.test(l) || /updated_by = p_actor_user_id/.test(l) || /p_client_request_id uuid, p_address text\)/.test(l)) && /p_address text\)/.test(svAdded) && !/create or replace function bk_customer_save\(\s*p_profile_id uuid, p_actor_user_id uuid, p_customer_id uuid, p_name text, p_phone text, p_email text, p_notes text, p_client_request_id uuid\)/.test(MIG_LOC), svRemoved.slice(0, 200));
}
check("after the migration the column exists, is nullable, has no default and every row created before it has a null address", (await W.one(`select data_type, is_nullable, column_default from information_schema.columns where table_name = 'bk_customers' and column_name = 'address'`)).data_type === "text"
  && (await W.one(`select is_nullable n from information_schema.columns where table_name = 'bk_customers' and column_name = 'address'`)).n === "YES"
  && (await W.one(`select column_default d from information_schema.columns where table_name = 'bk_customers' and column_name = 'address'`)).d === null
  && (await W.count(`select count(*) n from bk_customers where address is not null`)) === 0);
check("the old world has no address column (the migration is what adds it)", (await oldW.count(`select count(*) n from information_schema.columns where table_name = 'bk_customers' and column_name = 'address'`)) === 0);
check("the 8-argument bk_customer_save still exists next to the new 9-argument one, and the new functions are service_role only", (await W.count(`select count(*) n from pg_proc where proname = 'bk_customer_save'`)) === 2
  && (await W.count(`select count(*) n from pg_proc p where p.oid in (to_regprocedure('bk_customer_save(uuid,uuid,uuid,text,text,text,text,uuid,text)'), to_regprocedure('sale_record(uuid,uuid,text,jsonb,uuid,text,date,text,uuid)')) and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))`)) === 0
  && (await W.count(`select count(*) n from pg_proc p where p.oid in (to_regprocedure('bk_customer_save(uuid,uuid,uuid,text,text,text,text,uuid,text)'), to_regprocedure('sale_record(uuid,uuid,text,jsonb,uuid,text,date,text,uuid)')) and has_function_privilege('service_role', p.oid, 'execute')`)) === 2);
await W.exec(MIG_LOC); // twice
check("running the migration twice is harmless (idempotent): still one column, still two bk_customer_save overloads", (await W.count(`select count(*) n from information_schema.columns where table_name = 'bk_customers' and column_name = 'address'`)) === 1 && (await W.count(`select count(*) n from pg_proc where proname = 'bk_customer_save'`)) === 2);
{
  const v = await W.rows(VERIFY_LOC.replace(/;\s*$/, ""));
  check("the verify script runs and every row says ok", v.length >= 6 && v.every((r) => r.ok === true), JSON.stringify(v.filter((r) => r.ok !== true)).slice(0, 300));
}

// ------------------------------------------------------------------------ 2. FINANCIAL SAFETY: the same sales, before and after the migration, leave identical financial facts
const strip = (f) => ({ ...f, invoice: { ...f.invoice } });
eq("financial: statuses of the sales and the invoice are identical in the old and the new world", newF.status, oldF.status);
eq("financial: receipts (number, totals, payment method and amount, currency, template version, customer snapshot) are identical", newF.receipts, oldF.receipts);
eq("financial: receipt lines (descriptions, quantities, unit prices, totals) are identical", newF.lines, oldF.lines);
eq("financial: bookkeeping entries (kind, amount, settled, date) are identical", newF.entries, oldF.entries);
eq("financial: inventory movements and the final stock are identical (3 sold: 100 -> 97)", [newF.movements, newF.stock], [oldF.movements, oldF.stock]);
eq("financial: receipt and invoice numbering counters are identical", newF.counters, oldF.counters);
eq("financial: the invoice (number, status, total, customer snapshot with ITS address) is identical", newF.invoice, oldF.invoice);
eq("financial: the same number of documents, entries and customer links were created", [newF.docs, newF.entriesN, newF.links], [oldF.docs, oldF.entriesN, oldF.links]);
eq("financial: the customer written without a location is identical in both worlds", newF.customers, oldF.customers);
eq("financial: concrete numbers (sale 1 = 2 x 5 000 + 1 500 = 11 500 paid by mobile money; stock 97; receipt counter 2)", [newF.receipts[0].total, newF.receipts[0].method, newF.stock, newF.counters.find((c) => c.doc_type === "receipt").last_number], [11500, "mobile_money", 97, 2]);
eq("baseline customer (name + phone, no location): the receipt snapshot is exactly name + phone, no address key", S.sale1 && newF.receipts[0].customer_snapshot, { name: "John Doe", phone: "+237 677 00 11 22" });

// ------------------------------------------------------------------------ 3. the new behaviour, in the NEW world
const o = S.o;
const cnt = async () => ({ docs: await W.count(`select count(*) n from bk_documents`), entries: await W.count(`select count(*) n from bk_entries`), customers: await W.count(`select count(*) n from bk_customers`), stock: (await W.one(`select inventory_count c from products where id = '${S.p1}'`)).c, rct: Number((await W.one(`select last_number n from bk_document_counters where doc_type = 'receipt'`)).n) });
const receiptRow = (id) => W.one(`select * from bk_documents where id = '${id}'`);
const modelOf = async (id) => (await DOC.getDocument(o, id)).body.model;
const pageOf = async (id) => { const row = await receiptRow(id); const lines = await W.rows(`select * from bk_document_lines where document_id = '${id}' order by position`); return renderToStaticMarkup(React.createElement(PublicDocumentView, { model: SNAP.modelFromRows({ doc: row, lines }), pdfHref: "/d/tok/pdf", logoHref: null })); };

// 3a. new customer: name + phone + location
const before = await cnt();
const cL = await REC.saveContact(o, null, { name: "Aïcha Mbarga", phone: "+237 699 11 22 33", address: "Bastos, Yaoundé", email: null, notes: null, client_request_id: rq() });
check("new customer with name + phone + location: created (201) and the location is PERSISTED on the customer", cL.status === 201 && cL.body.created === true && cL.body.customer.address === "Bastos, Yaoundé" && (await W.one(`select address a from bk_customers where id = '${cL.body.customer.id}'`)).a === "Bastos, Yaoundé", JSON.stringify(cL.body).slice(0, 200));
const sL = await SALES.recordSale(o, { locale: "en", lines: [{ product_id: S.p1, quantity: 1 }, { description: "Gift wrap", quantity: "1", unit_price: "500" }], customer_id: cL.body.customer.id, method: "mobile_money", client_request_id: rq() });
check("…the sale records correctly (201)", sL.status === 201 && sL.body.duplicate === false && /^RCT-/.test(sL.body.receipt.number), JSON.stringify(sL.body).slice(0, 200));
const rcL = await receiptRow(sL.body.receipt.id);
eq("…the receipt's frozen customer snapshot carries name, phone AND location", rcL.customer_snapshot, { name: "Aïcha Mbarga", phone: "+237 699 11 22 33", address: "Bastos, Yaoundé" });
const mL = await modelOf(sL.body.receipt.id);
eq("…the receipt model (the dashboard receipt reads this) has the location", [mL.customer.name, mL.customer.phone, mL.customer.address], ["Aïcha Mbarga", "+237 699 11 22 33", "Bastos, Yaoundé"]);
const pdfL = await DOC.renderPdf(o, sL.body.receipt.id);
check("…the receipt PDF contains the name, the phone and the location", pdfL.status === 200 && pdfHas(Buffer.from(pdfL.pdf), "Bastos, Yaoundé") && pdfHas(Buffer.from(pdfL.pdf), "+237 699 11 22 33") && pdfHas(Buffer.from(pdfL.pdf), "Aïcha Mbarga"));
const htmlL = await pageOf(sL.body.receipt.id);
check("…the shared (public) receipt page contains the location", htmlL.includes("Bastos, Yaound") && htmlL.includes("+237 699 11 22 33"));
const afterL = await cnt();
eq("…and financially it is an ordinary sale: +1 document, +1 entry, receipt counter +1, stock -1, total 5 500 by mobile money", [afterL.docs - before.docs, afterL.entries - before.entries, afterL.rct - before.rct, afterL.stock - before.stock, Number(rcL.total), rcL.type_snapshot.method, Number(rcL.type_snapshot.amount)], [1, 1, 1, -1, 5500, "mobile_money", 5500]);

// 3b. new customer: name + phone, no location
const cN = await REC.saveContact(o, null, { name: "Paul Ewane", phone: "677 33 44 55", email: null, notes: null, client_request_id: rq() });
const b2 = await cnt();
const sN = await SALES.recordSale(o, { locale: "en", lines: [{ product_id: S.p1, quantity: 1 }], customer_id: cN.body.customer.id, method: "cash", client_request_id: rq() });
const rcN = await receiptRow(sN.body.receipt.id);
check("new customer without a location: created, the sale works, address is NULL", cN.status === 201 && cN.body.customer.address === null && sN.status === 201 && (await W.one(`select address a from bk_customers where id = '${cN.body.customer.id}'`)).a === null);
check("…the snapshot has NO address key (nothing empty is frozen)", !("address" in rcN.customer_snapshot) && JSON.stringify(rcN.customer_snapshot) === JSON.stringify({ name: "Paul Ewane", phone: "677 33 44 55" }), JSON.stringify(rcN.customer_snapshot));
const mN = await modelOf(sN.body.receipt.id); const pdfN = Buffer.from((await DOC.renderPdf(o, sN.body.receipt.id)).pdf); const htmlN = await pageOf(sN.body.receipt.id);
check("…the receipt model has a null location, and neither the PDF nor the public page shows an empty location, 'N/A', 'null' or 'undefined'", mN.customer.address === null && !pdfHas(pdfN, "N/A") && !pdfHas(pdfN, "null") && !pdfHas(pdfN, "undefined") && !htmlN.includes("N/A") && !htmlN.includes("null") && !htmlN.includes("undefined") && htmlN.includes("Paul Ewane"));
eq("…and it is financially an ordinary sale (receipt counter +1, stock -1)", [(await cnt()).rct - b2.rct, (await cnt()).stock - b2.stock], [1, -1]);

// 3c. phone only (no name): the existing rule still holds, and a walk-in sale is unaffected
const cP = await REC.saveContact(o, null, { name: "", phone: "677 99 88 77", email: null, notes: null, client_request_id: rq() });
check("phone only (no name): refused exactly as before (invalid_customer_name), nothing created", cP.status === 400 && /invalid_customer_name/.test(JSON.stringify(cP.body)));
const sW = await SALES.recordSale(o, { locale: "en", lines: [{ product_id: S.p1, quantity: 1 }], method: "cash", client_request_id: rq() });
const rcW = await receiptRow(sW.body.receipt.id);
check("walk-in sale (no customer at all): works, empty customer snapshot", sW.status === 201 && Object.keys(rcW.customer_snapshot).length === 0);

// 3d. existing customer (created BEFORE locations existed: no address) -> a new sale
const sE = await SALES.recordSale(o, { locale: "en", lines: [{ product_id: S.p1, quantity: 1 }], customer_id: S.cust.body.customer.id, method: "cash", client_request_id: rq() });
const rcE = await receiptRow(sE.body.receipt.id);
check("existing customer without a location: the sale works and the receipt shows name + phone only (no address key)", sE.status === 201 && JSON.stringify(rcE.customer_snapshot) === JSON.stringify({ name: "John Doe", phone: "+237 677 00 11 22" }));

// 3e. existing customer WITH a stored location -> a second sale shows it
const sE2 = await SALES.recordSale(o, { locale: "fr", lines: [{ product_id: S.p1, quantity: 1 }], customer_id: cL.body.customer.id, method: "cash", client_request_id: rq() });
const rcE2 = await receiptRow(sE2.body.receipt.id);
check("existing customer with a stored location: a LATER sale's receipt shows the stored location too", sE2.status === 201 && rcE2.customer_snapshot.address === "Bastos, Yaoundé" && (await modelOf(sE2.body.receipt.id)).customer.address === "Bastos, Yaoundé");

// 3f. duplicate phone: unchanged behaviour, nothing merged, the stored data is not overwritten
const customersBefore = await W.count(`select count(*) n from bk_customers`);
const dup = await REC.saveContact(o, null, { name: "Someone Else", phone: "+237 699 11 22 33", address: "Douala, Akwa", email: null, notes: null, client_request_id: rq() });
check("duplicate phone (with a location typed): still REPORTED as 409 duplicate_customer with the existing customer, never merged", dup.status === 409 && dup.body.error === "duplicate_customer" && dup.body.existing.id === cL.body.customer.id, JSON.stringify(dup.body).slice(0, 200));
check("…no second customer was created and the existing customer's name and location are NOT overwritten", (await W.count(`select count(*) n from bk_customers`)) === customersBefore && JSON.stringify(await W.one(`select name, address from bk_customers where id = '${cL.body.customer.id}'`)) === JSON.stringify({ name: "Aïcha Mbarga", address: "Bastos, Yaoundé" }));
const dupOld = await REC.saveContact(o, null, { name: "Third", phone: "+237 677 00 11 22", email: null, notes: null, client_request_id: rq() });
check("duplicate phone WITHOUT a location (the original function): unchanged 409", dupOld.status === 409 && dupOld.body.existing.id === S.cust.body.customer.id);

// 3g. updating a customer never erases a stored location; sending one changes it
const upd1 = await REC.saveContact(o, cL.body.customer.id, { name: "Aïcha M. Mbarga", phone: "+237 699 11 22 33", email: null, notes: null });
check("renaming a customer through the original path keeps their stored location", upd1.status === 200 && (await W.one(`select name, address from bk_customers where id = '${cL.body.customer.id}'`)).address === "Bastos, Yaoundé");
const upd2 = await REC.saveContact(o, cL.body.customer.id, { name: "Aïcha M. Mbarga", phone: "+237 699 11 22 33", address: "Odza, Yaoundé", email: null, notes: null });
check("sending a new location through the new path updates it", upd2.status === 200 && (await W.one(`select address a from bk_customers where id = '${cL.body.customer.id}'`)).a === "Odza, Yaoundé");
const oldReceiptStill = await receiptRow(sL.body.receipt.id);
check("an ISSUED receipt keeps the location it was issued with (the snapshot is frozen; editing the customer never rewrites history)", oldReceiptStill.customer_snapshot.address === "Bastos, Yaoundé");

// 3h. validation: too long, blank, whitespace
const longAddr = "x".repeat(301);
const nBefore = await W.count(`select count(*) n from bk_customers`);
const tooLong = await REC.saveContact(o, null, { name: "Long Place", phone: null, address: longAddr, email: null, notes: null, client_request_id: rq() });
check("a location longer than 300 characters is refused with a clean 400 (invalid_address) and nothing is created", tooLong.status === 400 && /invalid_address/.test(JSON.stringify(tooLong.body)) && (await W.count(`select count(*) n from bk_customers`)) === nBefore, JSON.stringify(tooLong.body).slice(0, 200));
const dbLong = await W.db.query(`select bk_customer_save('${PROFILE}','${USER}',null,'Direct Long',null,null,null,'${rq()}','${longAddr}')`).then(() => "ok", (e) => String(e.message));
check("…and the database refuses it too (the function raises invalid_address)", /invalid_address/.test(dbLong), dbLong);
const blank = await REC.saveContact(o, null, { name: "Blank Place", phone: null, address: "   ", email: null, notes: null, client_request_id: rq() });
check("a blank / whitespace location is treated as no location (stored as NULL, not as spaces)", blank.status === 201 && (await W.one(`select address a from bk_customers where id = '${blank.body.customer.id}'`)).a === null);
const maxOk = await REC.saveContact(o, null, { name: "Max Place", phone: null, address: "y".repeat(300), email: null, notes: null, client_request_id: rq() });
check("exactly 300 characters is accepted", maxOk.status === 201);
const trimmed = await REC.saveContact(o, null, { name: "Trim Place", phone: null, address: "  Bonanjo, Douala  ", email: null, notes: null, client_request_id: rq() });
check("surrounding spaces are trimmed", (await W.one(`select address a from bk_customers where id = '${trimmed.body.customer.id}'`)).a === "Bonanjo, Douala");

// 3i. idempotency of the customer save with a location (a double click replays, never duplicates)
const rid = rq();
const i1 = await REC.saveContact(o, null, { name: "Idem Person", phone: null, address: "Limbe", email: null, notes: null, client_request_id: rid });
const i2 = await REC.saveContact(o, null, { name: "Idem Person", phone: null, address: "Limbe", email: null, notes: null, client_request_id: rid });
check("saving the same customer twice with the same request id returns the same customer once", i1.status === 201 && i2.status === 200 && i2.body.duplicate === true && i1.body.customer.id === i2.body.customer.id && (await W.count(`select count(*) n from bk_customers where name = 'Idem Person'`)) === 1);

// 3j. nothing outside the customer book / the receipt snapshot changed shape: the invoice path is untouched
const invAfter = await W.one(`select number, total::float8 total, customer_snapshot from bk_documents where id = '${S.draft.body.document.id}'`);
eq("the invoice issued earlier is unchanged (same number, total and ITS customer address)", invAfter, { number: oldF.invoice.number, total: oldF.invoice.total, customer_snapshot: oldF.invoice.customer_snapshot });

// ------------------------------------------------------------------------ 4. isolation: another business cannot read or use this business's customer location
await W.exec(`
  insert into public.users (id, email, plan_id) values ('${ID("c", 2)}','c@x.test','${PLAN}');
  insert into public.profiles (id, user_id, username, name, currency, avatar_url, theme_color, is_demo, category) values ('${ID("a", 2)}','${ID("c", 2)}','carol','Carol Shop','XAF',null,'#4F46E5',false,'business_ecommerce');
`);
const carolSale = await W.db.query(`select sale_record('${ID("a", 2)}','${ID("c", 2)}','en','[{"description":"Item","quantity":"1","unit_price":"1000"}]'::jsonb,'${cL.body.customer.id}','cash',null,null,'${rq()}')`).then(() => "ok", (e) => String(e.message));
check("another business cannot attach this business's customer (and so cannot reach their location): customer_not_found", /customer_not_found/.test(carolSale), carolSale);
check("the table's read policy and grants are unchanged: the browser roles can still only SELECT their own business's rows", (await W.count(`select count(*) n from pg_policies where tablename = 'bk_customers' and cmd <> 'SELECT'`)) === 0 && (await W.count(`select count(*) n from information_schema.table_privileges where table_name = 'bk_customers' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')`)) === 0);

// ------------------------------------------------------------------------ 5. rollback: refuses while a location exists, then restores the 2026-12-06 function exactly
const rbRefuse = await W.db.exec(ROLLBACK_LOC).then(() => "ran", (e) => String(e.message));
check("rollback refuses while customers have a stored location (it never drops data silently)", /customers with a stored location exist/.test(rbRefuse), rbRefuse);
await W.exec("rollback;"); // the refusal aborts the script's own transaction (the SQL editor does this itself)
await W.exec(`update bk_customers set address = null`);
await W.db.exec(ROLLBACK_LOC);
check("rollback: the address column is gone, the 9-argument overload is gone and the original 8-argument function is back to being the only one", (await W.count(`select count(*) n from information_schema.columns where table_name = 'bk_customers' and column_name = 'address'`)) === 0 && (await W.count(`select count(*) n from pg_proc where proname = 'bk_customer_save'`)) === 1);
{
  const src = (await W.one(`select prosrc s from pg_proc where proname = 'sale_record'`)).s;
  check("rollback: sale_record is the 2026-12-06 definition again (no address)", !/v_cust\.address/.test(src) && /select name, phone, email into v_cust/.test(src));
  const w2 = await REC.saveContact(o, null, { name: "After Rollback", phone: null, email: null, notes: null, client_request_id: rq() });
  const s2 = await SALES.recordSale(o, { locale: "en", lines: [{ description: "Thing", quantity: "1", unit_price: "100" }], customer_id: w2.body.customer.id, method: "cash", client_request_id: rq() });
  check("rollback: customers and sales still work afterwards, and receipts issued with a location keep it", w2.status === 201 && s2.status === 201 && (await receiptRow(sL.body.receipt.id)).customer_snapshot.address === "Bastos, Yaoundé");
  await W.exec(MIG_LOC);
  check("the migration applies again after a rollback", (await W.count(`select count(*) n from information_schema.columns where table_name = 'bk_customers' and column_name = 'address'`)) === 1);
}

// ------------------------------------------------------------------------ 6. the application layer (source guards)
const validation = read("src/lib/receivables/validation.ts"), handlers = read("src/lib/receivables/handlers.ts"), screen = read("src/components/sales/RecordSaleView.tsx");
check("app: the contact body accepts an optional `address` (300 characters), and an invalid one becomes invalid_address", /address: string \| null/.test(validation) && /CONTACT_LIMITS\.address, "invalid_address"/.test(validation) && /address: 300/.test(read("src/lib/receivables/constants.ts")));
check("app: the location is passed to the database ONLY when there is one (otherwise the original function is called, exactly as before)", /\.\.\.\(p\.value\.address !== null \? \{ p_address: p\.value\.address \} : \{\}\)/.test(handlers));
check("app: invalid_address maps to 400 and to a translated message in both languages", /invalid_address: 400/.test(read("src/lib/receivables/http.ts")) && /invalid_address: "invalidAddress"/.test(read("src/lib/receivables/uiErrors.ts")));
check("app: the Record Sale form sends `address` to the customer book only when typed, and never to the sale itself", /\.\.\.\(newLocation\.trim\(\) \? \{ address: newLocation\.trim\(\) \} : \{\}\)/.test(screen) && !/callApi\("POST", "\/api\/sales", \{[^}]*address/.test(screen));
const { translations } = load("lib/i18n/translations.ts");
check("i18n: the Location label and the too-long message exist in English and French", translations.en.sales.customerLocation === "Location" && translations.fr.sales.customerLocation === "Lieu" && translations.en.sales.errors.invalid_address && translations.fr.sales.errors.invalid_address && translations.en.receivables.errors.invalidAddress && translations.fr.receivables.errors.invalidAddress);

for (const f of tmp) try { fs.unlinkSync(f); } catch {}
console.log(`customerLocationSql: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
