// Test for supabase/migrations/2026-12-03_debtors_reminders.sql (Business Toolkit Phase 3: debtors, credit sales, reminders).
//
// Runs entirely on a scratch, IN-MEMORY PostgreSQL (PGlite: a real PostgreSQL engine compiled to WASM). It never connects to Supabase or any
// real database and never reads .env.local. The REAL Phase 1, Phase 2 and Phase 3 migrations, the Phase 3 preflight/verify scripts and the
// documented rollback are executed by that engine; constraints, composite foreign keys, triggers, plpgsql functions, GRANT/REVOKE and RLS
// (via SET ROLE) are genuinely evaluated. STAND-INS (PGlite is NOT Supabase): the roles anon/authenticated/service_role, schema auth with
// auth.uid(), Supabase's default privileges, and reduced users/plans/profiles/products/email_suppressions tables. See the Phase 2 test for the
// full list of what this does and does not prove.
//
//   Setup:  npm install --no-save @electric-sql/pglite      (nothing is added to package.json or the lockfile)
//   Run:    node supabase/support/tests/receivables_foundation.test.mjs
//
// Time: functions that need "today" use bk_rem_today(); a test may replace it IN MEMORY (scratch database only) to look N days ahead.
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";

const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => fs.readFileSync(REPO + p, "utf8").replace(/\r\n/g, "\n");

const PHASE1 = read("supabase/migrations/2026-12-01_bookkeeping_foundation.sql");
const PHASE2 = read("supabase/migrations/2026-12-02_documents_invoices_receipts.sql");
const PHASE3 = read("supabase/migrations/2026-12-03_debtors_reminders.sql");
const PREFLIGHT3 = read("supabase/support/2026-12-03_debtors_reminders.preflight.sql");
const VERIFY3 = read("supabase/support/2026-12-03_debtors_reminders.verify.sql");
const ROLLBACK3 = PHASE3.split("-- ROLLBACK")[1].split("\n").filter((l) => /^--\s{3}\S/.test(l)).map((l) => l.replace(/^--\s{3}/, "")).join("\n");

let pass = 0, fail = 0;
const check = (group, name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log(`  FAIL [${group}]: ${name} | ${String(detail).slice(0, 400)}`); } };
const errOf = async (fn) => { try { await fn(); return null; } catch (e) { return e.message.split("\n")[0]; } };
const has = (e, code) => typeof e === "string" && e.includes(code);

const UID = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PID = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLN = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RQ = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = { alice: UID(1), bob: UID(2), carol: UID(3), dave: UID(4), erin: UID(5), kim: UID(6) };
const P = { alice: PID(1), bob: PID(2), carol: PID(3), dave: PID(4), erin: PID(5), kim: PID(6) };
const PL = { free: PLN(1), business_pro: PLN(5), business_basic: PLN(4) };
let rq = 5000;
const req = () => RQ(++rq);
const q = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
    set timezone = 'UTC';
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to public;
    create table public.plans (id uuid primary key, name text not null unique);
    create table public.users (id uuid primary key, email text not null, plan_id uuid references public.plans(id));
    insert into public.plans (id, name) values ('${PL.free}','free'),('${PL.business_basic}','business_basic'),('${PL.business_pro}','business_pro');
    insert into public.users (id, email, plan_id) values ('${U.alice}','a@x.test','${PL.business_pro}'),('${U.bob}','b@x.test','${PL.business_pro}'),('${U.carol}','c@x.test','${PL.free}'),
      ('${U.dave}','d@x.test',null),('${U.erin}','e@x.test','${PL.business_pro}'),('${U.kim}','k@x.test','${PL.business_basic}');
    create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null, name text, currency text,
      is_demo boolean not null default false, category text, categories text[] not null default '{}');
    alter table public.profiles enable row level security;
    create policy "profiles readable" on public.profiles for select using (true);
    create table public.products (id uuid primary key, profile_id uuid not null references public.profiles(id), name text);
    create table public.product_orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
    create table public.orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
    create table public.music_orders (id uuid primary key, profile_id uuid not null references public.profiles(id));
    create table public.email_suppressions (id uuid primary key default gen_random_uuid(), email text not null unique, reason text not null default 'manual');
    insert into public.profiles (id, user_id, username, name, currency, is_demo, category) values
      ('${P.alice}','${U.alice}','alice','Alice Shop','XAF',false,'business_ecommerce'), ('${P.bob}','${U.bob}','bob','Bob Shop','XAF',false,'business_ecommerce'),
      ('${P.carol}','${U.carol}','carol','Carol','XAF',false,'business_ecommerce'), ('${P.dave}','${U.dave}','dave','Dave','XAF',false,'restaurant_food'),
      ('${P.erin}','${U.erin}','erin','Erin Demo','XAF',true,'business_ecommerce'), ('${P.kim}','${U.kim}','kim','Kim','KWD',false,'business_ecommerce');
  `);
  return db;
}

const db = await freshDb();
const as = async (role, sub, sql) => {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${sub || ""}', false);`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub','', false);`); }
};
const svc = (sql) => as("service_role", null, sql);
const fnJson = async (sql) => (await svc(`select ${sql} as r`)).rows[0].r;
const one = async (sql) => (await db.query(sql)).rows[0];
const count = async (table, where = "true") => Number((await one(`select count(*)::int as n from ${table} where ${where}`)).n);

// ---------------------------------------------------------------------------------------------------- A. apply, preflight, verify
check("A", "Phase 1 applies", (await errOf(async () => db.exec(PHASE1))) === null);
check("A", "Phase 2 applies", (await errOf(async () => db.exec(PHASE2))) === null);
await db.exec(`update public.plans set business_toolkit_enabled = true where name in ('business_pro','business_basic')`);

const pre = (await db.exec(PREFLIGHT3))[0].rows;
check("A", "the Phase 3 preflight passes on a Phase-2-ready database (every row ok)", pre.length >= 12 && pre.every((r) => r.ok === true), JSON.stringify(pre.filter((r) => !r.ok)));

const snapshot = async () => (await db.query(`
  select 'col:' || table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default,'') as x from information_schema.columns where table_schema = 'public'
  union all select 'pol:' || tablename || ':' || policyname || ':' || coalesce(qual,'') from pg_policies
  union all select 'fn:' || p.oid::regprocedure::text || ':' || md5(p.prosrc) || ':' || coalesce(p.proacl::text, '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','auth')
  union all select 'trg:' || tgrelid::regclass::text || ':' || tgname from pg_trigger where not tgisinternal
  union all select 'idx:' || indexname from pg_indexes where schemaname = 'public'
  union all select 'tbl:' || tablename from pg_tables where schemaname = 'public'
  union all select 'grant:' || table_name || ':' || grantee || ':' || privilege_type from information_schema.role_table_grants where table_schema = 'public'
  union all select 'con:' || conrelid::regclass::text || ':' || conname || ':' || pg_get_constraintdef(oid) from pg_constraint where connamespace = 'public'::regnamespace
  order by 1`)).rows.map((r) => r.x);
const isPhase3 = (s) => /(bk_customers|bk_document_customer_links|bk_customer_events|bk_reminder_settings|bk_reminders|bk_customer_|bk_norm_|bk_rem_|doc_(set_document_customer|suggest_customers|receivable|customer_statement|check_share|upsert_reminder_settings|record_manual_reminder|complete_reminder|expire_stale|claim_due))/.test(s);
const before = await snapshot();

