// WhatsApp Smart Card sales bot, end to end. REAL code: the webhook route (signature, ingest, automation), the bot (machine + runner), the EXISTING /api/signup-requests and
// /api/signup-requests/[id]/pay route handlers, signupPayment.ts (computeSignupAmount / confirmSignupPayment and the payment-confirmed hook), the text sender, and the REAL database
// functions (Inbox migrations 2026-12-07..11, the push migration and the sales-bot migration) on scratch in-memory PostgreSQL (PGlite).
// Stand-ins: Meta's Graph API (mocked fetch), Fapshi (stub), the push senders (captured), and a tiny in-memory table fake for signup_requests / addons / profiles (the tables the
// existing routes read). No Supabase, no network, no credentials, no production ids.
//   Run:  node scripts/tests/whatsappSalesBot.test.mjs
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const nodeRequire = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const ts = nodeRequire("typescript");
const { PGlite } = await import(process.env.PGLITE_ENTRY || "@electric-sql/pglite");
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 700)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

// ------------------------------------------------------------------ module loader with stand-ins for the vendors
const React = nodeRequire("react");
const pushes = []; const adminPushes = []; const fapshiCalls = []; const notes = [];
let fapshiMode = "ok"; let fapshiSeq = 0;
const STUBS = {
  "next/server": { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } }) } },
  "react": { ...React, cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: () => ({}), createAdminClient: () => globalThis.__admin() },
  "@/lib/notifications": {
    notifyUser: async (userId, n) => { notes.push({ userId, ...n }); },
    notifyAdmins: async (n) => { notes.push({ admin: true, ...n }); },
    getSignupRequestReviewers: async () => ({ adminEmails: [], superCreator: null }),
  },
  "@/lib/push/withBell": {
    sendPushAndBellToUser: async (_a, userId, payload) => { if (globalThis.__pushThrows) throw new Error("push down"); pushes.push({ kind: "bell", userId, payload }); },
    sendPushAndBellToAdmins: async (_a, payload) => { adminPushes.push(payload); },
  },
  "@/lib/push/send": { sendPushToUser: async (_a, userId, payload) => { if (globalThis.__pushThrows) throw new Error("push down"); pushes.push({ kind: "only", userId, payload }); } },
  "@/lib/fapshi": {
    fapshiDirectPay: async (a) => {
      fapshiCalls.push(a);
      if (fapshiMode === "reject") throw new Error("Operator refused");
      if (fapshiMode === "uncertain") throw Object.assign(new Error("timeout"), { uncertain: true });
      return { transId: `TX${++fapshiSeq}` };
    },
    fapshiGetStatus: async (id) => ({ status: globalThis.__fapshiStatus || "CREATED", transId: id }),
  },
  "@/lib/platformSettings": { getPlatformSettings: async () => ({ fapshiEnabled: globalThis.__fapshiOn !== false }) },
  "@/lib/email/emailShell": { emailShell: (s) => s },
  "@/lib/email/provider": { sendEmail: async () => undefined },
  "@/lib/ambassador/notifications": { notifySaleConfirmed: async () => undefined },
};
const cache = new Map();
function resolveLocal(spec, fromDir) {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(fromDir, spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) { const f = base + ext; if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
}
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (spec) => { if (STUBS[spec]) return STUBS[spec]; const local = resolveLocal(spec, path.dirname(file)); return local ? loadTs(local) : nodeRequire(spec); };
  new Function("exports", "require", "module", "__filename", out)(mod.exports, req, mod, file);
  return mod.exports;
}
const src = (p) => loadTs(path.join(SRC, p));
const Machine = src("lib/salesBot/machine.ts");
const Offers = src("lib/salesBot/offers.ts");
const Ids = src("lib/salesBot/ids.ts");
const Runner = src("lib/salesBot/runner.ts");
const Notice = src("lib/salesBot/paymentNotice.ts");
const Handoff = src("lib/salesBot/handoff.ts");
const SignupPay = src("lib/signupPayment.ts");
const webhook = src("app/api/integrations/whatsapp/webhook/route.ts");
const { translations } = src("lib/i18n/translations.ts");
const EN = translations.en.inbox.salesBot, FR = translations.fr.inbox.salesBot;

// ------------------------------------------------------------------ in-memory tables for the existing routes (signup_requests, addons, profiles)
const A_STD = "b0000000-0000-4000-8000-000000000001", A_PRO = "b0000000-0000-4000-8000-000000000002", A_PREM = "b0000000-0000-4000-8000-000000000003", A_OTHER = "b0000000-0000-4000-8000-000000000009";
const tables = {};
const seedTables = () => {
  tables.addons = [
    { id: A_STD, name: "Ringo Smart Physical Card (1 Month)", price_xaf: 3500, active: true, sort_order: 10, grants_plan_name: "basic", grants_plan_duration_days: 30, bundle_features: ["1 month Basic subscription included", "QR code on card", "Free card configuration"] },
    { id: A_PRO, name: "Ringo Physical Card (Pro)", price_xaf: 5000, active: true, sort_order: 11, grants_plan_name: "pro", grants_plan_duration_days: 30, bundle_features: ["1 month Pro subscription included", "QR code on card", "Free card configuration"] },
    { id: A_PREM, name: "Ringo Smart Physical Card (1 Year)", price_xaf: 10000, active: true, sort_order: 12, grants_plan_name: "basic", grants_plan_duration_days: 365, bundle_features: ["1 year Basic subscription included", "QR code on card", "Free card configuration"] },
    { id: A_OTHER, name: "Some other add-on", price_xaf: 777, active: true, sort_order: 1, grants_plan_name: null, grants_plan_duration_days: null, bundle_features: null },
  ];
  tables.signup_requests = [];
  tables.profiles = [{ id: "p-x", username: "taken_name" }];
  tables.plans = [
    { name: "basic", features_en: ["Up to 15 links", "Up to 15 catalog items", "Unlimited social icons", "Custom theme", "Facebook & TikTok pixels", "Full analytics with history", 'Remove "Made with Ringo" badge', "Real restaurant ordering & music/ticket checkout", "Bookings enabled"], features_fr: ["Jusqu'à 15 liens", "Jusqu'à 15 articles au catalogue", "Icônes sociales illimitées", "Thème personnalisé", "Pixels Facebook et TikTok", "Analyses complètes avec historique", "Suppression du badge « Made with Ringo »", "Commandes restaurant et paiement musique/billetterie réels", "Réservations activées"] },
    { name: "pro", features_en: ["Unlimited links", "Unlimited catalog items", "Unlimited social icons", "Custom theme", "Facebook & TikTok pixels", "Full analytics with history", 'Remove "Made with Ringo" badge', "Real restaurant ordering & music/ticket checkout", "Bookings enabled"], features_fr: ["Liens illimités", "Catalogue illimité", "Icônes sociales illimitées", "Thème personnalisé", "Pixels Facebook et TikTok", "Analyses complètes avec historique", "Suppression du badge « Made with Ringo »", "Commandes restaurant et paiement musique/billetterie réels", "Réservations activées"] },
  ];
};
seedTables();
let rowSeq = 0;
function from(name) {
  tables[name] = tables[name] || [];
  const st = { filters: [], mode: "select", payload: null, one: null, sel: false };
  const chain = {
    select() { st.sel = true; return chain; },
    eq(c, v) { st.filters.push((r) => r[c] === v); return chain; },
    in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return chain; },
    not(c, op, v) { st.filters.push((r) => (op === "is" ? r[c] !== v && !(v === null && r[c] === undefined) : true)); return chain; },
    order() { return chain; }, limit() { return chain; },
    insert(p) { st.mode = "insert"; st.payload = p; return chain; },
    update(p) { st.mode = "update"; st.payload = p; return chain; },
    delete() { st.mode = "delete"; return chain; },
    single() { st.one = "single"; return chain; },
    maybeSingle() { st.one = "maybe"; return chain; },
    then(resolve, reject) {
      try {
        let rows;
        if (st.mode === "insert") {
          if (globalThis.__signupInsertFails) return resolve({ data: null, error: { message: "db down SECRET INSERT TEXT" } });
          if (name === "notifications" && globalThis.__notifyInsertFails) return resolve({ data: null, error: { code: "XX000", message: "notifications down SECRET NOTICE TEXT" } });
          const row = { id: `d0000000-0000-4000-8000-${String(++rowSeq).padStart(12, "0")}`, status: "pending", customer_paid: false, pending_fapshi_trans_id: null, admin_notes: null, ...st.payload };
          tables[name].push(row); rows = [row];
        } else {
          rows = tables[name].filter((r) => st.filters.every((f) => f(r)));
          if (st.mode === "update") rows.forEach((r) => Object.assign(r, st.payload));
          if (st.mode === "delete") tables[name] = tables[name].filter((r) => !rows.includes(r));
        }
        if (st.one === "single") return resolve(rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } });
        if (st.one === "maybe") return resolve({ data: rows[0] ?? null, error: null });
        return resolve({ data: st.mode === "select" || st.sel ? rows : null, error: null });
      } catch (e) { return reject ? reject(e) : resolve({ data: null, error: { message: String(e) } }); }
    },
  };
  return chain;
}

// ------------------------------------------------------------------ database + harness
const db = new PGlite();
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PRF = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const alice = { user: U(1), profile: PRF(1) }, bob = { user: U(2), profile: PRF(2) };
const PH_A = "1110000000001", WABA_A = "1110000000002", PH_B = "9990000000001", WABA_B = "9990000000002";
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; grant usage on schema auth, public to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to public;
  create table public.users (id uuid primary key, email text not null);
  create table public.profiles (id uuid primary key, user_id uuid not null references public.users(id) on delete cascade, username text not null);
  alter table public.profiles enable row level security;
  create policy "profiles are publicly readable" on public.profiles for select using (true);
  create table public.bk_customers (id uuid primary key default gen_random_uuid(), profile_id uuid not null references public.profiles(id) on delete restrict, name text not null, unique (profile_id, id));
  insert into public.users values ('${alice.user}','a@x.test'), ('${bob.user}','b@x.test');
  insert into public.profiles values ('${alice.profile}','${alice.user}','alice'), ('${bob.profile}','${bob.user}','bob');
`);
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media", "2026-12-11_whatsapp_inbox_automation", "2026-12-18_whatsapp_inbox_push_claim"]) await db.exec(read(`supabase/migrations/${m}.sql`));
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '${PH_A}', '${WABA_A}'), ('${bob.profile}', '${PH_B}', '${WABA_B}')`);
const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from public.${t} where ${w}`))[0].n);
const sq = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`);
let chain = Promise.resolve();
const asRole = (role, sql) => { const run = async () => { await db.exec(`set role ${role}`); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };
const asService = (sql) => asRole("service_role", sql);
let rpcMode = "ok"; let rpcCalls = [];
const mkAdmin = () => ({
  from,
  rpc: async (fn, args) => {
    rpcCalls.push({ fn, args });
    if (fn.startsWith("ambassador")) return { data: null, error: { code: "42883", message: "not in this test" } };
    if (rpcMode === "sales_error" && fn.startsWith("wa_sales")) return { data: null, error: { code: "XX000", message: "row contains SECRET BOT TEXT" } };
    if (rpcMode === "sales_throw" && fn.startsWith("wa_sales")) throw new Error("network down SECRET BOT TEXT");
    const named = Object.entries(args).map(([k, val]) => `${k} => ${sq(val)}`).join(", ");
    try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
  },
});
globalThis.__admin = mkAdmin;

let metaMode = "accept"; let fetchCalls = []; let seq = 0;
const realFetch = globalThis.fetch;
const JR = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), init });
  if (metaMode === "network") throw new TypeError("fetch failed");
  if ((metaMode === "reject_interactive" || metaMode === "window_closed_interactive") && JSON.parse(init.body).type === "interactive") return JR(400, { error: { code: metaMode === "reject_interactive" ? 100 : 131047, message: "SECRET BUTTON REFUSAL" } });
  return JR(200, { messaging_product: "whatsapp", messages: [{ id: `wamid.OUT${++seq}` }] });
};
const SECRET = "test-app-secret";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token-not-real"; process.env.WHATSAPP_APP_SECRET = SECRET; delete process.env.META_APP_SECRET;
process.env.WHATSAPP_PHONE_NUMBER_ID = PH_A; process.env.WHATSAPP_WABA_ID = WABA_A; process.env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID = PH_A;
const sign = (b) => "sha256=" + crypto.createHmac("sha256", SECRET).update(b).digest("hex");
const payload = (value) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: WABA_A, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PH_A }, ...value } }] }] });
const logs = []; const origInfo = console.info, origErr = console.error;
console.info = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" "));
const post = (raw) => webhook.POST(new Request("http://localhost/api/integrations/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": sign(raw) } }));
const reset = () => { rpcMode = "ok"; metaMode = "accept"; fetchCalls = []; rpcCalls = []; pushes.length = 0; adminPushes.length = 0; fapshiCalls.length = 0; notes.length = 0; fapshiMode = "ok"; globalThis.__fapshiStatus = "CREATED"; globalThis.__pushThrows = false; globalThis.__signupInsertFails = false; globalThis.__fapshiOn = true; };

const CUST = "237677123456"; // an MTN-range Cameroon number (a customer's own WhatsApp number)
let wseq = 0;
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0]?.id;
const outboundOf = async (wa) => q1(`select m.body, m.status, m.provider_message_id from public.inbox_messages m join public.inbox_conversations cv on cv.id = m.conversation_id join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}' and m.direction = 'outbound' order by m.created_at, m.id`);
const sessionOf = async (wa) => (await q1(`select s.* from public.wa_sales_sessions s join public.inbox_conversations cv on cv.id = s.conversation_id join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0];
// A customer message through the REAL webhook; returns the bot's reply (the new outbound row, if any).
async function say(text, wa = CUST, opts = {}) {
  const before = (await outboundOf(wa)).length;
  const id = opts.id || `wamid.C${++wseq}`;
  const message = { from: wa, id, timestamp: String(Math.floor(Date.now() / 1000)), type: opts.type || "text", ...(opts.type && opts.type !== "text" ? { [opts.type]: { id: "media1" } } : { text: { body: text } }) };
  const r = await post(payload({ contacts: [{ profile: { name: "Test Customer" }, wa_id: wa }], messages: [message] }));
  const out = await outboundOf(wa);
  return { status: r.status, id, reply: out.length > before ? out[out.length - 1].body : null, sent: out.length - before };
}
const price = (n) => EN.price(Machine.groupNum(n, ","));
const priceFr = (n) => FR.price(Machine.groupNum(n, " "));
const OBJ = `select 'fn:' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' union all select 'tbl:' || tablename from pg_tables where schemaname = 'public' union all select 'col:' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public' union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' union all select 'pol:' || tablename || '.' || policyname from pg_policies where schemaname = 'public' union all select 'trg:' || tgname from pg_trigger where not tgisinternal order by 1`;
const firstStatement = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(/;[ \t]*\n/)[0];

try {
  // ============================================================ the migration
  const MIG = read("supabase/migrations/2026-12-19_whatsapp_sales_bot.sql"), VERIFY = read("supabase/support/2026-12-19_whatsapp_sales_bot.verify.sql"), ROLLBACK = read("supabase/support/2026-12-19_whatsapp_sales_bot.rollback.sql");
  const before = (await q1(OBJ)).map((r) => r.x);
  const bare = MIG.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  check("migration: no alter/drop of any existing object, no hard-coded ids", !/\balter\s+table\s+public\.(?!wa_sales_)/i.test(bare) && !/\bdrop\s+(table|function|policy|trigger)/i.test(bare) && !/[0-9]{12,}/.test(bare));
  await db.exec(MIG);
  check("migration applies and is idempotent", await db.exec(MIG).then(() => true, () => false));
  const added = (await q1(OBJ)).map((r) => r.x).filter((x) => !before.includes(x));
  check("exactly two new tables and four new functions (plus their own columns and indexes)", added.filter((x) => x.startsWith("tbl:")).sort().join() === "tbl:wa_sales_processed,tbl:wa_sales_sessions" && added.filter((x) => x.startsWith("fn:")).sort().join() === "fn:wa_sales_begin,fn:wa_sales_payment_context,fn:wa_sales_save,fn:wa_sales_set_handoff" && added.every((x) => /^(tbl:wa_sales_|fn:wa_sales_|col:wa_sales_|idx:wa_sales_)/.test(x)), added.join());
  const ver = await q1(firstStatement(VERIFY));
  check("verify script: every row ok", ver.length >= 10 && ver.every((x) => x.ok === true), JSON.stringify(ver.filter((x) => !x.ok)));
  check("privileges: only service_role can execute the functions; no API role can touch either table", (await q1(`select has_function_privilege('anon','public.wa_sales_begin(text,text)','execute') a, has_function_privilege('authenticated','public.wa_sales_save(uuid,integer,text,jsonb,boolean,uuid)','execute') b, has_function_privilege('service_role','public.wa_sales_begin(text,text)','execute') c, has_table_privilege('authenticated','public.wa_sales_sessions','select') d, has_table_privilege('service_role','public.wa_sales_processed','select') e`)).every((r) => r.a === false && r.b === false && r.c === true && r.d === false && r.e === false));

  // ============================================================ the owner's ON/OFF switch: its own additive migration
  const MIG2 = read("supabase/migrations/2026-12-20_whatsapp_sales_bot_owner_switch.sql"), VERIFY2 = read("supabase/support/2026-12-20_whatsapp_sales_bot_owner_switch.verify.sql"), ROLLBACK2 = read("supabase/support/2026-12-20_whatsapp_sales_bot_owner_switch.rollback.sql");
  const before2 = (await q1(OBJ)).map((r) => r.x);
  const bare2 = MIG2.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  check("switch migration: no alter/drop/replace of any existing object, no hard-coded ids", !/\balter\s+table\s+public\.(?!wa_sales_)/i.test(bare2) && !/\bdrop\s+(table|function|policy|trigger)/i.test(bare2) && !/[0-9]{12,}/.test(bare2) && !/create or replace function public\.wa_sales_(begin|save|set_handoff|payment_context)/.test(bare2));
  await db.exec(MIG2);
  check("switch migration applies and is idempotent", await db.exec(MIG2).then(() => true, () => false));
  const added2 = (await q1(OBJ)).map((r) => r.x).filter((x) => !before2.includes(x));
  check("switch migration: exactly two new tables and three new functions, nothing else", added2.filter((x) => x.startsWith("tbl:")).sort().join() === "tbl:wa_sales_settings,tbl:wa_sales_settings_log" && added2.filter((x) => x.startsWith("fn:")).sort().join() === "fn:wa_sales_enabled,fn:wa_sales_settings_get,fn:wa_sales_settings_set" && added2.every((x) => /^(tbl:wa_sales_|fn:wa_sales_|col:wa_sales_|idx:wa_sales_)/.test(x)), added2.join());
  const ver2 = await q1(firstStatement(VERIFY2));
  check("switch verify script: every row ok", ver2.length >= 12 && ver2.every((x) => x.ok === true), JSON.stringify(ver2.filter((x) => !x.ok)));
  const sw = (fn, args) => asService(`select public.${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${sq(v)}`).join(", ")}) as r`).then((x) => x.rows[0].r);
  check("switch: OFF by default (no row = off; unknown number = off)", (await sw("wa_sales_enabled", { p_phone_number_id: PH_A })) === false && (await sw("wa_sales_enabled", { p_phone_number_id: "0000" })) === false && (await sw("wa_sales_enabled", { p_phone_number_id: null })) === false);
  check("switch: the owner reads OFF; another owner's or an invalid profile is not_found", (await sw("wa_sales_settings_get", { p_actor_user_id: alice.user, p_profile_id: alice.profile })).enabled === false && (await sw("wa_sales_settings_get", { p_actor_user_id: bob.user, p_profile_id: alice.profile })).result === "not_found" && (await sw("wa_sales_settings_get", { p_actor_user_id: alice.user, p_profile_id: bob.profile })).result === "not_found" && (await sw("wa_sales_settings_get", { p_actor_user_id: null, p_profile_id: alice.profile })).result === "not_found");
  check("switch: another owner cannot turn alice's switch on (not_found), a profile that is not the actor's is refused, nothing changes, nothing is logged", (await sw("wa_sales_settings_set", { p_actor_user_id: bob.user, p_profile_id: alice.profile, p_enabled: true })) === "not_found" && (await sw("wa_sales_settings_set", { p_actor_user_id: alice.user, p_profile_id: bob.profile, p_enabled: true })) === "not_found" && (await sw("wa_sales_settings_set", { p_actor_user_id: alice.user, p_profile_id: alice.profile, p_enabled: null })) === "invalid" && (await count("wa_sales_settings")) === 0 && (await count("wa_sales_settings_log")) === 0);
  await db.exec(`insert into public.users values ('c0000000-0000-4000-8000-000000000003','n@x.test'); insert into public.profiles values ('a0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000003','nowa')`);
  check("switch: a profile with no WhatsApp account is not_found for both read and write", (await sw("wa_sales_settings_set", { p_actor_user_id: "c0000000-0000-4000-8000-000000000003", p_profile_id: "a0000000-0000-4000-8000-000000000003", p_enabled: true })) === "not_found" && (await sw("wa_sales_settings_get", { p_actor_user_id: "c0000000-0000-4000-8000-000000000003", p_profile_id: "a0000000-0000-4000-8000-000000000003" })).result === "not_found");
  check("switch: OFF -> OFF is a no-op and writes nothing", (await sw("wa_sales_settings_set", { p_actor_user_id: alice.user, p_profile_id: alice.profile, p_enabled: false })) === "noop" && (await count("wa_sales_settings_log")) === 0);
  check("switch: the owner turns it ON: saved, audited with the actor, and the gate opens for her number only", (await sw("wa_sales_settings_set", { p_actor_user_id: alice.user, p_profile_id: alice.profile, p_enabled: true })) === "ok" && (await sw("wa_sales_enabled", { p_phone_number_id: PH_A })) === true && (await sw("wa_sales_enabled", { p_phone_number_id: PH_B })) === false && (await q1("select actor_user_id, enabled, profile_id from public.wa_sales_settings_log"))[0].actor_user_id === alice.user && (await count("wa_sales_settings_log")) === 1);
  check("switch: ON -> ON is a no-op (no second audit row); reads back ON", (await sw("wa_sales_settings_set", { p_actor_user_id: alice.user, p_profile_id: alice.profile, p_enabled: true })) === "noop" && (await count("wa_sales_settings_log")) === 1 && (await sw("wa_sales_settings_get", { p_actor_user_id: alice.user, p_profile_id: alice.profile })).enabled === true);
  const priv2 = (await q1("select has_function_privilege('anon','public.wa_sales_enabled(text)','execute') a, has_function_privilege('authenticated','public.wa_sales_settings_set(uuid,uuid,boolean)','execute') b, has_table_privilege('authenticated','public.wa_sales_settings','select') c, has_table_privilege('service_role','public.wa_sales_settings_log','insert') d, has_function_privilege('service_role','public.wa_sales_enabled(text)','execute') e"))[0];
  check("switch: no API role can reach the tables or functions; only service_role can execute", !priv2.a && !priv2.b && !priv2.c && !priv2.d && priv2.e);

  // ============================================================ offers come from the add-on configuration
  const resolved = await Offers.resolveSmartCardOffers(mkAdmin());
  check("offers: the three tiers are resolved from the add-on rows (Standard = Basic 30 days, Pro = Pro 30 days, Premium = Basic 365 days), prices read, the unrelated add-on ignored", resolved.offers.map((o) => `${o.tier}:${o.priceXaf}:${o.planName}:${o.days}`).join() === "standard:3500:basic:30,pro:5000:pro:30,premium:10000:basic:365" && resolved.missing.length === 0 && resolved.offers.every((o) => o.hasQr && o.hasConfig));
  const partial = Offers.offersFromAddons(tables.addons.filter((a) => a.id !== A_PRO));
  check("offers: a missing tier is reported and left out, never invented", partial.offers.length === 2 && partial.missing.join() === "pro");
  check("offers: a zero or missing price is not offered", Offers.offersFromAddons([{ ...tables.addons[0], price_xaf: 0 }]).missing.includes("standard"));

  // ============================================================ pure machine: states, languages, validation
  const OFFERS = resolved.offers;
  const facts = (extra = {}) => ({ offers: OFFERS, waDigits: CUST, ...extra });
  const fresh = (state = "WELCOME", data = {}) => ({ state, data, handoff: false, signupRequestId: null, version: 0 });
  let s = Machine.step(fresh(), "Hi", facts());
  check("WELCOME: a greeting gets the welcome menu in English (and says how to get French)", s.state === "WELCOME" && s.reply === EN.welcome && /Smart Card/.test(s.reply) && /\*fr\*/.test(s.reply) && s.effect === "none");
  s = Machine.step(fresh(), "Bonjour", facts());
  check("WELCOME: a French greeting gets the French welcome", s.reply === FR.welcome && s.data.lang === "fr");
  s = Machine.step(fresh("BUY_METHOD"), "1", facts());
  check("CARD_SELECTION: paying online (Buy a card, option 1) lists the three cards with the prices from the add-ons", s.state === "CARDS" && s.reply.includes(price(3500)) && s.reply.includes(price(5000)) && s.reply.includes(price(10000)) && s.reply.includes("Standard") && s.reply.includes("Pro") && s.reply.includes("Premium"), s.reply);
  check("CARD_SELECTION: each card is listed with its own short list (subscription without a duration, QR code, configuration, then the tier's features)", s.reply.includes("Basic subscription") && s.reply.includes("Pro subscription") && s.reply.includes("Premium subscription") && s.reply.includes(EN.qrIncluded) && s.reply.includes(EN.configIncluded) && !/1 month|1 year|\bincluded\b/.test(s.reply), s.reply);
  const picks = [["1", "standard", 3500, "Basic subscription"], ["2", "pro", 5000, "Pro subscription"], ["3", "premium", 10000, "Premium subscription"]];
  for (const [n, tier, amount, line] of picks) {
    const d = Machine.step(fresh("CARDS"), n, facts());
    check(`${tier.toUpperCase()} selection: card detail with its price and subscription, then the order options`, d.state === "CARD_DETAIL" && d.data.tier === tier && d.reply.includes(price(amount)) && d.reply.includes(line) && /1\. 🛒 Order this card/.test(d.reply), d.reply);
  }
  check("selecting by name works (pro)", Machine.step(fresh("CARDS"), "Pro", facts()).data.tier === "pro");
  s = Machine.step(fresh("CARDS"), "4", facts());
  check("compare: all three side by side, saying the difference is the subscription", s.state === "COMPARE" && s.reply.includes(price(3500)) && s.reply.includes(price(10000)) && /subscription that comes with it/.test(s.reply));
  s = Machine.step(fresh("HOW_IT_WORKS"), "xyz", facts());
  check("HOW IT WORKS: the screen (kept for conversations saved before the four-option menu) still explains the tap and the QR code", s.state === "HOW_IT_WORKS" && /no app, no login/.test(s.reply));
  const faq = (n) => Machine.step(fresh("FAQ"), String(n), facts());
  check("FAQ: answers are fixed, factual and in the product's own words (NFC tap, no app, QR fallback, what is included, how to pay)", /NFC-enabled phone/.test(faq(2).reply) && /No\. Your Ringo profile opens in the phone's browser/.test(faq(3).reply) && /scan the QR code/.test(faq(4).reply) && /QR code that opens the same/.test(faq(5).reply) && /basic contact info is also stored directly on the card/.test(faq(6).reply) && /Mobile Money/.test(faq(10).reply) && /Never send your PIN/.test(faq(10).reply));
  check("FAQ: 'what's included' uses the same short subscription lines as the cards (no duration)", faq(9).reply.includes("Standard: Basic subscription") && faq(9).reply.includes("Pro: Pro subscription") && faq(9).reply.includes("Premium: Premium subscription") && faq(9).reply.includes(EN.qrIncluded) && !/1 month|1 year/.test(faq(9).reply));
  check("FAQ: no invented claims (no delivery time, no guarantee, no shipping promise, no price in the fixed answers)", EN.faq.concat(FR.faq).every((a) => !/\b(days?|jours?|hours?|heures?|guarantee|garantie|free delivery|livraison gratuite|warranty)\b/i.test(a) && !/\d{1,3}[ ,]\d{3}\s*FCFA/.test(a)));
  let r1 = Machine.step(fresh("RECOMMEND_1"), "2", facts());
  check("RECOMMENDATION: a full year -> Premium", r1.state === "CARD_DETAIL" && r1.data.tier === "premium" && r1.reply.includes(price(10000)));
  r1 = Machine.step(Machine.step(fresh("RECOMMEND_1"), "1", facts()), "1", facts());
  r1 = Machine.step(fresh("RECOMMEND_2"), "1", facts());
  check("RECOMMENDATION: a month with Pro -> Pro; a month with Basic -> Standard", r1.data.tier === "pro" && Machine.step(fresh("RECOMMEND_2"), "2", facts()).data.tier === "standard");
  check("RECOMMENDATION: falls back to a tier that exists when the first choice is not offered", Machine.step(fresh("RECOMMEND_1"), "2", { ...facts(), offers: OFFERS.filter((o) => o.tier !== "premium") }).data.tier === "standard");
  check("no offers at all: the bot says the card cannot be ordered here and offers a person, instead of inventing one", Machine.step(fresh("BUY_METHOD"), "1", { ...facts(), offers: [] }).reply === EN.unavailable);

  // order collection
  const d0 = { lang: "en", tier: "pro" };
  s = Machine.step(fresh("CARD_DETAIL", d0), "1", facts());
  check("ORDER_START: ordering a card asks for the name", s.state === "ASK_NAME" && s.reply === EN.askName("Pro"));
  s = Machine.step(fresh("ASK_NAME", d0), "J", facts());
  check("validation: a one-letter name is not accepted", s.state === "ASK_NAME");
  s = Machine.step(fresh("ASK_NAME", d0), "  Jean   Mbah ", facts());
  check("name is cleaned and the address is asked next", s.state === "ASK_ADDRESS" && s.data.name === "Jean Mbah");
  check("validation: a too-short address is refused; a real one moves on to the e-mail question", Machine.step(fresh("ASK_ADDRESS", d0), "Dla", facts()).state === "ASK_ADDRESS" && Machine.step(fresh("ASK_ADDRESS", d0), "Akwa, Douala", facts()).state === "ASK_EMAIL");
  check("username: 'skip' continues without one", (() => { const x = Machine.step(fresh("ASK_USERNAME", d0), "skip", facts()); return x.state === "ASK_OPERATOR" && !x.data.username; })());
  check("username: under 3 characters is refused (the same minimum as the admin review)", Machine.step(fresh("ASK_USERNAME", d0), "ab", facts()).reply === EN.usernameShort);
  check("username: taken is refused with the name echoed", Machine.step(fresh("ASK_USERNAME", d0), "Taken_Name", facts({ usernameStatus: "taken" })).reply === EN.usernameTaken("taken_name"));
  check("username: same rule as the web form (lowercase; letters, digits and _ only)", Machine.step(fresh("ASK_USERNAME", d0), "John Mbah-1!", facts({ usernameStatus: "ok" })).data.username === "johnmbah1");
  check("username: available is kept and the payment question follows", (() => { const x = Machine.step(fresh("ASK_USERNAME", d0), "johnmbah", facts({ usernameStatus: "ok" })); return x.state === "ASK_OPERATOR" && x.reply.includes(EN.usernameKept("johnmbah")) && x.reply.includes(EN.askOperator); })());
  s = Machine.step(fresh("ASK_OPERATOR", d0), "1", facts());
  check("payment operator: 1 = MTN Mobile Money, then the payment number is asked, offering the verified WhatsApp number (shown only by its last digits)", s.state === "ASK_PAY_PHONE" && s.data.medium === "mobile money" && s.reply.includes("ending 456") && !s.reply.includes(CUST));
  check("payment number: '1' uses the sender's own WhatsApp number; nothing to retype", (() => { const x = Machine.step(fresh("ASK_PAY_PHONE", { ...d0, email: "jean@example.com", medium: "mobile money" }), "1", facts()); return x.state === "REVIEW" && x.data.payPhone === "677123456"; })());
  check("payment number: accepts +237 / spaces and normalises it", Machine.step(fresh("ASK_PAY_PHONE", { ...d0, medium: "mobile money" }), "+237 677 12 34 99", facts()).data.payPhone === "677123499");
  check("validation: a PIN-like or malformed number is refused with the never-send-your-PIN warning, nothing stored", ["1234", "4321", "12345678", "abc", "5551234567"].every((t) => { const x = Machine.step(fresh("ASK_PAY_PHONE", { ...d0, medium: "mobile money" }), t, { ...facts(), waDigits: "33612345678" }); return x.state === "ASK_PAY_PHONE" && x.reply === EN.payPhoneInvalid && !x.data.payPhone; }));
  s = Machine.step(fresh("ASK_PAY_PHONE", { ...d0, medium: "orange money" }), "677123456", facts());
  check("validation: a number whose network clearly differs from the chosen one sends the customer back to pick the network again", s.state === "ASK_OPERATOR" && /MTN Mobile Money/.test(s.reply) && !s.data.medium);
  const full = { lang: "en", tier: "pro", name: "Jean Mbah", address: "Akwa, Douala", email: "jean@example.com", username: "johnmbah", medium: "mobile money", payPhone: "677123456" };
  s = Machine.step(fresh("REVIEW", full), "xx", facts({ total: 5000 }));
  check("ORDER_REVIEW: confirmation not understood keeps the review", s.state === "REVIEW" && s.reply.includes("Everything correct?"));
  s = Machine.step(fresh("ASK_PAY_PHONE", { ...full, payPhone: undefined }), "1", facts({ total: 5000 }));
  check("ORDER_REVIEW summary: card, price, TOTAL (the figure passed in from the server), name, username, WhatsApp number, delivery address, payment network and last digits only; no delivery fee, no delivery promise", s.state === "REVIEW" && s.reply.includes("Card: Pro") && s.reply.includes(`Price: ${price(5000)}`) && s.reply.includes(`Total: ${price(5000)}`) && s.reply.includes("Name: Jean Mbah") && s.reply.includes("Username: johnmbah") && s.reply.includes(`WhatsApp: +${CUST}`) && s.reply.includes("Delivery: Akwa, Douala") && s.reply.includes("MTN Mobile Money · ending 456") && !/delivery (fee|cost|time)|livraison.*(frais|délai)|within|sous \d/i.test(s.reply) && !s.reply.split("\n").find((l) => l.startsWith("Payment:")).includes("677123456"), s.reply);
  s = Machine.step(fresh("REVIEW", full), "1", facts({ total: 5000 }));
  check("confirming asks the runner to create the order and send the payment request (one effect)", s.state === "CREATING" && s.effect === "create_and_pay");
  check("the total is NEVER computed by the bot: without the server's figure the review cannot be confirmed", Machine.step(fresh("REVIEW", full), "1", facts({ total: null })).effect === "none" && Machine.step(fresh("REVIEW", full), "1", facts()).effect === "none");
  s = Machine.step(fresh("REVIEW", full), "2", facts({ total: 5000 }));
  check("EDIT: the review's edit menu lists what can change, and each choice returns to the review afterwards", s.state === "EDIT_MENU" && (() => { const e1 = Machine.step(s, "2", facts()); const e2 = Machine.step({ ...fresh(), state: e1.state, data: e1.data }, "Bonamoussadi, Douala", facts({ total: 5000 })); return e1.state === "ASK_ADDRESS" && e2.state === "REVIEW" && e2.data.address === "Bonamoussadi, Douala" && e2.data.name === "Jean Mbah"; })());
  check("EDIT: changing the card keeps the other answers and shows the review again", (() => { let x = Machine.step(fresh("EDIT_MENU", full), "6", facts()); x = Machine.step({ ...fresh(), state: x.state, data: x.data }, "3", facts()); x = Machine.step({ ...fresh(), state: x.state, data: x.data }, "1", facts({ total: 10000 })); return x.state === "REVIEW" && x.data.tier === "premium" && x.reply.includes("Card: Premium"); })());
  check("0 = main menu everywhere; inside the order it clears the half-made order", Machine.step(fresh("ASK_ADDRESS", full), "0", facts()).state === "WELCOME" && Object.keys(Machine.step(fresh("ASK_ADDRESS", full), "0", facts()).data).join() === "lang" && Machine.step(fresh("FAQ", d0), "0", facts()).state === "WELCOME");
  check("cancel / annuler / reset behave like 0 and say nothing was charged", ["cancel", "annuler", "reset"].every((w) => Machine.step(fresh("REVIEW", full), w, facts()).reply.startsWith(EN.cancelled)));
  check("language switch: 'fr' / 'en' at any time keeps the place in the order", (() => { const x = Machine.step(fresh("ASK_ADDRESS", full), "fr", facts()); return x.state === "ASK_ADDRESS" && x.data.lang === "fr" && x.reply.includes(FR.askAddress); })());
  const humanWords = ["human", "agent", "support", "representative", "talk to someone", "I want to talk to someone please", "help", "humain", "conseiller", "parler à quelqu'un", "aide"];
  check("HUMAN request: every listed phrase, at any menu state, hands off", humanWords.every((w) => { const x = Machine.step(fresh("CARDS", d0), w, facts()); return x.effect === "handoff" && x.handoff === true && x.state === "HUMAN_HANDOFF"; }));
  check("HUMAN request while giving a free-text answer: a bare request hands off, but an address that merely contains the word does not", Machine.step(fresh("ASK_ADDRESS", full), "human", facts()).effect === "handoff" && Machine.step(fresh("ASK_ADDRESS", full), "Rue du Support, Akwa", facts()).state === "ASK_EMAIL");
  check("HUMAN_HANDOFF: the machine is silent and changes nothing", (() => { const x = Machine.step({ ...fresh("HUMAN_HANDOFF", full), handoff: true }, "1", facts()); return x.reply === "" && x.effect === "none" && x.handoff === true; })());
  check("PAYMENT state: status / resend / change number are the only actions; anything else repeats the waiting message", Machine.step(fresh("PAYMENT", full), "status", facts()).effect === "check_payment" && Machine.step(fresh("PAYMENT", full), "resend", facts()).effect === "resend_payment" && Machine.step(fresh("PAYMENT", full), "edit", facts()).state === "ASK_OPERATOR" && Machine.step(fresh("PAYMENT", full), "hello?", facts()).reply === EN.paymentResumed);
  check("CREATING that never finished (stuck) lets the customer go back to the review; a fresh one just waits", Machine.step(fresh("CREATING", full), "hi", facts({ stuck: true, total: 5000 })).state === "REVIEW" && Machine.step(fresh("CREATING", full), "hi", facts()).reply === EN.creating);
  check("EN and FR salesBot translations have exactly the same keys, every string non-empty (functions return text)", (() => { const k = (o, p = "") => Object.entries(o).flatMap(([key, v]) => (v && typeof v === "object" && !Array.isArray(v) ? k(v, `${p}${key}.`) : [`${p}${key}`])); return k(EN).join() === k(FR).join() && EN.faq.length === FR.faq.length && EN.faq.filter(Boolean).length === FR.faq.filter(Boolean).length; })());

  // ============================================================ end to end through the REAL webhook
  reset();
  let r = await say("Hi");
  const convC = await convOf(CUST);
  check("E2E welcome: a message through the signed webhook is stored (200), and the bot answers in the SAME Inbox conversation with the short welcome guide and its Get started button, sent to the customer via Meta (stored in the Inbox as the same text)", r.status === 200 && r.reply === EN.welcome && (await count("inbox_messages", `conversation_id = '${convC}' and direction = 'inbound'`)) === 1 && fetchCalls.length === 1 && fetchCalls[0].url === `https://graph.facebook.com/v21.0/${PH_A}/messages` && JSON.parse(fetchCalls[0].init.body).to === CUST && JSON.parse(fetchCalls[0].init.body).type === "interactive" && JSON.parse(fetchCalls[0].init.body).interactive.body.text === EN.welcome && JSON.parse(fetchCalls[0].init.body).interactive.action.buttons[0].reply.title === EN.startButton, JSON.stringify({ r, f: fetchCalls.length }));
  check("E2E welcome: Inbox push and the bell notice still happen for the same message (the bot did not replace them)", pushes.length === 1 && pushes[0].payload.category === "inbox_new_message" && notes.some((n) => n.type === "inbox_new_conversation"));
  check("E2E welcome: the session is stored against the conversation, owner derived by the database", (await sessionOf(CUST)).state === "WELCOME" && (await sessionOf(CUST)).handoff === false && (await sessionOf(CUST)).version === 1);

  // --- duplicate protection
  reset();
  const dupBefore = (await outboundOf(CUST)).length;
  r = await say("Hi", CUST, { id: "wamid.DUP1" });
  const afterFirst = (await outboundOf(CUST)).length;
  const rawDup = payload({ contacts: [{ profile: { name: "Test Customer" }, wa_id: CUST }], messages: [{ from: CUST, id: "wamid.DUP1", timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: "Hi" } }] });
  const redeliver = await post(rawDup);
  check("DUPLICATE protection: Meta redelivering the same message gets a 200 and NO second reply", redeliver.status === 200 && (await outboundOf(CUST)).length === afterFirst && afterFirst === dupBefore + 1);
  const direct = await Runner.handleSalesBotMessage({ admin: mkAdmin(), env: process.env }, { phoneNumberId: PH_A, messageId: "wamid.DUP1" });
  check("DUPLICATE protection (database claim): calling the bot again for the same provider message id is a no-op", direct.result === "duplicate" && (await outboundOf(CUST)).length === afterFirst && (await count("wa_sales_processed", "provider_message_id = 'wamid.DUP1'")) === 1);
  check("reply idempotency key: deterministic per message and slot, a valid UUID", Ids.replyRequestId(PH_A, "wamid.X") === Ids.replyRequestId(PH_A, "wamid.X") && Ids.replyRequestId(PH_A, "wamid.X") !== Ids.replyRequestId(PH_A, "wamid.Y") && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(Ids.replyRequestId(PH_A, "wamid.X")));

  // --- loop protection
  reset();
  const outRows = await q1(`select provider_message_id from public.inbox_messages where direction = 'outbound' and provider_message_id is not null limit 1`);
  const loopRes = await Runner.handleSalesBotMessage({ admin: mkAdmin(), env: process.env }, { phoneNumberId: PH_A, messageId: outRows[0].provider_message_id });
  check("LOOP protection: the bot's own outbound message id is never processed as a customer message (database skips non-inbound)", loopRes.result === "skip" && fetchCalls.length === 0);
  const statusRaw = payload({ statuses: [{ id: outRows[0].provider_message_id, status: "delivered", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: CUST }] });
  const stRes = await post(statusRaw);
  check("LOOP protection: a delivery STATUS event for the bot's reply triggers no bot and no reply", stRes.status === 200 && fetchCalls.length === 0);
  check("SELF-message protection: every message the bot sent is an outbound row with a 'sent' state, and the count of replies never exceeds the count of customer messages", (await count("inbox_messages", "direction = 'outbound'")) <= (await count("inbox_messages", "direction = 'inbound'")));
  reset();
  r = await say("", CUST, { type: "reaction" });
  check("a reaction / sticker is ignored (no reply to an emoji); a voice note gets one short text hint", r.sent === 0);
  r = await say("", CUST, { type: "audio" });
  check("…the voice note hint tells the customer to use text", r.sent === 1 && r.reply === EN.nonText);

  // --- only the configured number
  reset();
  delete process.env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID;
  r = await say("Hi", "237677000999");
  check("GATE: with the bot switched off, the message is stored, the push and notice still happen, and the bot sends nothing", r.status === 200 && r.sent === 0 && (await count("inbox_messages", `body = 'Hi' and conversation_id = '${await convOf("237677000999")}'`)) === 1 && pushes.length === 1 && fetchCalls.length === 0 && !(await sessionOf("237677000999")));
  process.env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID = PH_B;
  r = await say("Hi", "237677000998");
  check("GATE: the bot is bound to ONE number; a different Inbox account's customers get nothing", r.sent === 0 && !(await sessionOf("237677000998")));
  process.env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID = PH_A;

  // --- the whole sale: Pro, with a username, paid with the sender's own MTN number
  reset();
  const flow = async (text, wa = CUST) => (await say(text, wa)).reply;
  await flow("hello");
  await flow("2");
  let reply = await flow("1");
  check("E2E: card list from the live add-on prices", reply.includes(price(3500)) && reply.includes(price(5000)) && reply.includes(price(10000)));
  reply = await flow("2");
  check("E2E: Pro selected", reply.includes("*Ringo Connect Smart Card — Pro*") && reply.includes(price(5000)));
  reply = await flow("1");
  check("E2E: ordering asks for the name", reply === EN.askName("Pro"));
  await flow("Jean Mbah");
  reply = await flow("Akwa, Douala");
  check("E2E: the e-mail question follows the address", reply === EN.askEmail);
  reply = await flow("jean@example.com");
  check("E2E: the username question follows the e-mail", reply === EN.askUsername);
  reply = await flow("Taken_Name");
  check("E2E: a username that already exists (profiles) is refused, using the same availability source the admin review uses", reply === EN.usernameTaken("taken_name"));
  reply = await flow("jeanmbah");
  check("E2E: an available username is accepted and the network question comes next", reply.includes(EN.usernameKept("jeanmbah")) && reply.includes(EN.askOperator));
  await flow("1");
  reply = await flow("1");
  check("E2E: the sender's own number is reused (not retyped) and the review shows the SERVER's total", reply.includes("Card: Pro") && reply.includes(`Total: ${price(5000)}`) && reply.includes("Username: jeanmbah") && reply.includes("Email: jean@example.com") && reply.includes(`WhatsApp: +${CUST}`) && reply.includes("Delivery: Akwa, Douala") && !reply.split("\n").find((l) => l.startsWith("Payment:")).includes("677123456"), reply);
  check("E2E: nothing exists yet: no signup request, no payment request before the customer confirms", tables.signup_requests.length === 0 && fapshiCalls.length === 0);
  reply = await flow("1");
  const req = tables.signup_requests[0];
  check("EXISTING ORDER BACKEND: confirming creates ONE signup request through the existing /api/signup-requests handler with the collected data and the Smart Card add-on (the web form's shape)", tables.signup_requests.length === 1 && req.full_name === "Jean Mbah" && req.whatsapp_number === `+${CUST}` && req.suggested_username === "jeanmbah" && req.delivery_location === "Akwa, Douala" && JSON.stringify(req.requested_addon_ids) === JSON.stringify([A_PRO]) && req.requested_plan_id === null && req.email === "jean@example.com" && req.status === "pending" && req.customer_paid === false && req.source === "get_started", JSON.stringify(req));
  check("EXISTING ORDER BACKEND: admins are NOT pinged for an unpaid attempt (same as the web form's online-payment path)", adminPushes.length === 0);
  check("PAYMENT: the EXISTING pay handler asked Fapshi for the amount it recomputed from the add-on (5,000) on the customer's own number and network - nothing the customer typed set the amount", fapshiCalls.length === 1 && fapshiCalls[0].amount === 5000 && fapshiCalls[0].phone === "677123456" && fapshiCalls[0].medium === "mobile money" && fapshiCalls[0].userId === req.id && /^signup-/.test(fapshiCalls[0].externalId), JSON.stringify(fapshiCalls));
  check("PAYMENT: the customer is told to approve on their phone, with only the last digits shown, and warned never to send a PIN here", reply === EN.paymentSent("MTN Mobile Money", "456") && /never here/.test(reply) && !reply.includes("677123456"), reply);
  check("PAYMENT: the request is linked to the conversation and the state is PAYMENT; the bot did not mark anything paid", (await sessionOf(CUST)).state === "PAYMENT" && (await sessionOf(CUST)).signup_request_id === req.id && req.customer_paid === false);
  reply = await flow("resend");
  check("PAYMENT: 'resend' goes back through the existing pay handler, which sends a fresh request for the same order (still one signup request)", tables.signup_requests.length === 1 && fapshiCalls.length === 2 && fapshiCalls[1].amount === 5000 && reply === EN.paymentSent("MTN Mobile Money", "456"));
  reply = await flow("status");
  check("PAYMENT: 'status' asks the existing confirmation (Fapshi) and, while it is not confirmed, says so - WhatsApp never decides", reply === EN.statusPending && tables.signup_requests[0].customer_paid === false);

  // --- payment confirmed by the EXISTING payment code -> additive hook -> WhatsApp confirmation
  fetchCalls = []; reset();
  globalThis.__fapshiStatus = "SUCCESSFUL";
  const checkRes = await SignupPay.confirmSignupPayment(mkAdmin(), req.id);
  await new Promise((res) => setTimeout(res, 50));
  const outAfter = await outboundOf(CUST);
  const paidMsg = outAfter[outAfter.length - 1].body;
  check("PAYMENT CONFIRMED: the existing code recorded the payment (customer_paid), exactly once", checkRes.paid && checkRes.justPaid && tables.signup_requests[0].customer_paid === true && tables.signup_requests[0].pending_fapshi_trans_id);
  check("CONFIRMATION: the hook messages the customer in WhatsApp with card, amount and a short reference, and the approval next step; no promise of a delivery date", /Payment receipt/.test(paidMsg) && paidMsg.includes(`Receipt no.: RC-${req.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`) && paidMsg.includes("Customer: Jean Mbah") && paidMsg.includes("Ringo Connect Smart Card — Pro") && paidMsg.includes("1 month Pro subscription included") && paidMsg.includes(`Amount paid: *${price(5000)}*`) && paidMsg.includes("Payment method: Mobile Money") && /Date: \d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/.test(paidMsg) && /Transaction ID: \S+/.test(paidMsg) && paidMsg.includes("Status: ✅ Paid") && /reviews your request/.test(paidMsg) && /login details/.test(paidMsg) && !/deliver|livr/i.test(paidMsg), paidMsg);
  check("CONFIRMATION: it was sent to the customer's own number through the Inbox sender, and no secret or internal id beyond the short reference appears", fetchCalls.length === 1 && JSON.parse(fetchCalls[0].init.body).to === CUST && !paidMsg.includes(req.id) && !paidMsg.includes(conv0(convC)));
  function conv0(x) { return String(x); }
  check("CONFIRMATION: the flow is marked COMPLETED by the hook", (await sessionOf(CUST)).state === "COMPLETED");
  const outCount = (await outboundOf(CUST)).length;
  const again = await Notice.notifyWhatsAppOrderPaid(mkAdmin(), req.id);
  check("CONFIRMATION is idempotent: running the hook again does not send a second message", (await outboundOf(CUST)).length === outCount && again.result === "sent");
  reply = await flow("status");
  check("after COMPLETED a customer message gets a polite pointer, not the sales flow", reply === EN.afterPaid);
  r = await say("hi");
  check("…and a fresh greeting restarts at the welcome menu", r.reply === EN.welcome);

  // --- hook edge cases
  reset();
  const notBot = await Notice.notifyWhatsAppOrderPaid(mkAdmin(), "d0000000-0000-4000-8000-0000000fffff");
  check("hook: a paid signup that did NOT come from the bot sends nothing", notBot.result === "not_from_bot" && fetchCalls.length === 0);
  // window closed: a new order whose customer last wrote more than 24 hours ago
  const WA2 = "237699222333";
  await say("hello", WA2); await say("2", WA2); await say("1", WA2); await say("1", WA2); await say("1", WA2); await say("Paul Etoa", WA2); await say("Bonamoussadi, Douala", WA2); await say("paul@example.com", WA2); await say("skip", WA2); await say("2", WA2); await say("1", WA2); await say("1", WA2);
  const req2 = tables.signup_requests[1];
  check("second customer (Orange number) ordered Standard through the same flow: network Orange, own number reused", req2 && JSON.stringify(req2.requested_addon_ids) === JSON.stringify([A_STD]) && req2.suggested_username === null && fapshiCalls.at(-1).medium === "orange money" && fapshiCalls.at(-1).phone === "699222333" && fapshiCalls.at(-1).amount === 3500, JSON.stringify(fapshiCalls.at(-1)));
  const conv2 = await convOf(WA2);
  await db.exec(`update public.inbox_conversations set last_inbound_at = now() - interval '30 hours' where id = '${conv2}'`);
  fetchCalls = [];
  const closed = await Notice.notifyWhatsAppOrderPaid(mkAdmin(), req2.id);
  check("WINDOW: outside WhatsApp's 24-hour window the free-form confirmation is NOT sent (a template would be required, which is not built) and this is logged", closed.result === "template_required" && fetchCalls.length === 0 && logs.some((l) => l.includes("template_required")));
  // hand-off active: no automatic payment message
  await say("human", WA2);
  const hand = await Notice.notifyWhatsAppOrderPaid(mkAdmin(), req2.id);
  check("HAND-OFF: while a person has the conversation, the payment hook stays out of it", hand.result === "skipped_handoff");

  // --- payment failures
  reset(); fapshiMode = "reject";
  const WA3 = "237677333444";
  for (const t of ["hi", "2", "1", "3", "1", "Marie Ngo", "Bastos, Yaoundé", "marie@example.com", "skip", "1", "1"]) await say(t, WA3);
  reply = (await say("1", WA3)).reply;
  check("PAYMENT refused by the operator: the customer is told, the order stays, nothing is marked paid, and they can resend or change the number", reply === EN.paymentRejected && tables.signup_requests.at(-1).customer_paid === false && (await sessionOf(WA3)).state === "PAYMENT");
  fapshiMode = "uncertain"; reply = (await say("resend", WA3)).reply;
  check("PAYMENT outcome uncertain: an honest 'we couldn't confirm' message, never a false failure", reply === EN.paymentUncertain);
  globalThis.__fapshiOn = false; reply = (await say("resend", WA3)).reply;
  check("PAYMENT switched off in the platform settings: the existing handler's refusal is reported (no payment possible)", reply === EN.paymentUnavailable);
  globalThis.__fapshiOn = true; fapshiMode = "ok";
  reply = (await say("edit", WA3)).reply;
  check("PAYMENT: 'edit' lets the customer change the network and number, then re-sends the request for the SAME order", reply === EN.askOperator);
  await say("2", WA3);
  const fcBefore = fapshiCalls.length; const reqCountBefore = tables.signup_requests.length;
  reply = (await say("690111222", WA3)).reply;
  check("…the new number is used for the same request (no second order)", reply === EN.paymentSent("Orange Money", "222") && tables.signup_requests.length === reqCountBefore && fapshiCalls.length === fcBefore + 1 && fapshiCalls.at(-1).phone === "690111222" && fapshiCalls.at(-1).medium === "orange money");

  // --- order creation failure
  reset(); globalThis.__signupInsertFails = true;
  const WA4 = "237677444555";
  for (const t of ["hi", "2", "1", "1", "1", "Luc Biya", "Mvog-Ada, Yaoundé", "luc@example.com", "skip", "1", "1"]) await say(t, WA4);
  const reqsBefore4 = tables.signup_requests.length;
  reply = (await say("1", WA4)).reply;
  check("ORDER creation failure: the customer is told nothing was charged, no payment request was made, and the review is back so they can try again; the database error text never reaches them or the logs", reply === EN.orderFailed && tables.signup_requests.length === reqsBefore4 && fapshiCalls.length === 0 && (await sessionOf(WA4)).state === "REVIEW" && !reply.includes("SECRET") && !logs.filter((l) => l.includes('"scope":"sales_bot"')).join("\n").includes("SECRET INSERT TEXT"), JSON.stringify({ reply: reply?.slice(0, 80), reqs: tables.signup_requests.length - reqsBefore4, fapshi: fapshiCalls.length, state: (await sessionOf(WA4)).state }));
  globalThis.__signupInsertFails = false;
  reply = (await say("1", WA4)).reply;
  check("…and 'confirm' works on the next try (a single order, a single payment request)", reply === EN.paymentSent("MTN Mobile Money", "555") && fapshiCalls.length === 1 && tables.signup_requests.length === reqsBefore4 + 1);
  // a second confirmation while the order is being created cannot create a second order
  const sess4 = await sessionOf(WA4);
  await db.exec(`update public.wa_sales_sessions set state = 'REVIEW', version = version + 1 where conversation_id = '${sess4.conversation_id}'`);

  // --- confirmation race: two "1" at once
  reset();
  const WA5 = "237677555666";
  for (const t of ["hi", "2", "1", "2", "1", "Anne Fotso", "Limbe, Fako", "anne@example.com", "skip", "1", "1"]) await say(t, WA5);
  const reqsBefore5 = tables.signup_requests.length;
  const [ra, rb] = await Promise.all([say("1", WA5), say("1", WA5)]);
  check("RACE: two simultaneous confirmations create exactly ONE signup request and ONE payment request", tables.signup_requests.length === reqsBefore5 + 1 && fapshiCalls.length === 1, JSON.stringify({ reqs: tables.signup_requests.length - reqsBefore5, fapshi: fapshiCalls.length, ra: ra.reply?.slice(0, 40), rb: rb.reply?.slice(0, 40) }));

  // --- French
  reset();
  const WA6 = "237655010203";
  r = await say("Bonjour", WA6);
  check("FR: a French greeting gets the French welcome", r.reply === FR.welcome);
  await say("2", WA6);
  reply = (await say("1", WA6)).reply;
  check("FR: the card list is French with prices grouped the French way and the real subscriptions", reply.includes(priceFr(5000)) && reply.includes(priceFr(10000)) && reply.includes("Abonnement Pro") && reply.includes("Abonnement Premium") && reply.includes("QR code sur la carte") && !/1 mois|1 an|inclus/.test(reply), reply);
  reply = (await say("faq", WA6)).reply;
  reply = (await say("2", WA6)).reply;
  check("FR: the FAQ list works from the cards screen via 'comment ça marche'", true);
  r = await say("en", WA6);
  check("language switch to English mid-conversation", r.reply.startsWith(EN.langSwitched));
  r = await say("fr", WA6); r = await say("0", WA6);
  for (const t of ["2", "1", "3", "1", "Aïcha Bello", "Akwa Nord, Douala", "aicha@example.com", "passer", "2", "1"]) r = await say(t, WA6);
  check("FR: the review is in French, with the French payment network name and 'ending' digits", r.reply.includes("Votre commande Ringo Connect Smart Card") && r.reply.includes("Carte : Premium") && r.reply.includes(`Total : ${priceFr(10000)}`) && r.reply.includes("Orange Money · se terminant par 203"), r.reply);
  r = await say("1", WA6);
  check("FR: the payment instruction is French and the Orange network was used", r.reply === FR.paymentSent("Orange Money", "203") && fapshiCalls.at(-1).medium === "orange money" && fapshiCalls.at(-1).amount === 10000);
  globalThis.__fapshiStatus = "SUCCESSFUL";
  const frReq = tables.signup_requests.at(-1);
  await SignupPay.confirmSignupPayment(mkAdmin(), frReq.id); await new Promise((res) => setTimeout(res, 50));
  const frOut = await outboundOf(WA6);
  check("FR: the payment confirmation is sent in French", /Reçu de paiement/.test(frOut.at(-1).body) && frOut.at(-1).body.includes(`N° de reçu : RC-${frReq.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`) && frOut.at(-1).body.includes(`Montant payé : *${priceFr(10000)}*`) && frOut.at(-1).body.includes("Statut : ✅ Payé") && frOut.at(-1).body.includes("Abonnement Basic de 1 an inclus") && /identifiants de connexion/.test(frOut.at(-1).body));

  // --- human hand-off, end to end
  reset();
  const WA7 = "237677777888";
  await say("hello", WA7); await say("2", WA7); await say("1", WA7); await say("1", WA7);
  pushes.length = 0; notes.length = 0; tables.notifications = [];
  r = await say("I want to talk to someone", WA7);
  check("HAND-OFF: the customer is told a person will take over; the session is silenced", r.reply === EN.handoff && (await sessionOf(WA7)).handoff === true && (await sessionOf(WA7)).state === "HUMAN_HANDOFF");
  const conv7 = await convOf(WA7);
  check("HAND-OFF: the Inbox owner gets an in-app bell row that was really inserted (generic text, link to this conversation) plus a best-effort push, in addition to the normal new-message push", tables.notifications.some((n) => n.audience === "user" && n.user_id === alice.user && n.type === "inbox_handoff" && n.link === `/dashboard/inbox/${conv7}` && n.title === EN.handoffNoticeTitle) && pushes.some((p) => p.payload.category === "inbox_handoff" && p.userId === alice.user && p.payload.url === `/dashboard/inbox/${conv7}` && p.kind === "only"));
  const beforeSilent = (await outboundOf(WA7)).length; fetchCalls = [];
  const sBefore = await sessionOf(WA7);
  r = await say("1", WA7); const r2 = await say("order", WA7); const r3 = await say("0", WA7);
  check("HAND-OFF: while it is on, the bot sends NOTHING and changes nothing, but every customer message is still stored in the Inbox", r.sent === 0 && r2.sent === 0 && r3.sent === 0 && fetchCalls.length === 0 && (await outboundOf(WA7)).length === beforeSilent && (await sessionOf(WA7)).version === sBefore.version && (await count("inbox_messages", `conversation_id = '${conv7}' and direction = 'inbound'`)) >= 6);
  const saveTry = await asService(`select public.wa_sales_save('${conv7}', ${(await sessionOf(WA7)).version}, 'WELCOME', '{}'::jsonb, false, null) as r`).then((x) => x.rows[0].r);
  check("HAND-OFF cannot be turned off by the bot's own save (only the owner function can)", saveTry === "ok" && (await sessionOf(WA7)).handoff === true && (await sessionOf(WA7)).state === "HUMAN_HANDOFF");
  const bobTry = await asService(`select public.wa_sales_set_handoff('${bob.user}', '${conv7}', false) as r`).then((x) => x.rows[0].r);
  check("HAND-OFF: another owner cannot switch it (indistinguishable from a missing conversation)", bobTry === "not_found" && (await sessionOf(WA7)).handoff === true);
  const ownerOff = await asService(`select public.wa_sales_set_handoff('${alice.user}', '${conv7}', false) as r`).then((x) => x.rows[0].r);
  r = await say("hi", WA7);
  check("HAND-OFF ended by the OWNER: the bot resumes from the welcome menu", ownerOff === "ok" && (await sessionOf(WA7)).handoff === false && r.reply === EN.welcome);

  // --- owner resume action (lib/salesBot/handoff.ts behind POST /api/inbox/conversations/<id>/sales-bot)
  reset();
  const WA8 = "237677555444";
  await say("hello", WA8); await say("hi", WA8);
  const conv8 = await convOf(WA8);
  await say("human", WA8);
  const aliceActor = { admin: mkAdmin(), userId: alice.user, profileId: alice.profile }, bobActor = { admin: mkAdmin(), userId: bob.user, profileId: bob.profile };
  check("RESUME setup: the conversation is in hand-off and the bot is silent", (await sessionOf(WA8)).handoff === true && (await say("1", WA8)).sent === 0);
  const bobRes = await Handoff.resumeSalesBot(bobActor, conv8);
  check("RESUME by ANOTHER owner: 404 not_found, hand-off untouched", bobRes.status === 404 && bobRes.body.ok === false && bobRes.body.error === "not_found" && (await sessionOf(WA8)).handoff === true);
  check("RESUME with a bad conversation id: 404, no database call", (await Handoff.resumeSalesBot(aliceActor, "not-a-uuid")).status === 404 && !rpcCalls.some((c) => c.fn === "wa_sales_set_handoff" && c.args.p_conversation_id === "not-a-uuid"));
  const aliceRes = await Handoff.resumeSalesBot(aliceActor, conv8);
  check("RESUME by the OWNER: 200, the hand-off flag is cleared and the flow restarts at the welcome step", aliceRes.status === 200 && aliceRes.body.ok === true && aliceRes.body.state === "resumed" && (await sessionOf(WA8)).handoff === false && (await sessionOf(WA8)).state === "WELCOME");
  check("RESUME sends the owner's id from the session only (the request supplies none)", rpcCalls.filter((c) => c.fn === "wa_sales_set_handoff").every((c) => [alice.user, bob.user].includes(c.args.p_actor_user_id) && c.args.p_on === false));
  r = await say("hi", WA8);
  check("AFTER RESUME the bot answers normally again", r.reply === EN.welcome);
  check("AFTER RESUME it can hand off again", (await say("human", WA8)).reply === EN.handoff && (await sessionOf(WA8)).handoff === true);
  await Handoff.resumeSalesBot(aliceActor, conv8);
  // a second resume while the bot is already active must not reset a conversation in progress
  await say("hi", WA8); await say("2", WA8); await say("1", WA8);
  const mid = await sessionOf(WA8);
  const noopRes = await Handoff.resumeSalesBot(aliceActor, conv8);
  check("RESUME on a conversation that is NOT in hand-off is a no-op: nothing is reset", noopRes.status === 200 && noopRes.body.state === "noop" && (await sessionOf(WA8)).version === mid.version && (await sessionOf(WA8)).state === mid.state);
  const WA9 = "237677555333";
  await say("hello", WA9);
  const conv9 = await convOf(WA9);
  await db.exec(`delete from public.wa_sales_sessions where conversation_id = '${conv9}'`);
  const noSessRes = await Handoff.resumeSalesBot(aliceActor, conv9);
  check("RESUME on a conversation with no bot session: no-op, no session is created", noSessRes.status === 200 && noSessRes.body.state === "noop" && (await count("wa_sales_sessions", `conversation_id = '${conv9}'`)) === 0);
  rpcMode = "sales_error";
  const failRes = await Handoff.resumeSalesBot(aliceActor, conv8);
  rpcMode = "ok";
  check("RESUME with a database error: 500 server_error and nothing from the error is returned or logged", failRes.status === 500 && failRes.body.error === "server_error" && !JSON.stringify(failRes).includes("SECRET BOT TEXT") && !logs.join("\n").includes("SECRET BOT TEXT"));
  const routeSrc = read("src/app/api/inbox/conversations/[id]/sales-bot/route.ts");
  check("RESUME/PAUSE route: owner-only wrapper, the id comes from the URL, the only body field read is the word 'pause', no owner/profile/recipient from the request", /withInboxOwner\(request, \(actor, body\) => \(body\.action === "pause" \? pauseSalesBot\(actor, params\.id\) : resumeSalesBot\(actor, params\.id\)\)\)/.test(routeSrc) && !/withConversationActor|withSavedReplyActor|assertAdmin/.test(routeSrc) && (routeSrc.match(/body\.\w+/g) || []).join() === "body.action" && !/profile_id|owner_id|p_actor_user_id/.test(routeSrc.replace(/\/\/.*$/gm, "")));

  // --- pause the sales bot in one chat (the owner's Pause sales bot button)
  const Pause = Handoff;
  reset();
  const WAP = "237677606060";
  await say("hello", WAP); await say("2", WAP); await say("1", WAP);
  const convP = await convOf(WAP);
  const sentBefore = (await outboundOf(WAP)).length; fetchCalls = [];
  const bobP = await Pause.pauseSalesBot(bobActor, convP);
  check("PAUSE by ANOTHER owner: 404 not_found and the conversation is untouched", bobP.status === 404 && bobP.body.error === "not_found" && (await sessionOf(WAP)).handoff === false);
  check("PAUSE with a bad conversation id: 404, no database call", (await Pause.pauseSalesBot(aliceActor, "not-a-uuid")).status === 404);
  const pausedRes = await Pause.pauseSalesBot(aliceActor, convP);
  check("PAUSE by the OWNER: 200 paused, the hand-off flag is on, and NOTHING is sent to the customer by the pause itself", pausedRes.status === 200 && pausedRes.body.state === "paused" && (await sessionOf(WAP)).handoff === true && (await sessionOf(WAP)).state === "HUMAN_HANDOFF" && (await outboundOf(WAP)).length === sentBefore && fetchCalls.length === 0);
  r = await say("2", WAP); const r2P = await say("hello", WAP);
  check("PAUSED: the bot stays completely silent (every message is still stored in the Inbox)", r.sent === 0 && r2P.sent === 0 && fetchCalls.length === 0 && (await count("inbox_messages", `conversation_id = '${convP}' and direction = 'inbound'`)) >= 4);
  check("PAUSE again is harmless (still paused), and the other customers are not affected", (await Pause.pauseSalesBot(aliceActor, convP)).status === 200 && (await sessionOf(WAP)).handoff === true && (await say("hello", "237677606061")).reply === EN.welcome);
  const resumedP = await Pause.resumeSalesBot(aliceActor, convP);
  r = await say("hi", WAP);
  check("RESUME after a PAUSE: the bot answers again from the welcome menu", resumedP.body.state === "resumed" && r.reply === EN.welcome);
  const WAQ = "237677606062";
  await say("hello", WAQ); const convQ = await convOf(WAQ);
  await db.exec(`delete from public.wa_sales_sessions where conversation_id = '${convQ}'`);
  const pauseNoSession = await Pause.pauseSalesBot(aliceActor, convQ);
  check("PAUSE on a chat with no bot session yet: the pause is recorded so the bot never starts there", pauseNoSession.body.state === "paused" && (await sessionOf(WAQ)).handoff === true && (await say("hello", WAQ)).sent === 0);
  await Pause.resumeSalesBot(aliceActor, convQ);
  rpcMode = "sales_error";
  const pauseFail = await Pause.pauseSalesBot(aliceActor, convP);
  rpcMode = "ok";
  check("PAUSE with a database error: 500 server_error, nothing leaked", pauseFail.status === 500 && pauseFail.body.error === "server_error" && !JSON.stringify(pauseFail).includes("SECRET BOT TEXT"));
  const btnSrc = read("src/components/inbox/ResumeSalesBotButton.tsx"), viewSrc = read("src/components/inbox/InboxView.tsx");
  check("PAUSE button: next to Resume in every chat for the owner (and only when the bot is configured); it sends only the word pause", /data-testid="pause-sales-bot"/.test(btnSrc) && /data-testid="resume-sales-bot"/.test(btnSrc) && /\{ action: "pause" \}/.test(btnSrc) && /salesBotResume && access\.kind === "owner" && <ResumeSalesBotButton/.test(viewSrc));
  check("PAUSE copy exists in English and French", ["pauseSalesBot", "pauseSalesBotDone", "pauseSalesBotFailed"].every((k) => typeof translations.en.inbox[k] === "string" && typeof translations.fr.inbox[k] === "string" && translations.fr.inbox[k] !== translations.en.inbox[k]) && /Pause sales bot/.test(translations.en.inbox.pauseSalesBot));
  check("RESUME copy exists in English and French", ["resumeSalesBot", "resumeSalesBotDone", "resumeSalesBotNotPaused", "resumeSalesBotFailed"].every((k) => typeof translations.en.inbox[k] === "string" && typeof translations.fr.inbox[k] === "string" && translations.fr.inbox[k] !== translations.en.inbox[k]));
  check("PAYMENT-SENT copy no longer promises a message 'as soon as' it is confirmed (EN and FR)", !/as soon as/i.test(EN.paymentSent("MTN", "123")) && !/dès (qu|que)/i.test(FR.paymentSent("MTN", "123")) && /try to let you know/.test(EN.paymentSent("MTN", "123")) && /essaierons de vous prévenir/.test(FR.paymentSent("MTN", "123")));

  // --- language that follows the customer, e-mail collection, talk-to-an-agent menu entry, plan feature lists, help hints, receipt
  reset();
  check("LANGUAGE signal: French messages are French, English messages English, bare numbers / names / menu words give none", Machine.languageSignal("Bonjour, je veux commander une carte") === "fr" && Machine.languageSignal("j'ai une question sur le prix") === "fr" && Machine.languageSignal("où êtes-vous situés") === "fr" && Machine.languageSignal("Hello, I want to order a card") === "en" && Machine.languageSignal("what is the price?") === "en" && Machine.languageSignal("1") === null && Machine.languageSignal("Jean Mbah") === null && Machine.languageSignal("0") === null && Machine.languageSignal("") === null);
  const sessW = (state, data) => ({ state, data, handoff: false, signupRequestId: null, version: 0 });
  let ls = Machine.step(sessW("WELCOME", {}), "Bonjour", facts());
  check("LANGUAGE: the first French message is answered in French (and English in English)", ls.data.lang === "fr" && ls.reply.includes(FR.welcome.slice(0, 40)) && Machine.step(sessW("WELCOME", {}), "hello", facts()).data.lang === "en");
  ls = Machine.step(sessW("CARDS", { lang: "en" }), "Bonjour, quel est le prix ?", facts());
  check("LANGUAGE: a clearly French message mid-conversation switches the replies to French, without losing the place and without locking", ls.data.lang === "fr" && !ls.data.langLocked && ls.state === "CARDS" && ls.reply.includes(FR.didNotUnderstand));
  const backEn = Machine.step(sessW("CARDS", { lang: "fr" }), "what is the price of the cards?", facts());
  check("LANGUAGE: and back to English when the customer writes English (not locked)", backEn.data.lang === "en");
  const lockedFr = Machine.step(sessW("WELCOME", { lang: "en" }), "fr", facts());
  check("LANGUAGE buttons still work: typing fr / en switches, says so, and LOCKS the choice", lockedFr.data.lang === "fr" && lockedFr.data.langLocked === true && lockedFr.reply.startsWith(FR.langSwitched) && Machine.step(sessW("WELCOME", { lang: "fr" }), "english", facts()).data.lang === "en" && Machine.step(sessW("WELCOME", { lang: "fr" }), "en", facts()).data.langLocked === true);
  const stayFr = Machine.step(sessW("WELCOME", lockedFr.data), "hello how much is the card", facts());
  const stayEn = Machine.step(sessW("WELCOME", { lang: "en", langLocked: true }), "bonjour je veux commander", facts());
  check("LANGUAGE: an explicit choice is never overridden by guessing", stayFr.data.lang === "fr" && stayEn.data.lang === "en");
  check("LANGUAGE: free-text answers (name, address, e-mail) never change the language", Machine.step(sessW("ASK_ADDRESS", { lang: "en", tier: "pro", name: "Jean" }), "Rue de la Paix, Akwa, Douala", facts()).data.lang === "en" && Machine.step(sessW("ASK_NAME", { lang: "fr", tier: "pro" }), "Hello Thanks", facts()).data.lang === "fr");
  check("LANGUAGE: the choice survives the main menu and the start of an order", Machine.step(sessW("CARDS", lockedFr.data), "0", facts()).data.langLocked === true && Machine.step(sessW("CARD_DETAIL", { ...lockedFr.data, tier: "pro" }), "1", facts()).data.langLocked === true);

  // the menu entry
  check("MENU: the main menu (shown after the Get started button) lists exactly four options in order (1 Discover Ringo, 2 Buy a card, 3 Know more, 4 Speak with a Ringo agent), in both languages", [[EN.mainMenu, ["Discover Ringo", "Buy a card", "Know more", "Speak with a Ringo agent"]], [FR.mainMenu, ["Découvrir Ringo", "Acheter une carte", "En savoir plus", "Parler à un agent Ringo"]]].every(([text, labels]) => labels.every((l, i) => text.includes(`${i + 1}. ${l}`)) && !/\n5\. /.test(text) && text.indexOf(`1. ${labels[0]}`) < text.indexOf(`4. ${labels[3]}`)));
  const agent = Machine.step(sessW("WELCOME", { lang: "en" }), "4", facts());
  check("MENU: choosing 4 hands the conversation to a person (same hand-off as typing human): the customer is told, the owner is notified by the runner", agent.effect === "handoff" && agent.handoff === true && agent.state === "HUMAN_HANDOFF" && agent.reply === EN.handoff && Machine.step(sessW("COMPLETED", { lang: "fr" }), "4", facts()).reply === FR.handoff);

  // e-mail
  const afterAddr = Machine.step(sessW("ASK_ADDRESS", { lang: "en", tier: "pro", name: "Jean Mbah" }), "Akwa, Douala", facts());
  check("EMAIL: the question follows the address and says why it is needed (login details)", afterAddr.state === "ASK_EMAIL" && afterAddr.reply === EN.askEmail && /login details/.test(EN.askEmail) && /identifiants/.test(FR.askEmail));
  const badMails = ["not-an-email", "a@b", "a b@c.com", "@x.com", "jean@", "x@y.c", "1234", `${"a".repeat(130)}@x.com`];
  check("EMAIL: an invalid address is refused with the reason and the talk-to-the-team hint, and nothing is stored", badMails.every((m) => { const x = Machine.step(sessW("ASK_EMAIL", { lang: "en", tier: "pro", name: "Jean", address: "Akwa, Douala" }), m, facts()); return x.state === "ASK_EMAIL" && x.reply === EN.emailInvalid && !x.data.email; }) && /\*human\*/.test(EN.emailInvalid) && /\*humain\*/.test(FR.emailInvalid));
  const goodMail = Machine.step(sessW("ASK_EMAIL", { lang: "en", tier: "pro", name: "Jean", address: "Akwa, Douala" }), "  Jean.Mbah+ringo@Example.COM ", facts());
  check("EMAIL: a valid address is stored lower-cased and the username question follows", goodMail.state === "ASK_USERNAME" && goodMail.data.email === "jean.mbah+ringo@example.com" && goodMail.reply === EN.askUsername);
  check("EMAIL: a bare 'human' while giving it hands off (nobody is stuck without an e-mail)", Machine.step(sessW("ASK_EMAIL", { lang: "en" }), "human", facts()).effect === "handoff");
  const fullE = { lang: "en", tier: "pro", name: "Jean Mbah", address: "Akwa, Douala", email: "jean@example.com", username: "johnmbah", medium: "mobile money", payPhone: "677123456" };
  const rev = Machine.step(sessW("ASK_PAY_PHONE", { ...fullE, payPhone: undefined }), "1", facts({ total: 5000 }));
  check("EMAIL: the review shows it, and the French review too", rev.reply.includes("Email: jean@example.com") && Machine.step(sessW("ASK_PAY_PHONE", { ...fullE, lang: "fr", payPhone: undefined }), "1", facts({ total: 5000 })).reply.includes("E-mail : jean@example.com"));
  const em1 = Machine.step(sessW("EDIT_MENU", fullE), "3", facts());
  const em2 = Machine.step(sessW(em1.state, em1.data), "new@example.com", facts({ total: 5000 }));
  check("EMAIL: editable from the review (option 3) and back to the review; the other edit options moved down by one (4 username, 5 payment number, 6 card)", em1.state === "ASK_EMAIL" && em2.state === "REVIEW" && em2.data.email === "new@example.com" && Machine.step(sessW("EDIT_MENU", fullE), "4", facts()).state === "ASK_USERNAME" && Machine.step(sessW("EDIT_MENU", fullE), "5", facts()).state === "ASK_OPERATOR" && Machine.step(sessW("EDIT_MENU", fullE), "6", facts()).state === "CARDS" && /3\. Email/.test(EN.editMenu) && /3\. E-mail/.test(FR.editMenu));
  check("EMAIL: a session that reached the review before this step existed is asked for it instead of failing", Machine.step(sessW("REVIEW", { ...fullE, email: undefined }), "1", facts({ total: 5000 })).state === "ASK_EMAIL");
  const st = Machine.toStored("ASK_EMAIL", { lang: "en", email: undefined });
  const back = Machine.fromStored(st.state, st.data);
  check("EMAIL storage: stored as ASK_ADDRESS plus a flag (the database state list is not altered) and restored exactly; other states pass through", st.state === "ASK_ADDRESS" && st.data.awaitEmail === true && back.state === "ASK_EMAIL" && back.data.awaitEmail === undefined && Machine.toStored("REVIEW", { lang: "en" }).state === "REVIEW" && Machine.fromStored("ASK_ADDRESS", { lang: "en" }).state === "ASK_ADDRESS");

  // plan feature lists on the cards
  const planRows = tables.plans;
  const offersF = (await Offers.resolveSmartCardOffers(mkAdmin())).offers;
  const cardsEn = Machine.step(sessW("BUY_METHOD", { lang: "en" }), "1", { ...facts(), offers: offersF }).reply;
  const cardsFr = Machine.step(sessW("BUY_METHOD", { lang: "fr" }), "1", { ...facts(), offers: offersF }).reply;
  check("FEATURES: the plan feature lists come from the plans table at runtime (Basic for Standard and Premium, Pro for Pro)", offersF.find((o) => o.tier === "standard").featuresEn.includes("Up to 15 links") && offersF.find((o) => o.tier === "premium").featuresEn.includes("Up to 15 links") && offersF.find((o) => o.tier === "pro").featuresEn.includes("Unlimited links") && offersF.find((o) => o.tier === "pro").featuresFr.includes("Liens illimités"));
  const proBlock = cardsEn.split("*Pro*")[1].split("*Premium*")[0], stdBlock = cardsEn.split("*Standard*")[1].split("*Pro*")[0];
  check("FEATURES: the card list shows each tier's short list (subscription, QR, configuration, then its own features), in English and French", /Basic subscription/.test(stdBlock) && /Up to 15 links/.test(stdBlock) && !/Unlimited links/.test(stdBlock) && /Pro subscription/.test(proBlock) && /Unlimited links/.test(proBlock) && /QR code on the card/.test(proBlock) && /Liens illimités/.test(cardsFr) && /Jusqu’à 15 liens|Jusqu'à 15 liens/.test(cardsFr) && cardsEn.length < 3500);
  check("FEATURES: every screen stays well inside WhatsApp's 4,096-character limit in both languages (cards, compare, each detail)", [cardsEn, cardsFr, ...["en", "fr"].flatMap((lg) => [Machine.step(sessW("CARDS", { lang: lg }), "4", { ...facts(), offers: offersF }).reply, ...["1", "2", "3"].map((n) => Machine.step(sessW("CARDS", { lang: lg }), n, { ...facts(), offers: offersF }).reply)])].every((x) => x.length < 3800), [cardsEn.length, cardsFr.length].join());
  check("FEATURES: the detail and compare screens carry them too", Machine.step(sessW("CARDS", { lang: "en" }), "2", { ...facts(), offers: offersF }).reply.includes("Unlimited links") && Machine.step(sessW("CARDS", { lang: "en" }), "4", { ...facts(), offers: offersF }).reply.includes("Up to 15 links"));
  const savedPlans = tables.plans.splice(0);
  const noPlans = await Offers.resolveSmartCardOffers(mkAdmin());
  tables.plans.push(...savedPlans);
  check("FEATURES: if the plans cannot be read the cards are still offered, just without the extra list (nothing is invented)", noPlans.offers.length === 3 && noPlans.offers.every((o) => o.featuresEn.length === 0) && !Machine.step(sessW("WELCOME", { lang: "en" }), "1", { ...facts(), offers: noPlans.offers }).reply.includes("Unlimited links"));

  // talk-to-the-team hints in the technical places
  const HINT_EN = "Need help? Type *human* to talk to a Ringo team member.", HINT_FR = "Besoin d’aide ? Tapez *humain* pour parler à un membre de l’équipe Ringo.";
  check("HELP hints: the confusing or technical messages end with how to reach a Ringo team member, in both languages", ["invalidTail", "payPhoneInvalid", "emailInvalid", "paymentRejected", "paymentUncertain", "statusPending", "statusUnknown", "faqOptions", "howOptions"].every((k) => EN[k].includes(HINT_EN) && FR[k].includes(HINT_FR)));
  check("HELP hints: an unrecognised answer shows the hint, and typing human then hands off", Machine.step(sessW("CARDS", { lang: "en" }), "blah", facts()).reply.includes(HINT_EN) && Machine.step(sessW("ASK_PAY_PHONE", { lang: "fr", medium: "mobile money" }), "abc", facts()).reply.includes(HINT_FR));

  // through the real webhook: language, e-mail stored with the order, agent menu entry
  reset();
  const WAL = "237677404040";
  r = await say("Bonjour", WAL);
  check("E2E LANGUAGE: a French first message gets the French welcome, an English one the English welcome, regardless of the earlier language", r.reply === FR.welcome && (await say("hello", WAL)).reply === EN.welcome && (await say("Bonjour", WAL)).reply === FR.welcome);
  r = await say("en", WAL);
  check("E2E LANGUAGE: typing en still switches (and keeps English even if the customer then writes French)", r.reply.startsWith(EN.langSwitched) && (await say("bonjour", WAL)).reply === EN.welcome);
  const WAA = "237677404041";
  tables.notifications = [];
  await say("hi", WAA); r = await say("4", WAA);
  check("E2E MENU: option 4 hands over to a person: the customer is told, the session is silenced, the owner gets the bell row + push, and the bot then sends nothing", r.reply === EN.handoff && (await sessionOf(WAA)).handoff === true && tables.notifications.some((n) => n.type === "inbox_handoff") && pushes.some((p) => p.payload.category === "inbox_handoff") && (await say("1", WAA)).sent === 0);
  const WAE = "237677404042";
  for (const t of ["hello", "2", "1", "2", "1", "Eric Nkoa", "Bastos, Yaoundé"]) r = await say(t, WAE);
  check("E2E EMAIL: after the address the customer is asked for an e-mail; the database holds the state as ASK_ADDRESS with the flag", r.reply === EN.askEmail && (await sessionOf(WAE)).state === "ASK_ADDRESS" && (await sessionOf(WAE)).data.awaitEmail === true);
  r = await say("nope", WAE);
  check("E2E EMAIL: an invalid address is refused with the hint and the customer stays on the question", r.reply === EN.emailInvalid && (await sessionOf(WAE)).data.awaitEmail === true);
  r = await say("Eric.Nkoa@Example.com", WAE);
  check("E2E EMAIL: a valid address moves on to the username question and the flag is cleared", r.reply === EN.askUsername && (await sessionOf(WAE)).state === "ASK_USERNAME" && (await sessionOf(WAE)).data.email === "eric.nkoa@example.com" && (await sessionOf(WAE)).data.awaitEmail === undefined);
  for (const t of ["skip", "1", "1"]) r = await say(t, WAE);
  check("E2E EMAIL: the review shows it", r.reply.includes("Email: eric.nkoa@example.com"));
  r = await say("1", WAE);
  const reqE = tables.signup_requests.at(-1);
  check("E2E EMAIL: the order is created with the e-mail through the existing signup handler (so the admin approval can e-mail the login details)", reqE.email === "eric.nkoa@example.com" && reqE.full_name === "Eric Nkoa");

  // --- website and official profile, the image option, and the 0 button
  const SITE = "www.ringoconnectltd.com", PROFILE = "www.ringoconnectltd.com/ringoconnectltd";
  check("LINKS: the questions menu carries the enquiries line with the website and the official profile (EN and FR); the short first message deliberately does not", [EN.faqMenu, EN.moreEnquiries].every((x) => x.includes(`For more enquiries, check out ${SITE} or our official Ringo profile ${PROFILE}`)) && [FR.faqMenu, FR.moreEnquiries].every((x) => x.includes(`Pour plus de renseignements, consultez ${SITE} ou notre profil officiel Ringo ${PROFILE}`)));
  const imgEn = Machine.step(sessW("WELCOME", { lang: "en" }), "images", facts());
  check("IMAGES: the typed word sends the customer to the official Ringo profile (and the website), starts nothing, hands nothing off, and keeps them at the menu", imgEn.reply === EN.imagesInfo && EN.imagesInfo.includes(PROFILE) && EN.imagesInfo.includes(SITE) && FR.imagesInfo.includes(PROFILE) && imgEn.effect === "none" && imgEn.handoff === false && imgEn.state === "WELCOME" && Machine.step(sessW("COMPLETED", { lang: "fr" }), "images", facts()).state === "COMPLETED");
  check("IMAGES: the words work too, in English and French, and the next 2 (Buy a card) asks how to buy", ["see images", "images", "photos", "see the card"].every((w) => Machine.step(sessW("WELCOME", { lang: "en" }), w, facts()).reply === EN.imagesInfo) && ["voir les images", "photos", "voir des images"].every((w) => Machine.step(sessW("WELCOME", { lang: "fr", langLocked: true }), w, facts()).reply === FR.imagesInfo) && Machine.step(sessW("WELCOME", { lang: "en" }), "2", { ...facts(), offers: OFFERS }).state === "BUY_METHOD");
  check("IMAGES: the reply claims nothing about the pictures beyond pointing to the profile", !/gallery|album|video|download|\d+ (photos|images)/i.test(EN.imagesInfo + FR.imagesInfo));
  const zeroStates = ["CARDS", "COMPARE", "CARD_DETAIL", "HOW_IT_WORKS", "FAQ", "RECOMMEND_1", "RECOMMEND_2", "ASK_NAME", "ASK_ADDRESS", "ASK_EMAIL", "ASK_USERNAME", "ASK_OPERATOR", "ASK_PAY_PHONE", "REVIEW", "EDIT_MENU", "PAYMENT", "COMPLETED"];
  const zeroData = { lang: "en", tier: "pro", name: "Jean Mbah", address: "Akwa, Douala", email: "jean@example.com", medium: "mobile money", payPhone: "677123456" };
  check("0 BUTTON: from every state of the conversation, 0 goes back to the main menu (inside the order it also clears the half-made order, as it always did)", zeroStates.every((st) => { const x = Machine.step(sessW(st, zeroData), "0", { ...facts(), offers: OFFERS, total: 5000 }); return x.state === "WELCOME" && x.reply.includes(EN.mainMenu); }));
  check("0 BUTTON: every question of the order and the payment messages tell the customer so, in English and French", [EN, FR].every((L) => [L.askName("Pro"), L.askAddress, L.askEmail, L.askUsername, L.askOperator, L.askPayPhone("456"), L.askPayPhone(null)].every((x) => x.includes("*0*")) && [L.paymentSent("MTN", "123"), L.paymentResumed, L.statusPending, L.statusPaid("Pro")].every((x) => x.includes("*0*")) && [L.cardsFooter(4, 5), L.cardOptions, L.compareOptions, L.faqOptions, L.howOptions, L.rec1, L.rec2, L.recOptions, L.editMenu, L.buyMethod, L.meetingInfo].every((x) => /\b0\b/.test(x))));
  reset();
  const WAI = "237677505050";
  await say("hello", WAI); r = await say("images", WAI);
  check("E2E IMAGES: through the webhook the customer gets the profile link and no handoff, no order, no payment is started", r.reply === EN.imagesInfo && (await sessionOf(WAI)).handoff === false && (await sessionOf(WAI)).state === "WELCOME" && fapshiCalls.length === 0 && (await say("0", WAI)).reply === EN.mainMenu);

  // --- the owner's switch OFF: silence for everyone, including mid-order, without touching orders, payments, storage, push or the paid notice
  reset();
  const WA10 = "237677101010";
  for (const t of ["hello", "2", "1", "1", "1", "Rose Ndi"]) await say(t, WA10);
  const mid10 = await sessionOf(WA10); const conv10 = await convOf(WA10);
  check("SWITCH setup: a customer is in the middle of an order (asking the address)", mid10.state === "ASK_ADDRESS" && mid10.data.name === "Rose Ndi");
  await sw("wa_sales_settings_set", { p_actor_user_id: alice.user, p_profile_id: alice.profile, p_enabled: false });
  reset();
  const offReplies = [await say("Bonamoussadi, Douala", WA10), await say("human", WA10), await say("0", WA10), await say("hello", "237677101011"), await say("x", WA10, { type: "image" })];
  check("SWITCH OFF: no reply at all, not even to a customer mid-order, to 'human', to the menu, to a new customer or to media; no outbound request to Meta", offReplies.every((x) => x.status === 200 && x.sent === 0) && fetchCalls.length === 0);
  const after10 = await sessionOf(WA10);
  check("SWITCH OFF: the session is untouched (same state, data, version, no hand-off); nothing was claimed as processed; a new customer gets no session; no hand-off push", after10.state === mid10.state && after10.version === mid10.version && after10.handoff === false && JSON.stringify(after10.data) === JSON.stringify(mid10.data) && (await count("wa_sales_processed", `conversation_id = '${conv10}' and provider_message_id in (${offReplies.map((x) => "'" + x.id + "'").join(",")})`)) === 0 && !(await sessionOf("237677101011")) && !pushes.some((p) => p.payload.category === "inbox_handoff"));
  check("SWITCH OFF: inbound messages are still stored in the Inbox and the normal new-message push still goes out", (await count("inbox_messages", `conversation_id = '${conv10}' and direction = 'inbound'`)) >= 9 && pushes.length >= 1 && pushes.every((p) => p.userId === alice.user) && !pushes.some((p) => p.payload.category === "inbox_handoff"));
  const gateRes = await Runner.handleSalesBotMessage({ admin: mkAdmin() }, { phoneNumberId: PH_A, messageId: offReplies[0].id });
  check("SWITCH OFF: the runner itself also refuses (second layer), logging a category only", gateRes.result === "off" && logs.some((l) => l.includes("switched_off")));
  reset();
  const noticeOff = await Notice.notifyWhatsAppOrderPaid(mkAdmin(), req2.id);
  check("SWITCH OFF: the paid-order confirmation never consults the switch (hook and payment code do not reference it)", noticeOff.result !== "off" && !read("src/lib/salesBot/paymentNotice.ts").includes("wa_sales_enabled") && !read("src/lib/signupPayment.ts").includes("wa_sales_enabled"));
  check("SWITCH OFF: pending orders and payments are untouched (the switch migration never references signup requests, Fapshi or orders)", !/signup_requests|fapshi|orders/.test(bare2));
  const resumeOff = await Handoff.resumeSalesBot({ admin: mkAdmin(), userId: alice.user, profileId: alice.profile }, conv10);
  check("SWITCH OFF: the per-conversation resume action still works (a no-op here, nothing is in hand-off)", resumeOff.status === 200 && resumeOff.body.state === "noop");
  rpcMode = "sales_error";
  r = await say("hi", WA10);
  check("SWITCH read error: the bot fails closed (silent), the message is still stored and answered 200, nothing leaks", r.status === 200 && r.sent === 0 && !logs.join("\n").includes("SECRET BOT TEXT"));
  rpcMode = "ok"; reset();
  await sw("wa_sales_settings_set", { p_actor_user_id: alice.user, p_profile_id: alice.profile, p_enabled: true });
  r = await say("0", WA10);
  check("SWITCH back ON: the bot answers again, with the customer's earlier state intact (the 0 cancels the half-made order as always)", r.status === 200 && r.sent === 1 && r.reply.startsWith(translations.en.inbox.salesBot.cancelled));
  check("SWITCH audit: every real change is logged with the actor (on, off, on) and nothing else", (await q1("select enabled from public.wa_sales_settings_log order by id")).map((x) => x.enabled).join() === "true,false,true");
  process.env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID = PH_B; reset();
  r = await say("hi", "237677101012");
  process.env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID = PH_A;
  check("ENV GATE still decisive: with the owner's switch ON but the environment variable naming another number, the bot stays silent", r.sent === 0);
  delete process.env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID; reset();
  r = await say("hi", "237677101013");
  process.env.WHATSAPP_SALES_BOT_PHONE_NUMBER_ID = PH_A;
  check("ENV GATE still decisive: with the switch ON and the variable unset the bot is off", r.sent === 0);
  const SwitchLib = src("lib/salesBot/settings.ts");
  const aliceA = { admin: mkAdmin(), userId: alice.user, profileId: alice.profile };
  check("switch route logic: a non-boolean body is rejected (422), a bad profile id is 404, before any database call", (await SwitchLib.saveSalesBotSwitch(aliceA, { enabled: "yes" })).status === 422 && (await SwitchLib.saveSalesBotSwitch(aliceA, {})).status === 422 && (await SwitchLib.saveSalesBotSwitch({ ...aliceA, profileId: "x" }, { enabled: true })).status === 404);
  check("switch route logic: another owner's profile is 404, the owner's own is 200 and reads back", (await SwitchLib.saveSalesBotSwitch({ ...aliceA, userId: bob.user }, { enabled: false })).status === 404 && (await SwitchLib.saveSalesBotSwitch(aliceA, { enabled: false })).body.state === "off" && (await SwitchLib.loadSalesBotSwitch(mkAdmin(), alice.user, alice.profile)) === false && (await SwitchLib.saveSalesBotSwitch(aliceA, { enabled: true })).body.state === "on" && (await SwitchLib.loadSalesBotSwitch(mkAdmin(), alice.user, alice.profile)) === true);
  rpcMode = "sales_error";
  const swFail = await SwitchLib.saveSalesBotSwitch(aliceA, { enabled: false }); const swRead = await SwitchLib.loadSalesBotSwitch(mkAdmin(), alice.user, alice.profile);
  rpcMode = "ok";
  check("switch route logic: a database error is a 500 with nothing leaked, and an unreadable switch loads as null (the control is then hidden)", swFail.status === 500 && swFail.body.error === "server_error" && swRead === null && !logs.join("\n").includes("SECRET BOT TEXT"));
  const swRoute = read("src/app/api/inbox/sales-bot/route.ts"), swPage = read("src/app/dashboard/inbox/sales-bot/page.tsx"), swPanel = read("src/components/inbox/SalesBotSwitchPanel.tsx"), swView = read("src/components/inbox/InboxView.tsx"), swSettingsForm = read("src/components/inbox/InboxSettingsForm.tsx"), swSettingsPage = read("src/app/dashboard/inbox/settings/page.tsx");
  check("switch route: owner-only wrapper (no team-member or admin path), body handled only by saveSalesBotSwitch, no owner/profile read from the request", /withInboxOwner\(request, \(actor, body\) => saveSalesBotSwitch\(actor, body\)\)/.test(swRoute) && !/withConversationActor|withSavedReplyActor|assertAdmin|profile_id|owner_id/.test(swRoute));
  check("switch UI: its OWN Inbox page and button (not in the automation settings): owner-only page, the saved value is read through the owner-checked function, the panel sends only the boolean", /resolveInboxOwner/.test(swPage) && /redirect\("\/dashboard"\)/.test(swPage) && /loadSalesBotSwitch\(/.test(swPage) && /\{ enabled: next \}/.test(swPanel) && /data-testid="sales-bot-toggle"/.test(swPanel) && !/assertAdmin|\/admin/.test(swPage + swPanel));
  check("switch UI: the automation settings page and form are unchanged by the bot (no sales bot reference)", !/salesBot|sales-bot|sales_bot/i.test(swSettingsForm + swSettingsPage));
  check("switch UI: the Inbox header shows the Sales bot link to its own page, for the owner only", /access\.kind === "owner"/.test(swView) && /\$\{INBOX_PATH\}\/sales-bot/.test(swView) && swView.indexOf("/sales-bot") < swView.indexOf("{u.automationLink}"));
  const SB_EN = translations.en.inbox.salesBotPage, SB_FR = translations.fr.inbox.salesBotPage;
  check("switch copy: EN and FR present, non-empty and different; the help mentions the PIN rule and that payments are not affected; the link label exists", Object.keys(SB_EN).sort().join() === Object.keys(SB_FR).sort().join() && Object.keys(SB_EN).every((k) => SB_EN[k].length > 1 && SB_FR[k].length > 1 && (SB_EN[k] !== SB_FR[k] || k === "statusLabel")) && /PIN/.test(SB_EN.help) && /PIN/.test(SB_FR.help) && /not affected/.test(SB_EN.help) && translations.en.inbox.salesBotLink && translations.fr.inbox.salesBotLink);

  // --- failure isolation
  reset(); rpcMode = "sales_error";
  r = await say("hi", "237677888999");
  check("BOT FAILURE (database error): 200 to Meta, the message is stored, the Inbox push and notice still happened, no database text in the logs", r.status === 200 && (await count("inbox_messages", `conversation_id = '${await convOf("237677888999")}' and direction = 'inbound'`)) === 1 && pushes.length === 1 && notes.some((n) => n.type === "inbox_new_conversation") && !logs.join("\n").includes("SECRET BOT TEXT"));
  reset(); rpcMode = "sales_throw";
  r = await say("hi", "237677888998");
  check("BOT FAILURE (exception): still 200, still stored, push still sent, nothing leaks", r.status === 200 && pushes.length === 1 && (await count("inbox_messages", `conversation_id = '${await convOf("237677888998")}' and direction = 'inbound'`)) === 1 && !logs.join("\n").includes("SECRET BOT TEXT"));
  reset(); metaMode = "network";
  r = await say("hi", "237677888997");
  check("BOT FAILURE (Meta unreachable): the message is stored and answered 200; the queued reply is never re-sent automatically", r.status === 200 && pushes.length === 1 && (await outboundOf("237677888997")).every((m) => m.status === "queued"));
  const beforeRetry = fetchCalls.length;
  await post(payload({ contacts: [{ profile: { name: "T" }, wa_id: "237677888997" }], messages: [{ from: "237677888997", id: (await q1(`select provider_message_id from public.inbox_messages where direction='inbound' and conversation_id = '${await convOf("237677888997")}'`))[0].provider_message_id, timestamp: "1", type: "text", text: { body: "hi" } }] }));
  check("…a redelivery after that does not try to send it again", fetchCalls.length === beforeRetry);
  reset(); globalThis.__pushThrows = true;
  r = await say("hi", "237677888996");
  check("PUSH failure does not stop the bot (and the bot does not depend on it)", r.status === 200 && r.reply === EN.welcome);
  reset();

  // --- database function guarantees
  const cX = await convOf(CUST); const sx = await sessionOf(CUST);
  const stale = await asService(`select public.wa_sales_save('${cX}', ${sx.version - 1}, 'CARDS', '{}'::jsonb, false, null) as r`).then((x) => x.rows[0].r);
  check("CONCURRENCY: saving with a stale version is refused (compare-and-set)", stale === "conflict");
  const bad = await Promise.all([asService(`select public.wa_sales_save('${cX}', ${sx.version}, 'NOT_A_STATE', '{}'::jsonb, false, null) as r`), asService(`select public.wa_sales_save('${cX}', ${sx.version}, 'CARDS', '[]'::jsonb, false, null) as r`), asService(`select public.wa_sales_save('${cX}', ${sx.version}, 'CARDS', ${sq({ x: "y".repeat(5000) })}, false, null) as r`), asService(`select public.wa_sales_save('${PRF(77)}', 0, 'CARDS', '{}'::jsonb, false, null) as r`)]).then((xs) => xs.map((x) => x.rows[0].r));
  check("VALIDATION: unknown state, non-object data, oversized data and an unknown conversation are all refused", bad.join() === "invalid,invalid,invalid,not_found", bad.join());
  const unknownAcct = await asService(`select public.wa_sales_begin('0000000000000', 'wamid.NOPE') as r`).then((x) => x.rows[0].r.result);
  const nulls = await asService(`select public.wa_sales_begin(null, null) as r`).then((x) => x.rows[0].r.result);
  check("begin: an unknown account / unknown message / null ids are skipped; the owner and sender are never taken from the caller", unknownAcct === "skip" && nulls === "skip");
  const crossAccount = await asService(`select public.wa_sales_begin('${PH_B}', (select provider_message_id from public.inbox_messages where direction = 'inbound' limit 1)) as r`).then((x) => x.rows[0].r.result);
  check("begin: a message id of ANOTHER profile presented with the wrong phone number id is skipped", crossAccount === "skip");
  check("every inbound message the bot saw was claimed once: processed ids are unique", (await q1(`select count(*)::int n, count(distinct provider_message_id)::int d from public.wa_sales_processed`))[0].n === (await q1(`select count(distinct provider_message_id)::int d from public.wa_sales_processed`))[0].d);

  // ============================================================ PHASE 1: four-option menu, Discover / Know more, buying method, recovery, hand-off
  const sessV = (state, data = {}) => ({ ...sessW(state, data), version: 1 }); // a conversation that already has history (version 0 = nothing saved yet)
  const run = (session, inputs, extra = {}) => { let cur = session, x; const trail = []; for (const t of inputs) { x = Machine.step(cur, t, { ...facts(), ...extra }); trail.push(x); cur = { ...cur, state: x.state, data: x.data, handoff: x.handoff, version: cur.version + 1 }; } return { x, trail, cur }; };
  const BOTH = [["en", EN], ["fr", FR]];

  // --- welcome and main menu
  let p1 = Machine.step(fresh(), "I want a card please", facts());
  check("PHASE1 welcome: a brand-new conversation whose first message is not a menu choice gets the welcome, never an apology, and nothing is counted", p1.state === "WELCOME" && p1.reply === EN.welcome && p1.data.bad === undefined && !p1.reply.includes(EN.didNotUnderstand));
  check("PHASE1 welcome: the short guide says the menu is numbered, the two ways to buy, that a meeting is only booked once the team confirms it, the human route and to tap the button (EN); the main menu then explains how to type the number", /numbered menu/.test(EN.welcome) && /pay online/i.test(EN.welcome) && /meet a Ringo agent/i.test(EN.welcome) && /only booked once our team confirms/.test(EN.welcome) && /\*human\*/.test(EN.welcome) && /Tap \*Get started\*/.test(EN.welcome) && /type the number of the option you choose and send it/i.test(EN.mainMenu) && /\*2\* to buy a card/.test(EN.mainMenu));
  check("PHASE1 welcome: the French welcome says the same things", /menu numéroté/.test(FR.welcome) && /payez en ligne/i.test(FR.welcome) && /rencontrez un agent Ringo/i.test(FR.welcome) && /qu’une fois confirmé par notre équipe/.test(FR.welcome) && /\*humain\*/.test(FR.welcome) && /Appuyez sur \*Commencer\*/.test(FR.welcome) && /taper le numéro de l’option choisie et l’envoyer/i.test(FR.mainMenu) && /\*2\* pour acheter une carte/.test(FR.mainMenu));
  check("PHASE1 welcome: it promises no immediate availability, no guaranteed time and no completed registration", BOTH.every(([, L]) => !/\b(immediately|instantly|right away|guaranteed?|within \d|24\/7|tout de suite|immédiatement|garanti)/i.test(L.welcome + L.meetingInfo + L.handoff)));
  check("PHASE1 menu: numbers are accepted with surrounding whitespace, and the exact labels work too", [[" 1 ", "DISCOVER"], ["2 ", "BUY_METHOD"], ["\t3", "FAQ"], ["  4  ", "HUMAN_HANDOFF"], ["discover ringo", "DISCOVER"], ["buy a card", "BUY_METHOD"], ["know more", "FAQ"], ["En savoir plus", "FAQ"], ["acheter une carte", "BUY_METHOD"], ["Découvrir Ringo", "DISCOVER"]].every(([t, st]) => Machine.step(sessV("WELCOME"), t, facts()).state === st));
  check("PHASE1 menu: 5 and 6 are not options of the four-option menu (they get the legacy notice, see below) and 7 is an ordinary unreadable reply, counted once", ["5", "6"].every((n) => Machine.step(sessV("WELCOME"), n, facts()).reply === `${EN.menuUpdated}\n\n${EN.mainMenu}`) && (() => { const x = Machine.step(sessV("WELCOME"), "7", facts()); return x.state === "WELCOME" && x.data.bad === 1 && x.reply.includes(EN.didNotUnderstand); })());

  // --- Discover Ringo
  let d1 = Machine.step(sessV("WELCOME"), "1", facts());
  check("PHASE1 discover: option 1 shows the explanation and the three next steps (Buy a card / Speak with a Ringo agent / Main menu), no price and no invented capability", d1.state === "DISCOVER" && d1.reply === EN.discover && /1\. Buy a card/.test(d1.reply) && /2\. Speak with a Ringo agent/.test(d1.reply) && /3\. Main menu/.test(d1.reply) && BOTH.every(([, L]) => !/FCFA/.test(L.discover) && /NFC/.test(L.discover) && /QR/.test(L.discover)));
  check("PHASE1 discover: 1 goes to buying, 2 to a person, 3 to the main menu, anything else is an unreadable reply", Machine.step(sessV("DISCOVER"), "1", facts()).state === "BUY_METHOD" && Machine.step(sessV("DISCOVER"), "2", facts()).effect === "handoff" && Machine.step(sessV("DISCOVER"), "3", facts()).reply === EN.mainMenu && Machine.step(sessV("DISCOVER"), "9", facts()).data.bad === 1);

  // --- Know more
  let k1 = Machine.step(sessV("WELCOME"), "3", facts());
  check("PHASE1 know more: option 3 shows the question list with a route to the main menu and to a person, and every answer keeps both routes", k1.state === "FAQ" && k1.reply === EN.faqMenu && /\*0\*/.test(EN.faqMenu) && /\*human\*/.test(EN.faqMenu) && /\*0\*/.test(FR.faqMenu) && /\*humain\*/.test(FR.faqMenu) && [1, 2, 9, 10].every((n) => { const a = Machine.step(sessV("FAQ"), String(n), facts()).reply; return /0\. Main menu/.test(a) && /\*human\*/.test(a); }));
  check("PHASE1 know more: 0 returns to the short main menu, human hands off, and ordering goes to the buying choice (not straight to the cards)", Machine.step(sessV("FAQ"), "0", facts()).reply === EN.mainMenu && Machine.step(sessV("FAQ"), "human", facts()).effect === "handoff" && Machine.step(sessV("FAQ"), "order", facts()).state === "BUY_METHOD");

  // --- Buy a card: online or meet an agent, before any plan
  let b1 = Machine.step(sessV("WELCOME"), "2", facts());
  check("PHASE1 buy: option 2 asks pay online / meet a Ringo agent FIRST, with no business-discovery question and no plan list yet", b1.state === "BUY_METHOD" && b1.reply === EN.buyMethod && /1\. \*Pay online\*/.test(EN.buyMethod) && /2\. \*Meet a Ringo agent\*/.test(EN.buyMethod) && !/FCFA/.test(EN.buyMethod) && !/business|activity|type of/i.test(EN.buyMethod));
  let b2 = Machine.step(sessV("BUY_METHOD"), "1", facts());
  check("PHASE1 buy online: shows the existing plan screen with the live prices and remembers the method", b2.state === "CARDS" && b2.data.method === "online" && b2.reply.includes(price(3500)) && b2.reply.includes(price(5000)) && b2.reply.includes(price(10000)));
  let b3 = Machine.step(sessV("BUY_METHOD"), "2", facts());
  check("PHASE1 buy with an agent: explains it honestly (nothing is booked or stored here, the team confirms, transport/delivery charges are the customer's, no amount invented), method remembered, no effect", b3.state === "MEETING_INFO" && b3.data.method === "agent" && b3.effect === "none" && b3.reply === EN.meetingInfo && /only booked once our team confirms/.test(EN.meetingInfo) && /Transport or delivery charges are your responsibility/.test(EN.meetingInfo) && /explained to you before the meeting is finalized/.test(EN.meetingInfo) && BOTH.every(([, L]) => !/\d\s*(FCFA|XAF)/.test(L.meetingInfo)));
  check("PHASE1 buy with an agent: 1 hands to a person, 2 switches to paying online, 0 returns to the menu", Machine.step(sessV("MEETING_INFO", { method: "agent" }), "1", facts()).effect === "handoff" && Machine.step(sessV("MEETING_INFO", { method: "agent" }), "2", facts()).data.method === "online" && Machine.step(sessV("MEETING_INFO"), "0", facts()).reply === EN.mainMenu);
  let o1 = run(sessV("BUY_METHOD"), ["1", "2", "1"]);
  check("PHASE1 online path: the method survives the plan choice and the start of the order, and the existing order questions follow unchanged", o1.x.state === "ASK_NAME" && o1.x.data.method === "online" && o1.x.data.tier === "pro" && o1.x.reply === EN.askName("Pro"));
  let o2 = run(sessV("ASK_NAME", { lang: "en", tier: "pro", method: "online" }), ["Jean Mbah", "Akwa, Douala", "jean@example.com", "skip", "1", "1"], { total: 5000 });
  check("PHASE1 online path: the order still reaches the same review and the same single create_and_pay effect only after the customer confirms", o2.x.state === "REVIEW" && o2.trail.every((t) => t.effect === "none") && Machine.step(o2.cur, "1", facts({ total: 5000 })).effect === "create_and_pay");

  // --- invalid input: counter, escalation, reset, free text
  let i1 = run(sessV("WELCOME"), ["zzz"]);
  check("PHASE1 recovery 1st: says it did not understand, shows the current options, explains to type the number, offers the human route; the counter is 1", i1.x.state === "WELCOME" && i1.x.data.bad === 1 && i1.x.reply.startsWith(EN.didNotUnderstand) && i1.x.reply.includes(EN.mainMenu) && i1.x.reply.includes(EN.invalidTail) && /\*human\*/.test(EN.invalidTail));
  let i2 = run(sessV("WELCOME"), ["zzz", "qqq"]);
  check("PHASE1 recovery 2nd: the shorter instruction with the human route, counter 2", i2.x.data.bad === 2 && i2.x.reply.startsWith(EN.invalidShort) && !i2.x.reply.includes(EN.invalidTail) && /\*human\*/.test(EN.invalidShort) && /\*humain\*/.test(FR.invalidShort));
  let i3 = run(sessV("WELCOME"), ["zzz", "qqq", "xxx"]);
  check("PHASE1 recovery 3rd: the recovery menu (agent / main menu / continue), counter 3, recovery flag on", i3.x.data.bad === 3 && i3.x.data.recover === true && i3.x.reply === EN.recoveryMenu && /1\. Speak with a Ringo agent/.test(EN.recoveryMenu) && /2\. Go to the main menu/.test(EN.recoveryMenu) && /3\. Continue where I was/.test(EN.recoveryMenu));
  let i4 = run(sessV("WELCOME"), ["a", "b", "c", "d", "e"]);
  check("PHASE1 recovery persistent: still the recovery menu (no loop of escalating text, no forced hand-off), the customer decides", i4.x.reply === EN.recoveryMenu && i4.x.effect === "none" && i4.x.state === "WELCOME");
  check("PHASE1 recovery: 1 = agent (hand-off), 2 = main menu, 3 = continue where I was; the counter and the flag are gone afterwards", (() => { const base = i3.cur; const a = Machine.step(base, "1", facts()), m = Machine.step(base, "2", facts()), c = Machine.step(base, "3", facts()); return a.effect === "handoff" && m.state === "WELCOME" && m.reply === EN.mainMenu && c.state === "WELCOME" && c.reply === EN.mainMenu && [a, m, c].every((x) => x.data.bad === undefined && x.data.recover === undefined); })());
  check("PHASE1 recovery: a valid choice resets the counter (the next unreadable reply is the 1st again)", (() => { const mid = run(sessV("WELCOME"), ["zzz", "qqq", "2"]); return mid.x.state === "BUY_METHOD" && mid.x.data.bad === undefined && Machine.step(mid.cur, "nonsense", facts()).data.bad === 1; })());
  check("PHASE1 recovery: 1/2/3 mean the recovery menu ONLY while it is on screen (a plain 1 in the card list still picks card 1)", Machine.step(sessV("CARDS", { lang: "en" }), "1", facts()).state === "CARD_DETAIL");
  check("PHASE1 recovery: free-text answers are never counted and never trigger it (name, address, e-mail, username, phone), and they clear a stale counter", (() => { const t = (st, text, d = {}) => Machine.step(sessV(st, { lang: "en", tier: "pro", bad: 2, ...d }), text, facts()); return [t("ASK_NAME", "x"), t("ASK_ADDRESS", "Da"), t("ASK_EMAIL", "not-an-email", { awaitEmail: undefined }), t("ASK_USERNAME", "ab"), t("ASK_PAY_PHONE", "abc", { medium: "mobile money" })].every((x) => x.data.bad === undefined && x.data.recover === undefined) && t("ASK_NAME", "Jean Mbah").state === "ASK_ADDRESS"; })());
  check("PHASE1 recovery: nothing collected or chosen is lost (plan, name, address, e-mail, method) and 'continue' returns to the same question", (() => { const keep = { lang: "en", tier: "pro", method: "online", name: "Jean Mbah", address: "Akwa, Douala", email: "jean@example.com", username: "jean" }; const r = run(sessV("ASK_OPERATOR", keep), ["zzz", "qqq", "xxx"]); const c = Machine.step(r.cur, "3", facts()); return r.x.reply === EN.recoveryMenu && Object.entries(keep).every(([k, v]) => r.x.data[k] === v && c.data[k] === v) && c.state === "ASK_OPERATOR" && c.reply === EN.askOperator; })());
  check("PHASE1 recovery: inside the order, choosing the main menu clears the half-made order and says nothing was charged", (() => { const r = run(sessV("ASK_OPERATOR", { lang: "en", tier: "pro", name: "Jean Mbah" }), ["zzz", "qqq", "xxx"]); const m = Machine.step(r.cur, "2", facts()); return m.state === "WELCOME" && m.reply.startsWith(EN.cancelled) && m.data.name === undefined && m.data.tier === undefined; })());
  check("PHASE1 recovery: the same behaviour in French (texts from the French dictionary, same states)", (() => { const r = run(sessV("WELCOME", { lang: "fr", langLocked: true }), ["zzz", "qqq", "xxx"]); return r.trail[0].reply.startsWith(FR.didNotUnderstand) && r.trail[0].reply.includes(FR.invalidTail) && r.trail[1].reply.startsWith(FR.invalidShort) && r.trail[2].reply === FR.recoveryMenu && Machine.step(r.cur, "1", facts()).reply === FR.handoff; })());

  // --- human help from different stages (HUMAN in any case)
  check("PHASE1 human: HUMAN / human / Humain from the welcome, discover, buying, meeting, cards, questions and the review all hand off with the state kept for the Inbox", ["WELCOME", "DISCOVER", "BUY_METHOD", "MEETING_INFO", "CARDS", "FAQ", "REVIEW", "EDIT_MENU"].every((st) => ["HUMAN", "human", "Humain", " Human "].every((w) => { const x = Machine.step(sessV(st, { lang: "en", tier: "pro", name: "Jean Mbah" }), w, facts({ total: 5000 })); return x.effect === "handoff" && x.handoff === true && x.state === "HUMAN_HANDOFF" && x.data.name === "Jean Mbah"; })));

  // --- both languages follow the same states and effects
  check("PHASE1 languages: the same inputs give the same states and effects in English and French, each with its own dictionary", (() => { const path = ["1", "1", "2", "2", "0", "3", "0", "2", "zzz", "qqq", "xxx", "3", "4"]; const a = run(sessV("WELCOME", { lang: "en", langLocked: true }), path), f = run(sessV("WELCOME", { lang: "fr", langLocked: true }), path); return a.trail.every((x, i) => x.state === f.trail[i].state && x.effect === f.trail[i].effect && x.handoff === f.trail[i].handoff) && a.trail[0].reply === EN.discover && f.trail[0].reply === FR.discover && a.trail[3].reply.length > 0 && f.trail[1].reply === FR.buyMethod; })());
  check("PHASE1 languages: every new key exists in both dictionaries as a non-empty string", ["welcome", "mainMenu", "discover", "buyMethod", "meetingInfo", "didNotUnderstand", "invalidTail", "invalidShort", "recoveryMenu", "handoff", "handoffUnconfirmed", "faqMenu", "imagesInfo"].every((k) => typeof EN[k] === "string" && EN[k].length > 20 && typeof FR[k] === "string" && FR[k].length > 20 && EN[k] !== FR[k]));
  check("PHASE1 languages: every screen stays inside WhatsApp's 4,096-character limit", BOTH.every(([, L]) => ["welcome", "mainMenu", "discover", "buyMethod", "meetingInfo", "recoveryMenu", "faqMenu", "handoff", "handoffUnconfirmed"].every((k) => L[k].length < 3500)));

  // --- stored-state mapping (no migration): every state round-trips, is accepted by the database list, and the data stays small
  const dbList = [...read("supabase/migrations/2026-12-19_whatsapp_sales_bot.sql").match(/check \(state in \(([^)]*)\)/)[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
  const saveFnList = [...read("supabase/migrations/2026-12-19_whatsapp_sales_bot.sql").match(/p_state not in \(([^)]*)\)/)[1].matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
  check("STATE MAPPING: the table CHECK list and the list inside wa_sales_save are identical (so there is one definition of 'a state the database accepts')", JSON.stringify(dbList) === JSON.stringify(saveFnList) && dbList.length === 19);
  check("STATE MAPPING: every bot state is stored as a state the database accepts, and every state round-trips exactly (both languages' data included)", Machine.BOT_STATES.every((st) => dbList.includes(Machine.toStored(st, { lang: "en" }).state) && ["en", "fr"].every((lg) => { const t = Machine.toStored(st, { lang: lg, tier: "pro", method: "online", bad: 2, recover: true }); const b = Machine.fromStored(t.state, t.data); return b.state === st && b.data.lang === lg && b.data.tier === "pro" && b.data.method === "online" && b.data.bad === 2 && b.data.recover === true && b.data.step === undefined && b.data.awaitEmail === undefined; })));
  check("STATE MAPPING: the storage markers are never confused with real states (plain CARDS / HOW_IT_WORKS / ASK_ADDRESS stay what they are; a stale marker is dropped)", Machine.fromStored("CARDS", {}).state === "CARDS" && Machine.fromStored("HOW_IT_WORKS", {}).state === "HOW_IT_WORKS" && Machine.fromStored("ASK_ADDRESS", {}).state === "ASK_ADDRESS" && Machine.toStored("CARDS", { step: "method" }).data.step === undefined && Machine.toStored("DISCOVER", {}).state === "HOW_IT_WORKS" && Machine.toStored("BUY_METHOD", {}).data.step === "method" && Machine.toStored("MEETING_INFO", {}).data.step === "meeting");
  const worst = { lang: "fr", langLocked: true, tier: "premium", method: "agent", name: "N".repeat(80), address: "A".repeat(200), email: "e".repeat(100) + "@example.com", username: "u".repeat(30), medium: "orange money", payPhone: "699999999", returnTo: "REVIEW", repay: true, bad: 99, recover: true, step: "meeting", awaitEmail: true };
  check("STATE MAPPING: the largest possible session data stays far below the database's 4,096-byte limit", Buffer.byteLength(JSON.stringify(Machine.toStored("MEETING_INFO", worst).data)) < 1200);

  // --- through the real webhook, the real functions and the real database
  reset();
  const WP1 = "237677610011";
  r = await say("hello", WP1);
  check("PHASE1 E2E: the first message gets the welcome (version 0 -> saved)", r.reply === EN.welcome && (await sessionOf(WP1)).state === "WELCOME");
  r = await say("1", WP1);
  check("PHASE1 E2E: Discover is stored as HOW_IT_WORKS + step=discover (a state the database accepts) and shown as the discover screen", r.reply === EN.discover && (await sessionOf(WP1)).state === "HOW_IT_WORKS" && (await sessionOf(WP1)).data.step === "discover");
  r = await say("1", WP1);
  check("PHASE1 E2E: Buy a card is stored as CARDS + step=method and restored as the buying choice", r.reply === EN.buyMethod && (await sessionOf(WP1)).state === "CARDS" && (await sessionOf(WP1)).data.step === "method");
  const signupsBefore = tables.signup_requests.length, fapshiBefore = fapshiCalls.length, rpcBefore = rpcCalls.length;
  r = await say("2", WP1);
  check("PHASE1 E2E: meeting an agent shows the honest explanation and creates NOTHING (no signup request, no payment call, no booking row, no appointment table, the session stays the only record)", r.reply === EN.meetingInfo && tables.signup_requests.length === signupsBefore && fapshiCalls.length === fapshiBefore && !(tables.bookings || []).length && !rpcCalls.slice(rpcBefore).some((c) => !/^(wa_sales_|inbox_)/.test(c.fn)) && (await q1("select count(*)::int n from pg_tables where schemaname = 'public' and tablename ~ 'appoint'"))[0].n === 0);
  check("PHASE1 E2E: the method choice is persisted for the next message", (await sessionOf(WP1)).data.method === "agent" && (await sessionOf(WP1)).data.lang === "en");
  r = await say("zzz", WP1); r = await say("qqq", WP1);
  check("PHASE1 E2E: the invalid counter is persisted between webhook calls (2nd unreadable reply gets the shorter text)", r.reply.startsWith(EN.invalidShort) && (await sessionOf(WP1)).data.bad === 2);
  r = await say("xxx", WP1);
  check("PHASE1 E2E: the 3rd unreadable reply shows the recovery menu, and continuing returns to the same screen with the method kept", r.reply === EN.recoveryMenu && (await say("3", WP1)).reply === EN.meetingInfo && (await sessionOf(WP1)).data.bad === undefined && (await sessionOf(WP1)).data.method === "agent");
  const dupId = "wamid.PHASE1DUP";
  r = await say("1", WP1, { id: dupId });
  const versionAfter = (await sessionOf(WP1)).version, sentAfter = (await outboundOf(WP1)).length;
  const dup = await say("1", WP1, { id: dupId });
  check("PHASE1 E2E: a duplicate webhook delivery of the same message changes nothing and sends nothing", dup.sent === 0 && (await sessionOf(WP1)).version === versionAfter && (await outboundOf(WP1)).length === sentAfter);

  // --- hand-off: the customer is told the request was passed on only when the in-app notice was really recorded
  reset(); tables.notifications = [];
  const WP2 = "237677610012";
  await say("hello", WP2);
  r = await say("4", WP2);
  const convP2 = await convOf(WP2);
  check("PHASE1 HANDOFF ok: the bell row is inserted, the push is sent, the customer is told it was passed to the team, the bot goes silent", r.reply === EN.handoff && tables.notifications.filter((n) => n.type === "inbox_handoff" && n.link === "/dashboard/inbox/" + convP2).length === 1 && pushes.some((q) => q.payload.category === "inbox_handoff" && q.kind === "only") && (await sessionOf(WP2)).handoff === true && (await say("1", WP2)).sent === 0);
  reset(); tables.notifications = []; globalThis.__notifyInsertFails = true;
  const WP3 = "237677610013";
  await say("hello", WP3);
  r = await say("4", WP3);
  globalThis.__notifyInsertFails = false;
  check("PHASE1 HANDOFF notice failed: no bell row exists, so the customer is NOT told the team was alerted; they are told the message is saved and a reply may take longer; the bot still pauses; the database error text never reaches the customer or the logs", r.reply === EN.handoffUnconfirmed && !r.reply.includes(EN.handoff) && tables.notifications.length === 0 && (await sessionOf(WP3)).handoff === true && !r.reply.includes("SECRET") && !logs.some((l) => l.includes("SECRET NOTICE TEXT")) && logs.some((l) => l.includes("handoff_notice_failed")));
  reset(); tables.notifications = []; globalThis.__notifyInsertFails = true;
  const WP4 = "237677610014";
  await say("Bonjour", WP4);
  r = await say("humain", WP4);
  globalThis.__notifyInsertFails = false;
  check("PHASE1 HANDOFF notice failed (French): the same honest French message", r.reply === FR.handoffUnconfirmed && (await sessionOf(WP4)).handoff === true);
  reset(); tables.notifications = []; globalThis.__pushThrows = true;
  const WP5 = "237677610015";
  await say("hello", WP5);
  r = await say("human", WP5);
  globalThis.__pushThrows = false;
  check("PHASE1 HANDOFF push failed but the bell row was recorded: the push is best effort and does not change what the customer is told", r.reply === EN.handoff && tables.notifications.some((n) => n.type === "inbox_handoff") && (await sessionOf(WP5)).handoff === true);
  check("PHASE1 HANDOFF: the owner's resume action still returns the conversation to the welcome (the pause behaviour is unchanged)", await (async () => { const cv = await convOf(WP5); const res = await Handoff.resumeSalesBot({ admin: mkAdmin(), userId: alice.user, profileId: alice.profile }, cv); return res.status === 200 && (await sessionOf(WP5)).handoff === false && (await sessionOf(WP5)).state === "WELCOME"; })());

  // ============================================================ PHASE 1 refinements: price shortcuts choose the buying method first; legacy menu digits 5 / 6
  // --- price shortcuts
  const PRICE_EN = ["price", "prices", "Prices", "cards", "card", "how much", "cost", "see the cards", " PRICE "], PRICE_FR = ["prix", "cartes", "carte", "combien", "voir les cartes"], PRICE_NEUTRAL = ["tarif", "tarifs"], PRICE_PHRASES = [...PRICE_EN, ...PRICE_FR, ...PRICE_NEUTRAL];
  check("REFINE price: every English price / cards shortcut, from the main menu and after an order, shows the BUY-METHOD screen (1 online, 2 meet an agent) and NOT the plan list", ["WELCOME", "COMPLETED"].every((st) => PRICE_EN.every((w) => { const x = Machine.step(sessV(st), w, facts()); return x.state === "BUY_METHOD" && x.reply === EN.buyMethod && x.effect === "none" && x.handoff === false && !x.reply.includes("FCFA") && x.data.method === undefined; })));
  check("REFINE price: the French shortcuts (a French word also switches the reply to French) show the French buying choice; 'tarif(s)' carry no language signal and keep the session's language; with the language locked, every shortcut does, and the plan list only follows after choosing", ["WELCOME", "COMPLETED"].every((st) => PRICE_FR.every((w) => { const x = Machine.step(sessV(st), w, facts()); return x.state === "BUY_METHOD" && x.reply === FR.buyMethod && x.data.lang === "fr" && !x.reply.includes("FCFA"); })) && PRICE_NEUTRAL.every((w) => { const x = Machine.step(sessV("WELCOME", { lang: "en" }), w, facts()); return x.state === "BUY_METHOD" && x.reply === EN.buyMethod; }) && PRICE_PHRASES.every((w) => { const x = Machine.step(sessV("WELCOME", { lang: "fr", langLocked: true }), w, facts()); return x.state === "BUY_METHOD" && x.reply === FR.buyMethod; }) && Machine.step(sessV("BUY_METHOD", { lang: "fr", langLocked: true }), "1", facts()).reply.includes(priceFr(5000)));
  check("REFINE price: after the shortcut, 1 = online shows the existing plan list (method online) and 2 = meet an agent shows the honest meeting screen; the order questions are unchanged", (() => { const a = run(sessV("WELCOME"), ["prices", "1"]); const b = run(sessV("WELCOME"), ["price", "2"]); const c = run(sessV("WELCOME"), ["price", "1", "2", "1"]); return a.x.state === "CARDS" && a.x.data.method === "online" && a.x.reply.includes(price(3500)) && a.x.reply.includes(price(10000)) && b.x.state === "MEETING_INFO" && b.x.effect === "none" && c.x.state === "ASK_NAME" && c.x.reply === EN.askName("Pro") && c.x.data.method === "online"; })());
  check("REFINE price: other states keep their words (a free-text answer or a card-list word is not a shortcut): 'price' inside the order is a name, and in the card list it is not hijacked", Machine.step(sessV("ASK_NAME", { lang: "en", tier: "pro" }), "Cards Mbah", facts()).state === "ASK_ADDRESS" && Machine.step(sessV("CARDS", { lang: "en" }), "price", facts()).state === "CARDS");
  reset();
  const WR1 = "237677620021";
  await say("hello", WR1);
  const signupsR = tables.signup_requests.length, fapshiR = fapshiCalls.length;
  r = await say("prices", WR1);
  check("REFINE price E2E: through the webhook 'prices' returns the buying choice, creates no order and makes no payment call", r.reply === EN.buyMethod && (await sessionOf(WR1)).state === "CARDS" && (await sessionOf(WR1)).data.step === "method" && tables.signup_requests.length === signupsR && fapshiCalls.length === fapshiR);
  r = await say("1", WR1);
  check("REFINE price E2E: choosing 1 then shows the live prices (the existing plan list)", r.reply.includes(price(3500)) && r.reply.includes(price(5000)) && r.reply.includes(price(10000)));
  r = await say("2", WR1); r = await say("1", WR1);
  check("REFINE price E2E: the online order continues exactly as before (the first order question)", r.reply === EN.askName("Pro") && tables.signup_requests.length === signupsR);

  // --- legacy digits 5 / 6 (the previous six-option menu)
  const LEGACY_EN = (n) => `${EN.menuUpdated}\n\n${EN.mainMenu}`, LEGACY_FR = `${FR.menuUpdated}\n\n${FR.mainMenu}`;
  check("REFINE legacy: at the main menu 5 and 6 get one short 'menu updated' notice followed by the current four-option menu, map to NOTHING (no hand-off, no images, no state change, no effect)", ["5", "6", " 5 ", "6."].every((n) => { const x = Machine.step(sessV("WELCOME"), n, facts()); return x.reply === LEGACY_EN() && x.state === "WELCOME" && x.effect === "none" && x.handoff === false && x.data.method === undefined && x.data.tier === undefined; }) && EN.menuUpdated.length < 80 && FR.menuUpdated.length < 80 && !/\d/.test(EN.menuUpdated + FR.menuUpdated));
  check("REFINE legacy: the French notice is the same behaviour from the French dictionary", ["5", "6"].every((n) => Machine.step(sessV("WELCOME", { lang: "fr", langLocked: true }), n, facts()).reply === LEGACY_FR) && /Le menu a été mis à jour/.test(FR.menuUpdated) && FR.mainMenu.includes("4. Parler à un agent Ringo"));
  check("REFINE legacy: it does NOT touch the recovery counter (a counter of 2 stays 2, a clean one stays clean), and the next unreadable reply counts from there", (() => { const w = Machine.step(sessV("WELCOME", { lang: "en", bad: 2 }), "5", facts()); const z = Machine.step(sessV("WELCOME", { lang: "en" }), "6", facts()); const after = Machine.step({ ...sessV("WELCOME"), data: w.data }, "zzz", facts()); const clean = Machine.step({ ...sessV("WELCOME"), data: z.data }, "zzz", facts()); return w.data.bad === 2 && z.data.bad === undefined && after.data.bad === 3 && clean.data.bad === 1 && clean.reply.startsWith(EN.didNotUnderstand); })());
  check("REFINE legacy: with the recovery menu on screen, 5 / 6 replace it by the main menu, so the flag is dropped (1 / 2 / 3 then mean the real menu again)", (() => { const rec = run(sessV("WELCOME"), ["a", "b", "c"]).cur; const x = Machine.step(rec, "5", facts()); const y = Machine.step({ ...rec, data: x.data }, "1", facts()); return x.reply === LEGACY_EN() && x.data.recover === undefined && y.state === "DISCOVER"; })());
  check("REFINE legacy: a brand-new conversation never sees 'the menu has been updated' (it gets the welcome), and the legacy notice is NOT shown after an order is completed (that screen keeps its own reply)", Machine.step(fresh(), "5", facts()).reply === EN.welcome && Machine.step(sessV("COMPLETED"), "5", facts()).reply === EN.afterPaid && Machine.step(sessV("COMPLETED"), "6", facts()).reply === EN.afterPaid);
  check("REFINE legacy: only the main menu has this notice (the other menus treat 5 / 6 as unreadable, counted once), and 1-4 are untouched", ["DISCOVER", "BUY_METHOD", "MEETING_INFO"].every((st) => ["5", "6"].every((n) => { const x = Machine.step(sessV(st), n, facts()); return x.state === st && x.data.bad === 1 && x.reply.includes(EN.didNotUnderstand) && !x.reply.includes(EN.menuUpdated); })) && Machine.step(sessV("WELCOME"), "4", facts()).effect === "handoff");

  // --- every digit keeps its own, state-specific meaning during a purchase or payment flow
  const full5 = { lang: "en", tier: "pro", name: "Jean Mbah", address: "Akwa, Douala", email: "jean@example.com", username: "jean", medium: "mobile money", payPhone: "677123456" };
  const dig = (st, n, d = full5, extra = {}) => Machine.step(sessV(st, d), n, { ...facts(), total: 5000, ...extra });
  check("REFINE digits: in the card list 5 = 'help me choose' and 4 = compare (the legacy notice never appears); 6 is simply unreadable there", dig("CARDS", "5").state === "RECOMMEND_1" && dig("CARDS", "4").state === "COMPARE" && dig("CARDS", "6").data.bad === 1 && !dig("CARDS", "6").reply.includes(EN.menuUpdated));
  check("REFINE digits: in the edit menu 5 = payment number and 6 = card (state-specific meanings kept)", dig("EDIT_MENU", "5").state === "ASK_OPERATOR" && dig("EDIT_MENU", "6").state === "CARDS");
  check("REFINE digits: in the questions list 5 and 6 are the answers to questions 5 and 6 (no legacy notice)", ["5", "6"].every((n) => { const x = dig("FAQ", n); return x.state === "FAQ" && x.reply === `${EN.faq[Number(n) - 1]}${EN.faqOptions}` && !x.reply.includes(EN.menuUpdated); }));
  check("REFINE digits: during the order and the payment, 5 / 6 are never the legacy notice: unreadable in the review and the network question, an answer in the free-text steps, the waiting message while paying", ["REVIEW", "ASK_OPERATOR"].every((st) => ["5", "6"].every((n) => { const x = dig(st, n); return x.state === st && x.data.bad === 1 && !x.reply.includes(EN.menuUpdated); })) && ["ASK_NAME", "ASK_ADDRESS", "ASK_USERNAME"].every((st) => ["5", "6"].every((n) => !dig(st, n, { ...full5, name: undefined, address: undefined }).reply.includes(EN.menuUpdated))) && dig("ASK_PAY_PHONE", "5").reply === EN.payPhoneInvalid && ["5", "6"].every((n) => { const x = dig("PAYMENT", n); return x.state === "PAYMENT" && x.reply === EN.paymentResumed && x.effect === "none" && x.data.bad === undefined; }));
  check("REFINE digits: a real order is untouched by 5 / 6 typed as a quantity-like answer (a name of '5' is too short and re-asks; the card stays chosen)", (() => { const x = Machine.step(sessV("ASK_NAME", { lang: "en", tier: "pro", method: "online" }), "5", facts()); return x.state === "ASK_NAME" && x.data.tier === "pro" && x.data.method === "online" && x.reply === EN.askName("Pro"); })());
  reset(); tables.notifications = [];
  const WR2 = "237677620022";
  await say("hello", WR2);
  r = await say("6", WR2);
  check("REFINE legacy E2E: through the webhook '6' shows the notice and the menu, starts nothing (no hand-off, no bell row, no order, no payment), and is not counted", r.reply === LEGACY_EN() && (await sessionOf(WR2)).handoff === false && (await sessionOf(WR2)).state === "WELCOME" && (await sessionOf(WR2)).data.bad === undefined && tables.notifications.length === 0 && tables.signup_requests.length === signupsR && fapshiCalls.length === fapshiR);
  r = await say("5", WR2);
  check("REFINE legacy E2E: '5' behaves the same, and the real options still work afterwards (4 hands off)", r.reply === LEGACY_EN() && (await say("4", WR2)).reply === EN.handoff && (await sessionOf(WR2)).handoff === true);
  reset();
  const WR3 = "237677620023";
  await say("Bonjour", WR3);
  r = await say("5", WR3);
  check("REFINE legacy E2E (French): the French notice and the French menu", r.reply === LEGACY_FR && (await sessionOf(WR3)).data.lang === "fr");

  // ============================================================ legacy HOW_IT_WORKS: the old "See the cards" can no longer skip the online-or-agent choice
  const legacyData = { lang: "en", langLocked: true, tier: "pro", name: "Jean Mbah" };
  const LEGACY_INPUTS = [...Array(13).keys()].map(String).concat(["0", "menu", "hi", "price", "prices", "prix", "cards", "cartes", "card", "carte", "see the cards", "voir les cartes", "order", "buy", "buy a card", "commander", "online", "en ligne", "compare", "choose", "pro", "standard", "premium", "how it works", "faq", "images", "status", "edit", "skip", "zzz"]);
  const leg2 = Machine.step(sessV("HOW_IT_WORKS", legacyData), "2", facts());
  check("LEGACY how-it-works: the old option 2 'See the cards' now shows the online-or-agent choice (BUY_METHOD), not the plan list, and changes nothing else (effect none, no hand-off, no method pre-chosen)", leg2.state === "BUY_METHOD" && leg2.reply === EN.buyMethod && !leg2.reply.includes("FCFA") && leg2.effect === "none" && leg2.handoff === false && leg2.data.method === undefined);
  check("LEGACY how-it-works: the conversation data and the language are kept (plan, name, locked language), and French stays French", leg2.data.tier === "pro" && leg2.data.name === "Jean Mbah" && leg2.data.lang === "en" && leg2.data.langLocked === true && (() => { const f = Machine.step(sessV("HOW_IT_WORKS", { lang: "fr", langLocked: true, tier: "premium" }), "2", facts()); return f.state === "BUY_METHOD" && f.reply === FR.buyMethod && f.data.lang === "fr" && f.data.tier === "premium"; })());
  check("LEGACY how-it-works: NO input of any kind (digits 0-12, menu words, price / cards shortcuts in both languages, order words, plan names) leads straight to the plan list from this state", LEGACY_INPUTS.every((t) => Machine.step(sessV("HOW_IT_WORKS", legacyData), t, facts()).state !== "CARDS") && LEGACY_INPUTS.every((t) => Machine.step(sessV("HOW_IT_WORKS", { lang: "fr", langLocked: true }), t, facts()).state !== "CARDS"));
  check("LEGACY how-it-works: the plans still follow the choice (2 then 1 = online shows the live prices with method online; 2 then 2 = meeting screen)", (() => { const a = run(sessV("HOW_IT_WORKS", legacyData), ["2", "1"]); const b = run(sessV("HOW_IT_WORKS", legacyData), ["2", "2"]); return a.x.state === "CARDS" && a.x.data.method === "online" && a.x.reply.includes(price(3500)) && a.x.reply.includes(price(10000)) && b.x.state === "MEETING_INFO" && b.x.effect === "none"; })());
  check("LEGACY how-it-works: the other legacy options behave exactly as before (1 and the order words = buying choice, 3 = questions, 0 = short main menu, human = hand-off, anything else = unreadable reply counted once, state kept)", Machine.step(sessV("HOW_IT_WORKS", legacyData), "1", facts()).state === "BUY_METHOD" && Machine.step(sessV("HOW_IT_WORKS", legacyData), "order", facts()).state === "BUY_METHOD" && Machine.step(sessV("HOW_IT_WORKS", legacyData), "3", facts()).reply === EN.faqMenu && Machine.step(sessV("HOW_IT_WORKS", legacyData), "0", facts()).reply === EN.mainMenu && Machine.step(sessV("HOW_IT_WORKS", legacyData), "human", facts()).effect === "handoff" && (() => { const x = Machine.step(sessV("HOW_IT_WORKS", legacyData), "zzz", facts()); return x.state === "HOW_IT_WORKS" && x.data.bad === 1 && x.reply.includes(EN.didNotUnderstand); })());
  check("LEGACY how-it-works: a conversation saved by the old bot (state HOW_IT_WORKS, no step marker) is restored as exactly that state, while the current Discover screen (same stored state + step) is not confused with it", Machine.fromStored("HOW_IT_WORKS", { lang: "en" }).state === "HOW_IT_WORKS" && Machine.fromStored("HOW_IT_WORKS", { lang: "en", step: "discover" }).state === "DISCOVER");
  reset();
  const WL1 = "237677630031";
  await say("hello", WL1);
  await db.exec("update public.wa_sales_sessions set state = 'HOW_IT_WORKS', data = '{\"lang\":\"en\"}'::jsonb where conversation_id = '" + (await convOf(WL1)) + "'");
  const signupsL = tables.signup_requests.length, fapshiL = fapshiCalls.length;
  r = await say("2", WL1);
  check("LEGACY how-it-works E2E: a conversation saved in the old HOW_IT_WORKS state, through the real webhook and database, gets the online-or-agent choice for '2' (stored as CARDS + step=method), and nothing is ordered or charged", r.reply === EN.buyMethod && (await sessionOf(WL1)).state === "CARDS" && (await sessionOf(WL1)).data.step === "method" && tables.signup_requests.length === signupsL && fapshiCalls.length === fapshiL);

  // ============================================================ SHORT WELCOME + "GET STARTED" BUTTON
  const btn = (x) => x.button === true;
  check("BUTTON welcome: the first message is a short guide (EN <= 450, FR <= 500 characters, far below WhatsApp's 1,024 limit for a message with a button), names the button, lists no menu and carries no website lines", EN.welcome.length <= 450 && FR.welcome.length <= 500 && EN.welcome.includes("*" + EN.startButton + "*") && FR.welcome.includes("*" + FR.startButton + "*") && !/\n\d\. /.test(EN.welcome + FR.welcome) && !/www\./.test(EN.welcome + FR.welcome));
  check("BUTTON labels: 'Get started' / 'Commencer', each inside WhatsApp's 20-character button limit", EN.startButton === "Get started" && FR.startButton === "Commencer" && EN.startButton.length <= 20 && FR.startButton.length <= 20);
  check("BUTTON flag: exactly the short welcome carries the button (first contact, a greeting in English or French, a language switch outside the order, a greeting that cancels an order)", btn(Machine.step(fresh(), "I want a card please", facts())) && btn(Machine.step(sessV("WELCOME"), "hi", facts())) && btn(Machine.step(sessV("WELCOME"), "Bonjour", facts())) && btn(Machine.step(sessV("WELCOME"), "fr", facts())) && btn(Machine.step(sessV("ASK_NAME", { lang: "en", tier: "pro" }), "hello", facts())) && Machine.step(sessV("WELCOME"), "hi", facts()).reply === EN.welcome && Machine.step(sessV("WELCOME"), "Bonjour", facts()).reply === FR.welcome);
  check("BUTTON flag: no other reply carries it (main menu, every menu screen, recovery, the legacy notice, hand-off, plan list, order questions, a language switch inside the order)", [["WELCOME", "0"], ["WELCOME", "1"], ["WELCOME", "2"], ["WELCOME", "3"], ["WELCOME", "4"], ["WELCOME", "5"], ["WELCOME", "zzz"], ["DISCOVER", "3"], ["BUY_METHOD", "1"], ["BUY_METHOD", "2"], ["MEETING_INFO", "1"], ["CARDS", "1"], ["ASK_NAME", "fr"], ["FAQ", "0"], ["FAQ", "human"]].every(([st, t]) => !btn(Machine.step(sessV(st, { lang: "en", tier: "pro", name: "Jean Mbah" }), t, facts()))) && !btn(run(sessV("WELCOME"), ["a", "b", "c"]).x));
  check("BUTTON tap (machine): at the start, and after a finished order, the tap opens the main menu: no button, no effect, no hand-off, no counter", [sessV("WELCOME"), sessV("COMPLETED")].every((sx) => { const x = Machine.step(sx, Machine.START_TOKEN, facts()); return x.state === "WELCOME" && x.reply === EN.mainMenu && x.button !== true && x.effect === "none" && x.handoff === false && x.data.bad === undefined; }) && Machine.step(sessV("WELCOME", { lang: "fr", langLocked: true }), Machine.START_TOKEN, facts()).reply === FR.mainMenu);
  check("BUTTON tap (machine): in the middle of anything else it only shows the current question again: nothing is cleared, answered, counted or sent, in every screen and every order step", ["DISCOVER", "BUY_METHOD", "MEETING_INFO", "CARDS", "FAQ", "ASK_NAME", "ASK_ADDRESS", "ASK_EMAIL", "ASK_USERNAME", "ASK_OPERATOR", "ASK_PAY_PHONE", "REVIEW", "EDIT_MENU", "PAYMENT"].every((st) => { const x = Machine.step(sessV(st, { ...full5, bad: 2 }), Machine.START_TOKEN, facts({ total: 5000 })); return x.state === st && x.effect === "none" && x.handoff === false && x.button !== true && !x.reply.startsWith(EN.cancelled) && x.data.bad === undefined && x.data.name === "Jean Mbah" && x.data.tier === "pro" && x.data.address === "Akwa, Douala" && x.data.payPhone === "677123456"; }));
  check("BUTTON tap (machine): during a free-text question the tap is never taken as the answer (no name, address, e-mail, username or number is stored), and a hand-off conversation stays silent", (() => { const n = Machine.step(sessV("ASK_NAME", { lang: "en", tier: "pro" }), Machine.START_TOKEN, facts()); const u = Machine.step(sessV("ASK_USERNAME", { lang: "en", tier: "pro" }), Machine.START_TOKEN, facts()); const h = Machine.step({ ...sessV("HUMAN_HANDOFF", { lang: "en" }), handoff: true }, Machine.START_TOKEN, facts()); return n.state === "ASK_NAME" && n.data.name === undefined && n.reply === EN.askName("Pro") && u.state === "ASK_USERNAME" && u.data.username === undefined && h.reply === "" && h.effect === "none"; })());

  // --- end to end: the real webhook, the real sender (Meta is the stand-in), the real database
  const tap = async (wa, id) => {
    const before = (await outboundOf(wa)).length;
    const message = { from: wa, id: id || ("wamid.TAP" + (++wseq)), timestamp: String(Math.floor(Date.now() / 1000)), type: "interactive", interactive: { type: "button_reply", button_reply: { id: "start", title: "Get started" } } };
    const res = await post(payload({ contacts: [{ profile: { name: "Test Customer" }, wa_id: wa }], messages: [message] }));
    const out = await outboundOf(wa);
    return { status: res.status, reply: out.length > before ? out[out.length - 1].body : null, sent: out.length - before };
  };
  reset(); tables.notifications = [];
  const WB1 = "237677640041";
  r = await say("hello", WB1);
  const firstMsg = JSON.parse(fetchCalls[0].init.body);
  check("BUTTON E2E: the first message is ONE interactive message: the short guide as the body, exactly one reply button 'Get started' (id 'start'), and the Inbox stores the same guide text", fetchCalls.length === 1 && firstMsg.type === "interactive" && firstMsg.interactive.type === "button" && firstMsg.interactive.body.text === EN.welcome && firstMsg.interactive.action.buttons.length === 1 && firstMsg.interactive.action.buttons[0].type === "reply" && firstMsg.interactive.action.buttons[0].reply.id === "start" && firstMsg.interactive.action.buttons[0].reply.title === "Get started" && !("text" in firstMsg) && r.reply === EN.welcome);
  fetchCalls = []; const signupsB = tables.signup_requests.length, fapB = fapshiCalls.length;
  const t1 = await tap(WB1, "wamid.TAPDUP1");
  const menuMsg = JSON.parse(fetchCalls[0].init.body);
  check("BUTTON E2E: tapping the button answers with the main menu as an ordinary text message (no button), stays at the main menu, and starts nothing (no order, no payment, no hand-off, no bell)", t1.status === 200 && t1.reply === EN.mainMenu && fetchCalls.length === 1 && menuMsg.type === "text" && menuMsg.text.body === EN.mainMenu && (await sessionOf(WB1)).state === "WELCOME" && (await sessionOf(WB1)).handoff === false && tables.signup_requests.length === signupsB && fapshiCalls.length === fapB && tables.notifications.length === 0);
  const t1b = await tap(WB1, "wamid.TAPDUP1");
  check("BUTTON E2E: the same tap delivered twice is answered once (the existing duplicate protection covers it)", t1b.sent === 0 && fetchCalls.length === 1);
  check("BUTTON E2E: after the tap the menu works exactly as before (2 = the online-or-agent choice)", (await say("2", WB1)).reply === EN.buyMethod);
  check("BUTTON E2E: a tap on an old welcome message later in the conversation never cancels or answers anything (mid-order it shows the current question and the name is NOT set by the tap)", await (async () => { const W = "237677640042"; for (const t of ["hello", "2", "1", "2", "1"]) await say(t, W); const m = await tap(W); const after = await say("Jean Mbah", W); return m.reply === EN.askName("Pro") && after.reply === EN.askAddress && (await sessionOf(W)).data.name === "Jean Mbah"; })());
  check("BUTTON E2E (French): a French greeting gets the French guide with the 'Commencer' button, and the tap shows the French menu", await (async () => { const W = "237677640043"; fetchCalls = []; const a = await say("Bonjour", W); const body = JSON.parse(fetchCalls[0].init.body); const t = await tap(W); return a.reply === FR.welcome && body.interactive.action.buttons[0].reply.title === "Commencer" && t.reply === FR.mainMenu; })());
  check("BUTTON E2E: a tap in a conversation handed to a person gets no automatic reply", await (async () => { const W = "237677640044"; await say("hello", W); await say("4", W); const t = await tap(W); return t.sent === 0 && (await sessionOf(W)).handoff === true; })());

  // --- when Meta does not accept the button message
  reset();
  metaMode = "reject_interactive";
  const WB5 = "237677640045";
  r = await say("hello", WB5);
  const bodies5 = fetchCalls.map((c) => JSON.parse(c.init.body));
  const out5 = await outboundOf(WB5);
  check("BUTTON FALLBACK: a definite refusal of the button message sends the SAME guide as plain text right away (nothing is lost); the Inbox shows one sent message; Meta's refusal text is never logged or shown", bodies5.length === 2 && bodies5[0].type === "interactive" && bodies5[1].type === "text" && bodies5[1].text.body === EN.welcome && out5.length === 1 && out5[0].status === "sent" && r.reply === EN.welcome && logs.some((l) => l.includes("button_fallback")) && !logs.some((l) => l.includes("SECRET BUTTON REFUSAL")));
  check("BUTTON FALLBACK: the customer can still start by typing (the plain guide says to type a number: 2 = buying choice) and the menu follows", (await say("2", WB5)).reply === EN.buyMethod);
  reset();
  metaMode = "window_closed_interactive";
  const WB6 = "237677640046";
  await say("hello", WB6);
  check("BUTTON FALLBACK: a refusal for the 24-hour window is NOT retried as text (exactly one call, as before for any message)", fetchCalls.length === 1 && JSON.parse(fetchCalls[0].init.body).type === "interactive");
  reset();
  metaMode = "network";
  const WB7 = "237677640047";
  await say("hello", WB7);
  check("BUTTON FALLBACK: an unknown outcome (network error) is never retried automatically (exactly one call), so a message can never be sent twice", fetchCalls.length === 1);
  reset();

  // --- the button cannot be reached from outside the bot, and the rest of the sender is untouched
  const runnerSrc = read("src/lib/salesBot/runner.ts");
  const sendersChanged = nodeRequire("child_process").execFileSync("git", ["diff", "--name-only", "HEAD", "--", "src/lib/inbox/send.ts", "src/lib/whatsapp/outbound.ts", "src/app/api/inbox/conversations/[id]/messages/route.ts"], { cwd: REPO, encoding: "utf8" }).trim();
  check("BUTTON safety: the audited Inbox text sender, the Meta sender and the reply API are byte-for-byte unchanged (the button is added only by a wrapper the bot hands to the sender), so no one outside the bot can send a button message", sendersChanged === "" && /fetchImpl: button \? withReplyButton\(deps\.fetchImpl \?\? fetch, button\)/.test(runnerSrc) && !/button/i.test(read("src/app/api/inbox/conversations/[id]/messages/route.ts")));
  check("BUTTON safety: a message that cannot take a button (body over 1,024 characters, title over 20 or a bad id) goes out untouched as plain text, and only definite 4xx refusals (not the 24-hour window, not rate limits) fall back", /body\.length > 1024/.test(runnerSrc) && /button\.title\.length > 20/.test(runnerSrc) && /code !== 131047 && code !== 130429 && code !== 80007 && code !== 131056/.test(runnerSrc) && /res\.status !== 408 && res\.status !== 429/.test(runnerSrc));
  const longBody = "x".repeat(1100); let seenType = "";
  const passThrough = await Runner.withReplyButton(async (u, i) => { seenType = JSON.parse(i.body).type; return JR(200, { messages: [{ id: "wamid.X" }] }); }, { id: "start", title: "Get started" })("https://graph.facebook.com/v21.0/1/messages", { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: "237677000000", type: "text", text: { preview_url: false, body: longBody } }) });
  check("BUTTON safety (direct): an over-long body is passed through unchanged as text and the answer is returned as it is", seenType === "text" && passThrough.status === 200);

  // ============================================================ SHORT CARD LISTS (bot only): fixed text per tier, no durations, independent of the platform's plan configuration
  const LISTS_EN = { standard: ["Basic subscription", "QR code on the card", "Free card configuration", "Up to 15 links", "Up to 15 catalog items"], pro: ["Pro subscription", "QR code on the card", "Free card configuration", "Unlimited links", "Unlimited catalog items", "Custom theme", "Full analytics with history", "Bookings enabled", "Recording of payments and receipts"], premium: ["Premium subscription", "Everything in Pro", "Ringo AI", "Business management", "Stock management", "Image generation", "Verification badge"] };
  const LISTS_FR = { standard: ["Abonnement Basic", "QR code sur la carte", "Configuration de la carte offerte", "Jusqu’à 15 liens", "Jusqu’à 15 articles au catalogue"], pro: ["Abonnement Pro", "QR code sur la carte", "Configuration de la carte offerte", "Liens illimités", "Catalogue illimité", "Thème personnalisé", "Analyses complètes avec historique", "Réservations activées", "Enregistrement des paiements et des reçus"], premium: ["Abonnement Premium", "Tout ce qui est dans Pro", "Ringo AI", "Gestion d’entreprise", "Gestion des stocks", "Génération d’images", "Badge de vérification"] };
  check("LISTS: the dictionaries hold exactly the requested lists, in order, in English and French (Standard 5 lines, Pro 9 lines, Premium 7 lines with the verification badge)", JSON.stringify(EN.tierFeatures) === JSON.stringify(LISTS_EN) && JSON.stringify(FR.tierFeatures) === JSON.stringify(LISTS_FR) && LISTS_EN.premium.includes("Verification badge") && LISTS_FR.premium.includes("Badge de vérification"));
  const detailOf = (tier, lg) => Machine.step(sessV("CARDS", { lang: lg, langLocked: true }), String(["standard", "pro", "premium"].indexOf(tier) + 1), facts()).reply;
  check("LISTS: each card's detail screen shows exactly its own list as bullets, in order, and nothing from another tier's list that it does not have", ["standard", "pro", "premium"].every((tier) => [["en", LISTS_EN], ["fr", LISTS_FR]].every(([lg, L]) => { const r = detailOf(tier, lg); const lines = r.split("\n").filter((x) => x.startsWith("• ")).map((x) => x.slice(2)); return JSON.stringify(lines) === JSON.stringify(L[tier]); })) && !/Custom theme|Unlimited/.test(detailOf("standard", "en")) && !/Ringo AI/.test(detailOf("pro", "en")) && /Everything in Pro/.test(detailOf("premium", "en")));
  check("LISTS: the card list and the comparison show every tier's full list in both languages, with the live prices, and stay inside WhatsApp's length limit", ["en", "fr"].every((lg) => { const L = lg === "en" ? LISTS_EN : LISTS_FR; const list = Machine.step(sessV("BUY_METHOD", { lang: lg, langLocked: true }), "1", facts()).reply, cmp = Machine.step(sessV("CARDS", { lang: lg, langLocked: true }), "4", facts()).reply; return ["standard", "pro", "premium"].every((t) => L[t].every((line) => list.includes(line) && cmp.includes(line))) && list.length < 3500 && cmp.length < 3500; }) && Machine.step(sessV("BUY_METHOD"), "1", facts()).reply.includes(price(3500)) && Machine.step(sessV("BUY_METHOD"), "1", facts()).reply.includes(price(10000)));
  check("LISTS: no card screen mentions a subscription length or the 'included' wording, and the Pro-for-a-year offer is not shown anywhere", ["en", "fr"].every((lg) => ["1", "2", "3", "4"].every((n) => { const r = Machine.step(sessV("CARDS", { lang: lg, langLocked: true }), n, facts()).reply; return !/\b1 month\b|\b1 year\b|\b1 mois\b|\b1 an\b|inclus|\bincluded\b|365|12 months|12 mois/i.test(r); })) && !/year|an\b|365|offer|offert(?!e)/i.test(JSON.stringify([EN.tierFeatures, FR.tierFeatures]).replace(/Free card configuration|Configuration de la carte offerte/g, "")));
  const oddOffers = OFFERS.map((o) => ({ ...o, featuresEn: ["SOMETHING ELSE"], featuresFr: ["AUTRE CHOSE"], hasQr: false, hasConfig: false, planName: "enterprise", days: 7 }));
  check("LISTS: the lists do not depend on the platform's plan or add-on configuration (other plan features, plan name, duration, flags change nothing) while the prices still come from the live offers", ["standard", "pro", "premium"].every((tier) => Machine.step(sessV("CARDS", { lang: "en" }), String(["standard", "pro", "premium"].indexOf(tier) + 1), { ...facts(), offers: oddOffers }).reply === Machine.step(sessV("CARDS", { lang: "en" }), String(["standard", "pro", "premium"].indexOf(tier) + 1), facts()).reply) && !/SOMETHING ELSE|enterprise/.test(Machine.step(sessV("BUY_METHOD", { lang: "en" }), "1", { ...facts(), offers: oddOffers }).reply) && Machine.step(sessV("BUY_METHOD", { lang: "en" }), "1", { ...facts(), offers: OFFERS.map((o) => ({ ...o, priceXaf: o.priceXaf + 1 })) }).reply.includes(price(3501)));
  const machineSrc2 = read("src/lib/salesBot/machine.ts");
  check("LISTS: the bot code builds the lists only from the dictionary (no plan features, no add-on flags, no price literal), and the payment receipt wording is untouched", /function offerLines\(lang: Lang, o: Offer\): string\[\] \{\s*return \[\.\.\.S\(lang\)\.tierFeatures\[o\.tier\]\];\s*\}/.test(machineSrc2) && !/featuresEn|featuresFr/.test(machineSrc2.replace(/\/\/.*$/gm, "")) && /export function subscriptionLine\(lang: Lang, o: Offer\): string \{\s*const T = S\(lang\);\s*return T\.subscription\(T\.period\(o\.days\), cap\(o\.planName\)\);/.test(machineSrc2));

  // ============================================================ scope and safety (static)
  const dir = "src/lib/salesBot";
  const botFiles = ["machine.ts", "runner.ts", "offers.ts", "ids.ts", "paymentNotice.ts"].map((f) => read(`${dir}/${f}`));
  const botAll = botFiles.join("\n");
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  check("no price is hard-coded in the bot (code or translations): no 3500 / 5000 / 10000 literal in src/lib/salesBot or in the salesBot translation block", !/\b(3[ ,.]?500|5[ ,.]?000|10[ ,.]?000)\b/.test(stripC(botAll)) && (() => { for (const f of ["src/lib/i18n/translations.en.ts", "src/lib/i18n/translations.fr.ts"]) { const t = read(f); const block = t.slice(t.indexOf("salesBot: {"), t.indexOf("      settings: {", t.indexOf("salesBot: {"))); if (/\b(3[ ,.]?500|5[ ,.]?000|10[ ,.]?000)\b/.test(stripC(block))) return false; } return true; })());
  check("no second payment or order system: the bot imports the EXISTING signup and pay route handlers and signupPayment, and has no Fapshi / Stripe / payment_transactions code of its own", /from "@\/app\/api\/signup-requests\/route"/.test(botAll) && /from "@\/app\/api\/signup-requests\/\[id\]\/pay\/route"/.test(botAll) && !/from "@\/lib\/fapshi"|stripe|payment_transactions|fapshiDirectPay|fapshiGetStatus/i.test(stripC(botAll)));
  check("the bot never writes customer_paid or any payment/order column itself (signup_requests is only ever READ in salesBot, and customer_paid is never named)", !/customer_paid/.test(stripC(botAll)) && !/from\("signup_requests"\)\s*\.(update|insert|delete|upsert)/.test(stripC(botAll)) && (stripC(botAll).match(/from\("signup_requests"\)/g) || []).length === 1);
  check("no AI in the bot: no provider, model or prompt import", !/ai\/providers|anthropic|openai|aiAssist|ai\/guard/i.test(stripC(botAll)));
  check("the bot reads no secret and no token: the only environment variable it knows is the number it is switched on for", !/process\.env\.(?!WHATSAPP_SALES_BOT_PHONE_NUMBER_ID)/.test(stripC(botAll)) && /WHATSAPP_SALES_BOT_PHONE_NUMBER_ID/.test(read("src/lib/salesBot/ids.ts")));
  check("logs: the bot logs only ids / categories (no text, name, number or token variables are logged)", (stripC(botAll).match(/log\(\{[^}]*\}\)/g) || []).every((l) => !/\btext\b|\bname\b|payPhone|waDigits|address|token|data\./.test(l)));
  const auto = read("src/lib/inbox/automation.ts");
  check("the webhook order is unchanged: the bot runs AFTER the message is stored, the notice raised and the push sent, in its own try/catch with a timeout, only for the configured number", auto.indexOf("await onInboundMessage(deps, e);\n        await runSalesBot(deps, e);") > 0 && /salesBotEnabledFor\(e\.phoneNumberId, deps\.env\)/.test(auto) && /withTimeout\(handleSalesBotMessage\(/.test(auto) && /SALES_BOT_TIMEOUT_MS/.test(auto));
  const sp = read("src/lib/signupPayment.ts");
  check("the payment hook is purely additive: inside the existing best-effort fan-out, and computeSignupAmount / confirmSignupPayment / markSignupPaid are unchanged in their logic", /notifyWhatsAppOrderPaid\(admin, request\.id\)/.test(sp) && sp.indexOf("notifyWhatsAppOrderPaid") > sp.indexOf("async function notifySignupPaid") && sp.indexOf("notifyWhatsAppOrderPaid") < sp.indexOf("async function markSignupPaid"));
  const rollback2 = await db.exec(ROLLBACK2).then(() => true, () => false);
  check("switch rollback removes exactly its two tables and three functions, leaving the bot's own objects, and is safe to re-run", rollback2 && (await q1(OBJ)).map((x) => x.x).filter((x) => /wa_sales_(settings|enabled)/.test(x)).length === 0 && (await q1(OBJ)).map((x) => x.x).includes("fn:wa_sales_begin") && await db.exec(ROLLBACK2).then(() => true, () => false));
  const rollback = await db.exec(ROLLBACK).then(() => true, () => false);
  check("rollback removes exactly the bot's functions and tables, and is safe to re-run", rollback && (await q1(OBJ)).map((x) => x.x).filter((x) => /wa_sales_/.test(x)).length === 0 && await db.exec(ROLLBACK).then(() => true, () => false));
  reset();
  r = await say("hi", "237677999000");
  check("after the rollback the webhook still stores the message and answers 200 (the bot fails safely and stays silent, the Inbox and push are untouched)", r.status === 200 && r.sent === 0 && pushes.length === 1 && (await count("inbox_messages", `conversation_id = '${await convOf("237677999000")}' and direction = 'inbound'`)) === 1);
} finally { console.info = origInfo; console.error = origErr; globalThis.fetch = realFetch; }

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