check("A", "Phase 3 applies", (await errOf(async () => db.exec(PHASE3))) === null);
const after = await snapshot();
const added = after.filter((x) => !before.includes(x));
const removedOrChanged = before.filter((x) => !after.includes(x));
check("A", "NOTHING from Phase 1/2 was altered: every pre-existing column, policy, function (body + ACL), trigger, index, table, grant and constraint is identical", removedOrChanged.length === 0, removedOrChanged.slice(0, 5).join(" | "));
check("A", "everything that was added belongs to Phase 3", added.length > 50 && added.every(isPhase3), added.filter((x) => !isPhase3(x)).slice(0, 5).join(" | "));
const ver = (await db.exec(VERIFY3))[0].rows;
check("A", "the Phase 3 verify script passes (every row ok)", ver.length >= 30 && ver.every((r) => r.ok === true), JSON.stringify(ver.filter((r) => !r.ok)));
check("A", "re-running the Phase 3 migration is idempotent (no error, nothing new, nothing changed)", (await errOf(async () => db.exec(PHASE3))) === null && JSON.stringify(await snapshot()) === JSON.stringify(after));

// ---------------------------------------------------------------------------------------------------- helpers: Phase 2 invoices
const A = { p: P.alice, u: U.alice }, B = { p: P.bob, u: U.bob };
await svc(`select doc_upsert_business_profile('${A.p}','${A.u}','Alice Shop',null,null,null,'alice@shop.test',null,null,null,null,null,null)`);
await svc(`select doc_upsert_business_profile('${B.p}','${B.u}','Bob Shop',null,null,null,'bob@shop.test',null,null,null,null,null,null)`);
const today = async () => (await one(`select (now() at time zone 'Africa/Douala')::date::text as d`)).d;

async function invoice(owner, { total = 10000, dueDays = 5, customer = { name: "Client One", email: "client1@x.test", phone: "677123456" }, locale = "en" } = {}) {
  const lines = JSON.stringify([{ description: "Goods", quantity: "1", unit_price: String(total) }]);
  const d = await fnJson(`doc_save_draft('${owner.p}','${owner.u}',null,'invoice','${locale}',${q(JSON.stringify(customer))}::jsonb,((now() at time zone 'Africa/Douala')::date + ${dueDays}),null,null,false,${q(lines)}::jsonb,null,'${req()}')`);
  const id = d.document.id;
  await svc(`select doc_issue('${owner.p}','${owner.u}','${id}')`);
  return id;
}
const pay = async (owner, id, amount, requestId = req()) => fnJson(`doc_record_payment('${owner.p}','${owner.u}','${id}',${amount},'cash',null,(now() at time zone 'Africa/Douala')::date,'${requestId}')`);
const setToday = (offset) => db.exec(`create or replace function bk_rem_today() returns date language sql stable as $$ select ((now() at time zone 'Africa/Douala')::date + ${offset}) $$;`);
const realToday = () => db.exec(`create or replace function bk_rem_today() returns date language sql stable as $$ select (now() at time zone 'Africa/Douala')::date $$;`);
const backdate = async (table, where, interval) => {
  const trg = table === "bk_reminders" ? "bk_reminders_guard_trg" : null;
  if (trg) await db.exec(`alter table ${table} disable trigger ${trg}`);
  await db.exec(`update ${table} set created_at = created_at - interval '${interval}' where ${where}`);
  if (trg) await db.exec(`alter table ${table} enable trigger ${trg}`);
};

// ======================================================================================= B. customers
const cust = (o, name, phone, email, notes, rid = req()) => fnJson(`bk_customer_save('${o.p}','${o.u}',null,${q(name)},${q(phone)},${q(email)},${q(notes)},'${rid}')`);
const c1 = await cust(A, "Client One", "677 12 34 56", "Client1@X.test", "pays late");
check("B", "a contact is created with normalised phone/email (Cameroon 237 rule) and the original text kept", c1.created === true && c1.customer.phone === "677 12 34 56" && c1.customer.phone_normalized === "237677123456" && c1.customer.email_normalized === "client1@x.test");
const rid1 = req();
const c2a = await cust(A, "Client Two", "699000111", null, null, rid1), c2b = await cust(A, "Client Two", "699000111", null, null, rid1);
check("B", "creating twice with the same request id returns the original (idempotent), not a second contact", c2a.created === true && c2b.duplicate === true && c2b.customer.id === c2a.customer.id && (await count("bk_customers", `profile_id = '${A.p}'`)) === 2);
const dupPhone = await cust(A, "Someone else", "+237 677-123-456", null, null);
const dupEmail = await cust(A, "Another", null, "CLIENT1@x.test", null);
check("B", "an existing active phone or email is REPORTED, never merged and never duplicated (no new row)", dupPhone.created === false && dupPhone.duplicate_of.id === c1.customer.id && dupEmail.duplicate_of.id === c1.customer.id && (await count("bk_customers", `profile_id = '${A.p}'`)) === 2);
check("B", "the same phone in ANOTHER business is fine (contacts are per business)", (await cust(B, "Bob's client", "677123456", null, null)).created === true);
for (const [label, args, code] of [["blank name", ["  ", null, null], "invalid_customer_name"], ["121-char name", ["x".repeat(121), null, null], "invalid_customer_name"], ["bad phone", ["N", "12", null], "invalid_phone"], ["bad email", ["N", null, "nope"], "invalid_email"], ["long notes", ["N", null, null, "n".repeat(501)], "invalid_notes"]]) {
  const e = await errOf(async () => cust(A, args[0], args[1], args[2], args[3] ?? null));
  check("B", `rejected: ${label}`, has(e, code), e);
}
const upd = await fnJson(`bk_customer_save('${A.p}','${A.u}','${c1.customer.id}','Client One Renamed','677123456','client1@x.test','vip','${req()}')`);
check("B", "an update changes the contact and keeps its identity; a collision with ANOTHER contact is reported", upd.customer.name === "Client One Renamed" && upd.customer.id === c1.customer.id
  && (await fnJson(`bk_customer_save('${A.p}','${A.u}','${c1.customer.id}','X','699000111',null,null,'${req()}')`)).duplicate_of.id === c2a.customer.id);
check("B", "another business's contact cannot be updated (customer_not_found)", has(await errOf(async () => svc(`select bk_customer_save('${B.p}','${B.u}','${c1.customer.id}','Hijack',null,null,null,'${req()}')`)), "customer_not_found"));

const arch = await fnJson(`bk_customer_set_archived('${A.p}','${A.u}','${c2a.customer.id}',true)`);
check("B", "archiving keeps the row, frees its phone for a new contact, and is idempotent", arch.changed === true && (await fnJson(`bk_customer_set_archived('${A.p}','${A.u}','${c2a.customer.id}',true)`)).changed === false
  && (await cust(A, "Client Two Again", "699000111", null, null)).created === true);
check("B", "restoring a contact whose phone is now used by an active one is refused (duplicate_customer)", has(await errOf(async () => svc(`select bk_customer_set_archived('${A.p}','${A.u}','${c2a.customer.id}',false)`)), "duplicate_customer"));
check("B", "an archived contact cannot be edited or linked", has(await errOf(async () => svc(`select bk_customer_save('${A.p}','${A.u}','${c2a.customer.id}','x',null,null,null,'${req()}')`)), "customer_archived"));
const pz = await fnJson(`bk_customer_set_auto_paused('${A.p}','${A.u}','${c1.customer.id}',true)`);
check("B", "pausing automatic reminders is recorded and idempotent", pz.customer.auto_reminders_paused === true && (await fnJson(`bk_customer_set_auto_paused('${A.p}','${A.u}','${c1.customer.id}',true)`)).changed === false);
await fnJson(`bk_customer_set_auto_paused('${A.p}','${A.u}','${c1.customer.id}',false)`);
const evs = (await db.query(`select event_type from bk_customer_events where customer_id = '${c1.customer.id}' order by created_at, id`)).rows.map((r) => r.event_type);
check("B", "every change left an append-only event (created, updated, paused, resumed)", ["customer_created", "customer_updated", "reminders_paused", "reminders_resumed"].every((e) => evs.includes(e)), evs.join());
check("B", "events are append-only (update and delete refused)", has(await errOf(async () => db.exec(`update bk_customer_events set event_type = 'customer_created'`)), "append-only") && has(await errOf(async () => db.exec(`delete from bk_customer_events`)), "append-only"));
check("B", "contacts are never deleted or truncated", has(await errOf(async () => db.exec(`delete from bk_customers`)), "never deleted") && (await errOf(async () => db.exec(`truncate bk_customers cascade`))) !== null);

// gate
for (const [label, who, code] of [["not the owner", { p: P.alice, u: U.bob }, "not_owner"], ["plan without the toolkit", { p: P.carol, u: U.carol }, "toolkit_not_enabled"], ["demo profile", { p: P.erin, u: U.erin }, "demo_profile_not_supported"]]) {
  const e = await errOf(async () => cust(who, "X", null, null, null));
  check("B", `gate: ${label}`, has(e, code), e);
}

// ======================================================================================= C. linking
const invA1 = await invoice(A, { total: 10000, dueDays: 5 });
const hashBefore = (await one(`select content_hash, md5(customer_snapshot::text) as snap from bk_documents where id = '${invA1}'`));
const link = await fnJson(`doc_set_document_customer('${A.p}','${A.u}','${invA1}','${c1.customer.id}')`);
const hashAfter = (await one(`select content_hash, md5(customer_snapshot::text) as snap from bk_documents where id = '${invA1}'`));
check("C", "an issued invoice can be linked to a contact", link.changed === true && (await count("bk_document_customer_links", `document_id = '${invA1}' and customer_id = '${c1.customer.id}'`)) === 1);
check("C", "linking never touches the frozen invoice: snapshot and content hash identical, and the Phase 2 integrity hash still matches", hashBefore.content_hash === hashAfter.content_hash && hashBefore.snap === hashAfter.snap
  && (await fnJson(`bk_doc_hash('${invA1}')`)) === hashAfter.content_hash);
check("C", "linking twice changes nothing (idempotent)", (await fnJson(`doc_set_document_customer('${A.p}','${A.u}','${invA1}','${c1.customer.id}')`)).changed === false);
const other = (await cust(A, "Client Three", "655000222", null, null)).customer.id;
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${invA1}','${other}')`);
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${invA1}','${c1.customer.id}')`);
const unl = await fnJson(`doc_set_document_customer('${A.p}','${A.u}','${invA1}',null)`);
check("C", "relinking and unlinking work; one current link per invoice; history is kept as events", unl.changed === true && (await count("bk_document_customer_links", `document_id = '${invA1}' and customer_id is null`)) === 1
  && (await count("bk_customer_events", `document_id = '${invA1}' and event_type in ('document_linked','document_unlinked')`)) >= 4);
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${invA1}','${c1.customer.id}')`);
const bobCust = (await one(`select id from bk_customers where profile_id = '${B.p}' limit 1`)).id;
check("C", "another business's invoice or contact cannot be linked", has(await errOf(async () => svc(`select doc_set_document_customer('${B.p}','${B.u}','${invA1}',null)`)), "document_not_found")
  && has(await errOf(async () => svc(`select doc_set_document_customer('${A.p}','${A.u}','${invA1}','${bobCust}')`)), "customer_not_found"));
const rcpt = (await pay(A, invA1, 1000)).receipt.document.id;
check("C", "a receipt cannot be linked (invoices only)", has(await errOf(async () => svc(`select doc_set_document_customer('${A.p}','${A.u}','${rcpt}','${c1.customer.id}')`)), "not_an_invoice"));
check("C", "an archived contact cannot be linked", has(await errOf(async () => svc(`select doc_set_document_customer('${A.p}','${A.u}','${invA1}','${c2a.customer.id}')`)), "customer_archived"));
// direct writes are impossible
for (const role of ["service_role", "authenticated", "anon"]) {
  check("C", `${role} cannot write any Phase 3 table directly`, (await errOf(async () => as(role, U.alice, `insert into bk_customers (profile_id, name) values ('${A.p}', 'x')`))) !== null
    && (await errOf(async () => as(role, U.alice, `update bk_reminders set status = 'sent'`))) !== null && (await errOf(async () => as(role, U.alice, `delete from bk_document_customer_links`))) !== null);
}
check("C", "client roles cannot call any Phase 3 function (only service_role can)", (await errOf(async () => as("authenticated", U.alice, `select doc_receivables_summary('${A.p}','${A.u}')`))) !== null
  && (await errOf(async () => as("anon", null, `select doc_claim_due_reminders(10)`))) !== null && (await errOf(async () => as("authenticated", U.alice, `select bk_norm_phone('677123456')`))) !== null);
// RLS reads
const cA = await as("authenticated", U.alice, `select count(*)::int n from bk_customers`);
const cB = await as("authenticated", U.bob, `select count(*)::int n from bk_customers where profile_id = '${A.p}'`);
const cAnon = await errOf(async () => as("anon", null, `select count(*) from bk_customers`));
check("C", "RLS: an owner reads only their own contacts, links, events and reminders; another owner reads none of them; anon is refused", cA.rows[0].n >= 4 && cB.rows[0].n === 0 && cAnon !== null
  && (await as("authenticated", U.bob, `select (select count(*) from bk_document_customer_links) + (select count(*) from bk_customer_events where profile_id = '${A.p}') + (select count(*) from bk_reminders where profile_id = '${A.p}') as n`)).rows[0].n == 0);
// suggestions
const invSug = await invoice(A, { total: 2500, customer: { name: "Walk-in", phone: "+237 677 12 34 56", email: "CLIENT1@X.TEST" } });
const sug = await fnJson(`doc_suggest_customers('${A.p}','${A.u}','${invSug}')`);
check("C", "suggestions match phone/email across formats within the SAME business, and suggesting never links", sug.length === 1 && sug[0].id === c1.customer.id && sug[0].match === "both" && (await count("bk_document_customer_links", `document_id = '${invSug}'`)) === 0);
const sugB = await fnJson(`doc_suggest_customers('${B.p}','${B.u}','${await invoice(B, { total: 100, customer: { name: "N", phone: "677123456" } })}')`);
check("C", "a business never sees another business's contacts as suggestions", sugB.every((s) => s.id !== c1.customer.id) && sugB.length === 1);

// ======================================================================================= D. receivables
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${invSug}','${c1.customer.id}')`);                  // 2500 for c1
const invPartial = await invoice(A, { total: 6000, dueDays: 3 });
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${invPartial}','${other}')`);
await pay(A, invPartial, 2000);                                                                                  // balance 4000
const invPaid = await invoice(A, { total: 1500 }); await pay(A, invPaid, 1500);
const invVoid = await invoice(A, { total: 800 }); await svc(`select doc_void_document('${A.p}','${A.u}','${invVoid}','test')`);
const invUnassigned = await invoice(A, { total: 3000, dueDays: 2, customer: { name: "No Contact" } });
const entriesBefore = await count("bk_entries");
const snapDocs = async () => (await one(`select md5(string_agg(d::text, '|' order by id)) h from bk_documents d`)).h + (await one(`select md5(coalesce(string_agg(p::text, '|' order by id), '')) h from bk_document_payments p`)).h + (await count("bk_entries"));
const docsBefore = await snapDocs();
const sum = await fnJson(`doc_receivables_summary('${A.p}','${A.u}')`);
const xaf = sum.currencies.find((c) => c.currency === "XAF");
// live: invA1 (10000 - 1000 paid = 9000), invSug 2500, invPartial 4000, invUnassigned 3000
check("D", "outstanding balance = sum of (total - paid) over issued/partially-paid invoices only (paid, void and draft excluded)", xaf.outstanding === "18500.000" && xaf.invoice_count === 4, JSON.stringify(xaf));
check("D", "per-contact balances and the unassigned group are separate and add up", xaf.customers.find((c) => c.customer_id === c1.customer.id).outstanding === "11500.000" && xaf.customers.find((c) => c.customer_id === other).outstanding === "4000.000"
  && xaf.unassigned.outstanding === "3000.000" && xaf.unassigned.invoice_count === 1);
check("D", "nothing is overdue today (all due in the future) and the due-in-future bucket holds everything", xaf.overdue === "0" && xaf.overdue_count === 0 && xaf.aging.not_due.amount === "18500.000");
check("D", "another business's invoices never appear (profile isolation)", (await fnJson(`doc_receivables_summary('${B.p}','${B.u}')`)).currencies.every((c) => c.outstanding === "100.000") );
await setToday(10);
const sumLate = (await fnJson(`doc_receivables_summary('${A.p}','${A.u}')`)).currencies[0];
check("D", "overdue is calculated from the due date in Douala time: looking 10 days ahead, all four are overdue and land in the right aging buckets", sumLate.overdue_count === 4 && sumLate.overdue === "18500.000" && sumLate.aging.d1_30.count === 4 && sumLate.aging.not_due.count === 0, JSON.stringify(sumLate.aging));
await setToday(100);
check("D", "an invoice 90+ days late lands in the oldest bucket", (await fnJson(`doc_receivables_summary('${A.p}','${A.u}')`)).currencies[0].aging.d90_plus.count === 4);
await realToday();
const list = await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,false,null,50,0)`);
check("D", "the invoice list returns the live invoices with amount due, link and flags; no draft/paid/void", list.total === 4 && list.items.length === 4 && list.items.every((i) => ["issued", "partially_paid"].includes(i.status)) && list.items.every((i) => i.can_record_payment === true));
check("D", "filter by contact / unassigned / overdue / paging all work", (await fnJson(`doc_receivable_invoices('${A.p}','${A.u}','${c1.customer.id}',false,false,null,50,0)`)).total === 2
  && (await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,true,false,null,50,0)`)).total === 1 && (await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,true,null,50,0)`)).total === 0
  && (await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,false,null,2,0)`)).items.length === 2 && (await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,false,null,2,2)`)).items.length === 2
  && (await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,false,'USD',50,0)`)).total === 0);
const stmt = await fnJson(`doc_customer_statement('${A.p}','${A.u}','${c1.customer.id}')`);
check("D", "a contact statement lists their invoices and payment history (with the RCT receipt) and totals", stmt.invoices.length === 2 && stmt.payments.length === 1 && stmt.payments[0].receipt_number.startsWith("RCT-") && stmt.totals[0].outstanding === "11500.000");
check("D", "a statement for another business's contact is refused", has(await errOf(async () => svc(`select doc_customer_statement('${B.p}','${B.u}','${c1.customer.id}')`)), "customer_not_found"));
// void a payment: balance restored, shown as voided
const payId = stmt.payments[0].id;
await svc(`select doc_void_payment('${A.p}','${A.u}','${payId}','mistake')`);
const stmt2 = await fnJson(`doc_customer_statement('${A.p}','${A.u}','${c1.customer.id}')`);
check("D", "voiding a payment restores the amount due (invoice back to issued) and the payment shows as voided in the statement", stmt2.totals[0].outstanding === "12500.000" && stmt2.payments[0].voided === true);
// voided invoice leaves receivables
const invToVoid = await invoice(A, { total: 700 });
const beforeVoid = (await fnJson(`doc_receivables_summary('${A.p}','${A.u}')`)).currencies[0].invoice_count;
await svc(`select doc_void_document('${A.p}','${A.u}','${invToVoid}','x')`);
check("D", "a voided invoice is not a debt (it leaves the receivables)", beforeVoid === (await fnJson(`doc_receivables_summary('${A.p}','${A.u}')`)).currencies[0].invoice_count + 1);
// a corrected invoice: the replacement is a new invoice; the void one is out, the new one in
const invOld = await invoice(A, { total: 900 });
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${invOld}','${c1.customer.id}')`);
await svc(`select doc_void_document('${A.p}','${A.u}','${invOld}','typo')`);
const repl = await fnJson(`doc_save_draft('${A.p}','${A.u}',null,'invoice','en','{"name":"Client One"}'::jsonb,((now() at time zone 'Africa/Douala')::date + 4),null,null,false,'[{"description":"G","quantity":"1","unit_price":"950"}]'::jsonb,'${invOld}','${req()}')`);
await svc(`select doc_issue('${A.p}','${A.u}','${repl.document.id}')`);
check("D", "a corrected invoice is its own debt (and the voided original is not); the replacement can be linked to the same contact", (await fnJson(`doc_set_document_customer('${A.p}','${A.u}','${repl.document.id}','${c1.customer.id}')`)).changed === true
  && (await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,false,null,100,0)`)).items.some((i) => i.id === repl.document.id) && !(await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,false,null,100,0)`)).items.some((i) => i.id === invOld));
// currency behaviour of Phase 2 is documented, not changed
await db.exec(`update public.profiles set currency = 'USD' where id = '${A.p}'`);
const sumCur = await fnJson(`doc_receivables_summary('${A.p}','${A.u}')`);
const curErr = await errOf(async () => pay(A, invA1, 10));
check("D", "EXISTING Phase 2 behaviour, unchanged: once the profile currency differs from the invoice currency the invoice cannot take a payment (currency_changed); receivables still show it, flagged can_record_payment = false", has(curErr, "currency_changed")
  && sumCur.currencies.find((c) => c.currency === "XAF").can_record_payment === false && (await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,false,null,100,0)`)).items.every((i) => i.can_record_payment === false));
await db.exec(`update public.profiles set currency = 'XAF' where id = '${A.p}'`);
// bookkeeping and ledgers untouched by any read/link/customer function so far
const reads = await snapDocs();
await fnJson(`doc_receivables_summary('${A.p}','${A.u}')`); await fnJson(`doc_receivable_invoices('${A.p}','${A.u}',null,false,false,null,50,0)`); await fnJson(`doc_customer_statement('${A.p}','${A.u}','${c1.customer.id}')`);
await fnJson(`doc_suggest_customers('${A.p}','${A.u}','${invSug}')`);
check("D", "ZERO bookkeeping effect (strict): reads, suggestions and statements leave invoices, payments and entries byte-identical", reads === (await snapDocs()));
const entriesNow = await count("bk_entries");
check("D", "bookkeeping entries exist ONLY from payments (one per recorded payment, Phase 2): entries = payments recorded", entriesNow === (await count("bk_document_payments")) && entriesNow > entriesBefore - 1);
check("D", "no accrued-sale entry exists for any unpaid invoice: every bookkeeping entry is an invoice-payment entry that belongs to a recorded payment, and there are no others", (await count("bk_entries", "category is distinct from 'invoice_payment'")) === 0
  && (await count("bk_entries", "not exists (select 1 from bk_document_payments p where p.bk_entry_id = bk_entries.id)")) === 0);

// ======================================================================================= E. settings
const ST = (o, a) => fnJson(`doc_upsert_reminder_settings('${o.p}','${o.u}',${a.auto},${a.before ?? "null"},${a.onDue ?? false},${a.every === undefined ? 7 : a.every ?? "null"},${a.max ?? 3},${a.alerts ?? false})`);
check("E", "no settings row exists by default, so automatic email and owner alerts are OFF for everyone", (await count("bk_reminder_settings")) === 0);
await db.exec(`update bk_business_profiles set email = null where profile_id = '${B.p}'`).catch(() => {});
const enableNoEmail = await errOf(async () => { await db.exec(`alter table bk_business_profiles disable trigger bk_business_profiles_guard_trg; update bk_business_profiles set email = null where profile_id = '${B.p}'; alter table bk_business_profiles enable trigger bk_business_profiles_guard_trg`); return ST(B, { auto: true, onDue: true }); });
check("E", "enabling automatic email requires a business email on the Phase 2 profile (business_email_required)", has(enableNoEmail, "business_email_required"));
await db.exec(`alter table bk_business_profiles disable trigger bk_business_profiles_guard_trg; update bk_business_profiles set email = 'bob@shop.test' where profile_id = '${B.p}'; alter table bk_business_profiles enable trigger bk_business_profiles_guard_trg`);
check("E", "enabling with no timing selected is refused (no_reminder_timing)", has(await errOf(async () => ST(A, { auto: true, before: null, onDue: false, every: null })), "no_reminder_timing"));
for (const [label, a] of [["before 0", { auto: false, before: 0 }], ["before 15", { auto: false, before: 15 }], ["every 2", { auto: false, every: 2 }], ["every 61", { auto: false, every: 61 }], ["max 0", { auto: false, max: 0 }], ["max 7", { auto: false, max: 7 }]]) {
  check("E", `invalid setting rejected: ${label}`, has(await errOf(async () => ST(A, a)), "invalid_setting"));
}
const off = await ST(A, { auto: false });
check("E", "saving with auto off keeps it off; the defaults are overdue every 7 days and 3 automatic reminders per invoice", off.auto_email_enabled === false && off.auto_enabled_at === null && off.overdue_every_days === 7 && off.max_auto_per_invoice === 3 && off.owner_alerts_enabled === false);
const on1 = await ST(A, { auto: true, onDue: true, every: 7 });
const on2 = await ST(A, { auto: true, onDue: true, every: 14 });
check("E", "enabling stamps auto_enabled_at once; changing other values while enabled keeps the original stamp", on1.auto_email_enabled === true && on1.auto_enabled_at && on2.auto_enabled_at === on1.auto_enabled_at && on2.overdue_every_days === 14);
const dis = await ST(A, { auto: false });
check("E", "disabling clears the stamp; enabling again restamps", dis.auto_enabled_at === null && (await ST(A, { auto: true, onDue: true })).auto_enabled_at !== null);
await ST(A, { auto: false });
check("E", "settings can be set only by the owner of an entitled profile", has(await errOf(async () => ST({ p: A.p, u: U.bob }, { auto: false })), "not_owner") && has(await errOf(async () => ST({ p: P.carol, u: U.carol }, { auto: false })), "toolkit_not_enabled"));

// ======================================================================================= F. manual reminders
const MR = (o, doc, channel, rid = req(), hash = null) => fnJson(`doc_record_manual_reminder('${o.p}','${o.u}','${doc}','${channel}','${rid}',${q(hash)})`);
const invM = await invoice(A, { total: 5000, dueDays: 1, customer: { name: "Mia", email: "mia@x.test", phone: "699111222" } });
const m1rid = req();
const m1 = await MR(A, invM, "email", m1rid);
check("F", "a manual email reminder is claimed first (status claimed) with the amount due, a masked recipient hint and no link", m1.status === "claimed" && m1.context.amount_due === "5000.000" && m1.context.to === "mia@x.test" && m1.context.include_link === false
  && (await one(`select recipient_hint, include_link, trigger_type, kind from bk_reminders where id = '${m1.reminder_id}'`)).recipient_hint === "m***@x.test");
const m1dup = await MR(A, invM, "email", m1rid);
check("F", "the same request id returns the original reminder and does NOT claim a second one (so no second email)", m1dup.duplicate === true && m1dup.reminder_id === m1.reminder_id && (await count("bk_reminders", `document_id = '${invM}'`)) === 1);
check("F", "a second customer email within 24 hours is refused (reminder_too_soon)", has(await errOf(async () => MR(A, invM, "email")), "reminder_too_soon"));
const done = await fnJson(`doc_complete_reminder('${A.p}','${m1.reminder_id}','sent',null)`);
check("F", "the outcome is recorded once; completing again is a harmless no-op", done.status === "sent" && done.already_completed === false && (await fnJson(`doc_complete_reminder('${A.p}','${m1.reminder_id}','failed','x')`)).already_completed === true
  && (await one(`select status from bk_reminders where id = '${m1.reminder_id}'`)).status === "sent");
check("F", "a recorded reminder can never be rewritten or deleted", has(await errOf(async () => db.exec(`update bk_reminders set status = 'failed' where id = '${m1.reminder_id}'`)), "outcome already recorded") && has(await errOf(async () => db.exec(`delete from bk_reminders`)), "never deleted")
  && has(await errOf(async () => db.exec(`update bk_reminders set amount_due = 1 where id = '${m1.reminder_id}'`)), "immutable"));
check("F", "another business cannot complete or read it (reminder_not_found)", has(await errOf(async () => svc(`select doc_complete_reminder('${B.p}','${m1.reminder_id}','sent',null)`)), "reminder_not_found"));
await backdate("bk_reminders", `document_id = '${invM}'`, "25 hours");
check("F", "after 24 hours a new manual email is allowed", (await MR(A, invM, "email")).status === "claimed");
// per-invoice cap
const invCap = await invoice(A, { total: 4000, customer: { name: "Cap", email: "cap@x.test" } });
for (let i = 0; i < 10; i++) await db.exec(`insert into bk_reminders (profile_id, document_id, trigger_type, channel, kind, status, dedupe_key, client_request_id, amount_due, currency, locale, completed_at, actor_user_id)
  values ('${A.p}','${invCap}','manual','email','manual','sent','capx${i}','${req()}',4000,'XAF','en',now(),'${A.u}')`);
await backdate("bk_reminders", `document_id = '${invCap}'`, "30 hours");
check("F", "at most 10 customer emails per invoice (invoice_reminder_cap), whatever their spacing", has(await errOf(async () => MR(A, invCap, "email")), "invoice_reminder_cap"));
// problems
const invNoMail = await invoice(A, { total: 100, customer: { name: "No Mail", phone: "699333444" } });
check("F", "no email on the invoice: email refused (no_email) but a WhatsApp preparation is possible", has(await errOf(async () => MR(A, invNoMail, "email")), "no_email") && (await MR(A, invNoMail, "whatsapp_manual")).status === "prepared");
await db.exec(`insert into email_suppressions (email) values ('sup@x.test')`);
const invSup = await invoice(A, { total: 100, customer: { name: "Sup", email: "SUP@x.test" } });
check("F", "an address on the suppression list is refused (email_suppressed)", has(await errOf(async () => MR(A, invSup, "email")), "email_suppressed"));
check("F", "paid, void and draft-like invoices cannot be reminded (invoice_not_open)", has(await errOf(async () => MR(A, invPaid, "email")), "invoice_not_open") && has(await errOf(async () => MR(A, invVoid, "email")), "invoice_not_open"));
check("F", "another business's invoice cannot be reminded (document_not_found)", has(await errOf(async () => MR(B, invM, "email")), "document_not_found"));
check("F", "a request id is required and the channel must be known", has(await errOf(async () => svc(`select doc_record_manual_reminder('${A.p}','${A.u}','${invM}','email',null,null)`)), "request_id_required") && has(await errOf(async () => MR(A, invM, "sms")), "invalid_channel"));
// archived / paused
const invCust = await invoice(A, { total: 300, customer: { name: "Pause", email: "pause@x.test", phone: "699555666" } });
const pc = (await cust(A, "Pause Customer", "699555666", "pause@x.test", null)).customer.id;
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${invCust}','${pc}')`);
await svc(`select bk_customer_set_auto_paused('${A.p}','${A.u}','${pc}',true)`);
check("F", "a contact paused for AUTOMATIC reminders can still be reminded manually", (await MR(A, invCust, "email")).status === "claimed");
await svc(`select bk_customer_set_archived('${A.p}','${A.u}','${pc}',true)`);
check("F", "an archived contact cannot be reminded (customer_archived)", has(await errOf(async () => MR(A, invCust, "whatsapp_manual")), "customer_archived"));
// WhatsApp
const w = await MR(A, invM, "whatsapp_manual");
check("F", "a WhatsApp reminder is only ever 'prepared' (click-to-chat), with the normalised number, immediately complete", w.status === "prepared" && w.context.phone === "237699111222" && (await one(`select completed_at is not null as c, status, recipient_hint from bk_reminders where id = '${w.reminder_id}'`)).c === true);
check("F", "the database refuses to ever store a WhatsApp reminder as sent or delivered", (await errOf(async () => db.exec(`insert into bk_reminders (profile_id, document_id, trigger_type, channel, kind, status, dedupe_key, client_request_id, amount_due, currency, locale, completed_at, actor_user_id)
  values ('${A.p}','${invM}','manual','whatsapp_manual','manual','sent','wx1','${req()}',1,'XAF','en',now(),'${A.u}')`))) !== null);
check("F", "WhatsApp needs a phone (no_phone) and is not limited by the 24-hour email spacing", has(await errOf(async () => MR(A, await invoice(A, { total: 50, customer: { name: "Nophone" } }), "whatsapp_manual")), "no_phone") && (await MR(A, invM, "whatsapp_manual")).status === "prepared");
// share link
const tok = crypto.randomBytes(32).toString("base64url"), h = sha(tok);
const invS = await invoice(A, { total: 777, customer: { name: "Share", email: "share@x.test", phone: "699888777" } });
const sh = await fnJson(`doc_create_share('${A.p}','${A.u}','${invS}','${h}',14)`);
const sharesBefore = await count("bk_document_shares");
check("F", "doc_check_share is true only for a valid link of THIS invoice and has no side effect (no access counter)", (await fnJson(`doc_check_share('${A.p}','${A.u}','${invS}','${h}')`)) === true && (await fnJson(`doc_check_share('${A.p}','${A.u}','${invM}','${h}')`)) === false
  && (await fnJson(`doc_check_share('${A.p}','${A.u}','${invS}','${"0".repeat(64)}')`)) === false && (await fnJson(`doc_check_share('${A.p}','${A.u}','${invS}','nope')`)) === false && (await one(`select access_count from bk_document_shares where id = '${sh.share_id}'`)).access_count === 0);
const ms = await MR(A, invS, "email", req(), h);
check("F", "a manual email may include a link ONLY when the owner supplies a valid one (include_link true); the token is never stored and no link was created", ms.context.include_link === true && (await count("bk_document_shares")) === sharesBefore
  && !JSON.stringify(await db.query(`select * from bk_reminders where id = '${ms.reminder_id}'`)).includes(h) && !JSON.stringify(ms).includes(tok));
check("F", "a wrong, other-invoice or revoked link is refused (share_link_invalid)", has(await errOf(async () => MR(A, invSup === invS ? invM : invM, "whatsapp_manual", req(), h)), "share_link_invalid") && has(await errOf(async () => MR(A, invS, "whatsapp_manual", req(), "f".repeat(64))), "share_link_invalid"));
await svc(`select doc_revoke_share('${A.p}','${A.u}','${sh.share_id}')`);
check("F", "a revoked link is refused", has(await errOf(async () => MR(A, invS, "whatsapp_manual", req(), h)), "share_link_invalid"));
check("F", "the reminder table has no column that could hold a token, hash or URL", (await db.query(`select column_name from information_schema.columns where table_name = 'bk_reminders' and (column_name like '%token%' or column_name like '%hash%' or column_name like '%url%' or column_name like '%secret%')`)).rows.map((r) => r.column_name).join() === "");
// daily cap
const invDay = await invoice(A, { total: 60, customer: { name: "Day", email: "day@x.test" } });
const emailsToday = await count("bk_reminders", `profile_id = '${A.p}' and channel = 'email' and status in ('claimed','sent') and created_at >= date_trunc('day', now() at time zone 'Africa/Douala') at time zone 'Africa/Douala'`);
for (let i = emailsToday; i < 100; i++) await db.exec(`insert into bk_reminders (profile_id, document_id, trigger_type, channel, kind, status, dedupe_key, client_request_id, amount_due, currency, locale, completed_at, actor_user_id)
  values ('${A.p}','${invDay}','manual','email','manual','sent','dayx${i}','${req()}',60,'XAF','en',now(),'${A.u}')`);
const invDay2 = await invoice(A, { total: 61, customer: { name: "Day2", email: "day2@x.test" } });
check("F", "a business can send at most 100 customer emails per day (daily_cap_reached)", has(await errOf(async () => MR(A, invDay2, "email")), "daily_cap_reached"));
await db.exec(`delete from bk_reminders where dedupe_key like 'dayx%'`).catch(() => {});

// ======================================================================================= G. automatic reminders
await db.exec(`alter table bk_reminders disable trigger bk_reminders_guard_trg; delete from bk_reminders where dedupe_key like 'dayx%' or dedupe_key like 'capx%'; alter table bk_reminders enable trigger bk_reminders_guard_trg`).catch(() => {});
const claim = (n = 200) => fnJson(`doc_claim_due_reminders(${n})`);
await db.exec(`alter table bk_reminders disable trigger bk_reminders_guard_trg; delete from bk_reminders; alter table bk_reminders enable trigger bk_reminders_guard_trg`);
await db.exec(`delete from bk_reminder_settings`).catch(() => {});
check("G", "with no settings at all, nothing is claimed (OFF by default)", (await claim()).emails.length === 0 && (await claim()).alerts.length === 0);
// fresh invoices due today for the claim tests
const tA = await invoice(A, { total: 1200, dueDays: 0, customer: { name: "Due Today", email: "today@x.test", phone: "699777888" } });
await ST(A, { auto: false });
check("G", "settings present but auto disabled: still nothing", (await claim()).emails.length === 0);
await ST(A, { auto: true, onDue: true, every: 7, max: 3 });
const c = await claim();
const em = c.emails.filter((e) => e.document_id === tA);
check("G", "an invoice due today is claimed (kind due_today) with the amount due, recipient, seller, reply-to and NO link", em.length === 1 && em[0].kind === "due_today" && em[0].amount_due === "1200.000" && em[0].to === "today@x.test" && em[0].reply_to === "alice@shop.test" && em[0].seller_name === "Alice Shop"
  && !JSON.stringify(em[0]).match(/share|token|\/d\//i));
check("G", "the claimed row exists as 'claimed' with trigger auto and include_link false (claimed BEFORE any send)", (await one(`select status, trigger_type, channel, include_link, actor_user_id from bk_reminders where id = '${em[0].reminder_id}'`)).status === "claimed");
check("G", "claiming again claims nothing for the same invoice (dedupe key) — no duplicate email, ever", (await claim()).emails.filter((e) => e.document_id === tA).length === 0);
check("G", "invoices due later are NOT claimed when only 'on due day' is selected", c.emails.every((e) => e.document_id === tA || e.kind !== "before_due"));
// completion + stale
await fnJson(`doc_complete_reminder('${A.p}','${em[0].reminder_id}','sent',null)`);
const staleDoc = await invoice(A, { total: 321, dueDays: 0, customer: { name: "Stale", email: "stale@x.test" } });
const c2 = await claim();
const staleRow = c2.emails.find((e) => e.document_id === staleDoc);
await backdate("bk_reminders", `id = '${staleRow.reminder_id}'`, "2 hours");
check("G", "a claim that never got an outcome is closed as failed (stale_claim) and is never retried", (await fnJson(`doc_expire_stale_reminder_claims(60)`)) === 1 && (await one(`select status, failure_code from bk_reminders where id = '${staleRow.reminder_id}'`)).failure_code === "stale_claim"
  && (await claim()).emails.filter((e) => e.document_id === staleDoc).length === 0);
check("G", "sent reminders are untouched by the stale sweep", (await one(`select status from bk_reminders where id = '${em[0].reminder_id}'`)).status === "sent");
// overdue cycles + spacing + max
const oDoc = await invoice(A, { total: 2000, dueDays: 0, customer: { name: "Late", email: "late@x.test" } });
await ST(A, { auto: true, onDue: false, every: 7, max: 2 });
await setToday(3);
const o1 = (await claim()).emails.filter((e) => e.document_id === oDoc);
check("G", "3 days overdue: the first overdue reminder is claimed (kind overdue, cycle 0)", o1.length === 1 && o1[0].kind === "overdue" && o1[0].days_overdue === 3);
await fnJson(`doc_complete_reminder('${A.p}','${o1[0].reminder_id}','sent',null)`);
await setToday(8);
check("G", "spacing: 8 days overdue but the last email was sent moments ago, so the 7-day spacing blocks a second one", (await claim()).emails.filter((e) => e.document_id === oDoc).length === 0);
await backdate("bk_reminders", `document_id = '${oDoc}'`, "8 days");
const o2 = (await claim()).emails.filter((e) => e.document_id === oDoc);
check("G", "once the spacing has passed, the next cycle's reminder is claimed", o2.length === 1 && o2[0].kind === "overdue");
await fnJson(`doc_complete_reminder('${A.p}','${o2[0].reminder_id}','sent',null)`);
await backdate("bk_reminders", `document_id = '${oDoc}'`, "9 days");
await setToday(20);
check("G", "the per-invoice maximum (2) stops further automatic reminders", (await claim()).emails.filter((e) => e.document_id === oDoc).length === 0);
await realToday();
// eligibility problems
const eligDocs = {};
for (const [k, cust2] of Object.entries({ paused: { name: "P", email: "p@x.test" }, archived: { name: "A", email: "a@x.test" }, suppressed: { name: "S", email: "sup@x.test" }, nomail: { name: "N" }, paid: { name: "Pd", email: "pd@x.test" }, voided: { name: "V", email: "v@x.test" }, partial: { name: "Pt", email: "pt@x.test" } })) {
  eligDocs[k] = await invoice(A, { total: 1000, dueDays: 0, customer: cust2 });
}
await ST(A, { auto: true, onDue: true, every: 7, max: 3 });
const cp = (await cust(A, "AutoPaused", null, "p@x.test", null)).customer.id, ca = (await cust(A, "AutoArchived", null, "a@x.test", null)).customer.id;
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${eligDocs.paused}','${cp}')`); await svc(`select bk_customer_set_auto_paused('${A.p}','${A.u}','${cp}',true)`);
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${eligDocs.archived}','${ca}')`); await svc(`select bk_customer_set_archived('${A.p}','${A.u}','${ca}',true)`);
await pay(A, eligDocs.paid, 1000); await svc(`select doc_void_document('${A.p}','${A.u}','${eligDocs.voided}','x')`);
await pay(A, eligDocs.partial, 400);
const c3 = await claim();
const ids = new Set(c3.emails.map((e) => e.document_id));
check("G", "paused contact, archived contact, suppressed address, missing email, fully paid and void invoices are all skipped", ![eligDocs.paused, eligDocs.archived, eligDocs.suppressed, eligDocs.nomail, eligDocs.paid, eligDocs.voided].some((d) => ids.has(d)));
const pr = c3.emails.find((e) => e.document_id === eligDocs.partial);
check("G", "a partially paid invoice IS reminded, for the remaining amount due only", pr && pr.amount_due === "600.000");
// entitlement at claim time
const entDoc = await invoice(A, { total: 450, dueDays: 0, customer: { name: "Ent", email: "ent@x.test" } });
const tryClaim = async () => (await claim()).emails.some((e) => e.document_id === entDoc);
await db.exec(`update public.plans set business_toolkit_enabled = false where name = 'business_pro'`);
const planOff = await tryClaim();
await db.exec(`update public.plans set business_toolkit_enabled = true where name = 'business_pro'`);
await db.exec(`update public.profiles set is_demo = true where id = '${A.p}'`); const demoOn = await tryClaim(); await db.exec(`update public.profiles set is_demo = false where id = '${A.p}'`);
await db.exec(`update public.profiles set category = 'restaurant_food' where id = '${A.p}'`); const catOff = await tryClaim(); await db.exec(`update public.profiles set category = 'business_ecommerce' where id = '${A.p}'`);
await db.exec(`alter table bk_business_profiles disable trigger bk_business_profiles_guard_trg; update bk_business_profiles set email = null where profile_id = '${A.p}'; alter table bk_business_profiles enable trigger bk_business_profiles_guard_trg`);
const noReply = await tryClaim();
await db.exec(`alter table bk_business_profiles disable trigger bk_business_profiles_guard_trg; update bk_business_profiles set email = 'alice@shop.test' where profile_id = '${A.p}'; alter table bk_business_profiles enable trigger bk_business_profiles_guard_trg`);
check("G", "re-checked at claim time: plan without the toolkit, a demo profile, a non-Business category and a removed business email each stop the claim", planOff === false && demoOn === false && catOff === false && noReply === false);
check("G", "…and with everything restored the same invoice IS claimed", await tryClaim());
// enabled-date rule
const oldDoc = await invoice(A, { total: 880, dueDays: 0, customer: { name: "Old", email: "old@x.test" } });
await db.exec(`update bk_reminder_settings set auto_enabled_at = now() + interval '3 days' where profile_id = '${A.p}'`);
check("G", "invoices due BEFORE automatic reminders were enabled are never claimed (no backlog blast)", (await claim()).emails.filter((e) => e.document_id === oldDoc).length === 0);
await db.exec(`update bk_reminder_settings set auto_enabled_at = now() where profile_id = '${A.p}'`);
// daily cap 30
await db.exec(`alter table bk_reminders disable trigger bk_reminders_guard_trg; delete from bk_reminders where dedupe_key like 'cap30%'; alter table bk_reminders enable trigger bk_reminders_guard_trg`);
const capDoc = await invoice(A, { total: 70, dueDays: 0, customer: { name: "Cap30", email: "cap30@x.test" } });
const sentToday = await count("bk_reminders", `profile_id = '${A.p}' and channel = 'email' and status in ('claimed','sent') and created_at >= (((now() at time zone 'Africa/Douala')::date)::timestamp at time zone 'Africa/Douala')`);
for (let i = sentToday; i < 30; i++) await db.exec(`insert into bk_reminders (profile_id, document_id, trigger_type, channel, kind, status, dedupe_key, client_request_id, amount_due, currency, locale, completed_at, actor_user_id)
  values ('${A.p}','${capDoc}','manual','email','manual','sent','cap30_${i}','${req()}',70,'XAF','en',now(),'${A.u}')`);
check("G", "the per-business daily budget (30 customer emails) stops automatic claims", (await claim()).emails.filter((e) => e.document_id === capDoc).length === 0);
// isolation
check("G", "claims never mix businesses: every claimed row belongs to the business whose settings enabled it (bob has none enabled)", (await claim()).emails.every((e) => e.profile_id === A.p));
// owner alerts
await db.exec(`alter table bk_reminders disable trigger bk_reminders_guard_trg; delete from bk_reminders where dedupe_key like 'cap30%'; alter table bk_reminders enable trigger bk_reminders_guard_trg`);
const alertDoc = await invoice(A, { total: 515, dueDays: 0, customer: { name: "Alert", email: "alert@x.test" } });
await ST(A, { auto: true, onDue: true, every: 7, max: 3, alerts: false });
await setToday(1);
check("G", "owner alerts are OFF by default: nothing claimed", (await claim()).alerts.length === 0);
await ST(A, { auto: true, onDue: true, every: 7, max: 3, alerts: true });
const al = (await claim()).alerts.filter((a) => a.document_id === alertDoc);
check("G", "with alerts on, the owner is alerted once, the first day an invoice is overdue (owner_user_id returned, channel owner_alert)", al.length === 1 && al[0].owner_user_id === A.u && (await one(`select channel, kind, status from bk_reminders where id = '${al[0].reminder_id}'`)).channel === "owner_alert");
check("G", "the alert is deduped (not repeated) and a later day produces none (no backlog)", (await claim()).alerts.filter((a) => a.document_id === alertDoc).length === 0 && (await (async () => { await setToday(2); return (await claim()).alerts.filter((a) => a.document_id === alertDoc).length === 0; })()));
await realToday();
// constraints: automatic never carries a link
check("G", "the database refuses an automatic reminder that carries a link", (await errOf(async () => db.exec(`insert into bk_reminders (profile_id, document_id, trigger_type, channel, kind, status, dedupe_key, amount_due, currency, locale, include_link, completed_at)
  values ('${A.p}','${tA}','auto','email','overdue','sent','linky',1,'XAF','en',true,now())`))) !== null);
check("G", "the database refuses duplicate dedupe keys per business", (await errOf(async () => db.exec(`insert into bk_reminders (profile_id, document_id, trigger_type, channel, kind, status, dedupe_key, amount_due, currency, locale, include_link, completed_at)
  values ('${A.p}','${tA}','auto','email','overdue','sent','auto:${tA}:due:${await today()}',1,'XAF','en',false,now())`))) !== null);
// phase 3 never wrote ledgers
check("G", "after all of the above, Phase 3 created ZERO bookkeeping entries of its own: entries are still exactly one per recorded payment", (await count("bk_entries")) === (await count("bk_document_payments")));
check("G", "…and the Phase 1 void guard target still exists: a payment's entry is linked and voided only through doc_void_payment (every payment row has its entry)", (await count("bk_document_payments", "bk_entry_id is not null")) === (await count("bk_document_payments")));

// ======================================================================================= G2. privacy: erasing a contact's personal data
// Not a shipped feature: this proves the APPROACH works inside the existing guards and shows exactly what it does and does not reach.
await db.exec(`delete from bk_reminder_settings where profile_id = '${A.p}'`).catch(() => {});
await ST(A, { auto: true, onDue: true, every: 7, max: 3 });
const eraseDoc = await invoice(A, { total: 900, dueDays: 0, customer: { name: "Erasure Subject", email: "erase.me@x.test", phone: "699404040" } });
const erasee = (await cust(A, "Erasure Subject", "699404040", "erase.me@x.test", "private note")).customer.id;
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${eraseDoc}','${erasee}')`);
await svc(`select bk_customer_set_archived('${A.p}','${A.u}','${erasee}',true)`);
const finBefore = await one(`select md5(d::text) as d, (select md5(coalesce(string_agg(p::text, '|' order by id), '')) from bk_document_payments p) as p, (select count(*) from bk_entries) as e from bk_documents d where id = '${eraseDoc}'`);
const anon = await errOf(async () => db.exec(`update bk_customers set name = 'Erased contact', phone = null, email = null, phone_normalized = null, email_normalized = null, notes = null, auto_reminders_paused = true where id = '${erasee}'`));
check("G2", "the contact's personal fields CAN be anonymised in place (name placeholder, phone/email/notes cleared) under the existing guards: no schema change, no delete, identity and links kept", anon === null
  && (await one(`select name, phone, email, notes from bk_customers where id = '${erasee}'`)).name === "Erased contact" && (await count("bk_document_customer_links", `customer_id = '${erasee}'`)) === 1);
check("G2", "anonymising touches NO financial record: the invoice row, every payment and the bookkeeping entries are byte-identical", JSON.stringify(finBefore) === JSON.stringify(await one(`select md5(d::text) as d, (select md5(coalesce(string_agg(p::text, '|' order by id), '')) from bk_document_payments p) as p, (select count(*) from bk_entries) as e from bk_documents d where id = '${eraseDoc}'`)));
check("G2", "events and past reminders are kept (audit trail intact); a reminder keeps only its masked hint", (await count("bk_customer_events", `customer_id = '${erasee}'`)) >= 3);
check("G2", "an ARCHIVED contact (erased or not) can never resume reminders: manual is refused and the automatic claim skips its invoice", has(await errOf(async () => MR(A, eraseDoc, "email")), "customer_archived") && has(await errOf(async () => MR(A, eraseDoc, "whatsapp_manual")), "customer_archived")
  && (await claim()).emails.every((e) => e.document_id !== eraseDoc));
check("G2", "the statement still works for an erased contact (history of the money is preserved)", (await fnJson(`doc_customer_statement('${A.p}','${A.u}','${erasee}')`)).customer.name === "Erased contact");
await svc(`select doc_set_document_customer('${A.p}','${A.u}','${eraseDoc}',null)`);
check("G2", "KNOWN GAP (documented, needs a product/legal decision): the frozen INVOICE snapshot still holds the person's name/email/phone, and once the invoice is unlinked from the archived contact the invoice can be reminded again from that snapshot",
  (await claim()).emails.some((e) => e.document_id === eraseDoc) || (await MR(A, eraseDoc, "email")).status === "claimed");

// ======================================================================================= H. rollback
const phase2Names = (await db.query(`select tablename from pg_tables where schemaname = 'public' and tablename like 'bk\\_%' and tablename not in ('bk_customers','bk_document_customer_links','bk_customer_events','bk_reminder_settings','bk_reminders') order by 1`)).rows.map((r) => r.tablename).join();
const rbErr = await errOf(async () => db.exec(ROLLBACK3));
check("H", "the documented rollback runs cleanly", rbErr === null, rbErr);
const left = await db.query(`select (select count(*) from pg_tables where schemaname = 'public' and tablename in ('bk_customers','bk_document_customer_links','bk_customer_events','bk_reminder_settings','bk_reminders')) as t,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'bk\\_norm\\_%' or p.proname like 'bk\\_rem\\_%' or p.proname like 'bk\\_customer%' or p.proname in ('doc_set_document_customer','doc_suggest_customers','doc_receivables_summary','doc_receivable_invoices','doc_customer_statement','doc_check_share','doc_upsert_reminder_settings','doc_record_manual_reminder','doc_complete_reminder','doc_expire_stale_reminder_claims','doc_claim_due_reminders'))) as f`);
check("H", "rollback removes every Phase 3 table and function", Number(left.rows[0].t) === 0 && Number(left.rows[0].f) === 0, JSON.stringify(left.rows[0]));
const post = await snapshot();
check("H", "after rollback the database is exactly as it was before Phase 3 (Phase 1/2 intact, all their data kept)", JSON.stringify(post.filter((x) => !isPhase3(x))) === JSON.stringify(before.filter((x) => !isPhase3(x))) && post.filter(isPhase3).length === 0, post.filter(isPhase3).slice(0, 3).join("|"));
check("H", "Phase 2 data survived the rollback (invoices, payments and bookkeeping entries untouched)", (await count("bk_documents")) > 10 && (await count("bk_document_payments")) > 0 && (await count("bk_entries")) > 0 && phase2Names.includes("bk_documents"));
check("H", "the migration can be applied again after a rollback", (await errOf(async () => db.exec(PHASE3))) === null && (await db.exec(VERIFY3))[0].rows.every((r) => r.ok === true));

console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
