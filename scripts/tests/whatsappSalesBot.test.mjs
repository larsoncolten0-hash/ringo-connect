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
  tables.plans = [];
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
  s = Machine.step(fresh(), "1", facts());
  check("CARD_SELECTION: option 1 lists the three cards with the prices from the add-ons", s.state === "CARDS" && s.reply.includes(price(3500)) && s.reply.includes(price(5000)) && s.reply.includes(price(10000)) && s.reply.includes("Standard") && s.reply.includes("Pro") && s.reply.includes("Premium"), s.reply);
  check("CARD_SELECTION: the card lines show the real subscription difference (1 month Basic / 1 month Pro / 1 year Basic) and the included extras", s.reply.includes("1 month Basic subscription included") && s.reply.includes("1 month Pro subscription included") && s.reply.includes("1 year Basic subscription included") && s.reply.includes(EN.qrIncluded) && s.reply.includes(EN.configIncluded));
  const picks = [["1", "standard", 3500, "1 month Basic"], ["2", "pro", 5000, "1 month Pro"], ["3", "premium", 10000, "1 year Basic"]];
  for (const [n, tier, amount, line] of picks) {
    const d = Machine.step(fresh("CARDS"), n, facts());
    check(`${tier.toUpperCase()} selection: card detail with its price and subscription, then the order options`, d.state === "CARD_DETAIL" && d.data.tier === tier && d.reply.includes(price(amount)) && d.reply.includes(line) && /1\. 🛒 Order this card/.test(d.reply), d.reply);
  }
  check("selecting by name works (pro)", Machine.step(fresh("CARDS"), "Pro", facts()).data.tier === "pro");
  s = Machine.step(fresh("CARDS"), "4", facts());
  check("compare: all three side by side, saying the difference is the subscription", s.state === "COMPARE" && s.reply.includes(price(3500)) && s.reply.includes(price(10000)) && /subscription that comes with it/.test(s.reply));
  s = Machine.step(fresh("HOW_IT_WORKS"), "xyz", facts());
  check("HOW IT WORKS: option 2 from the welcome", Machine.step(fresh(), "2", facts()).state === "HOW_IT_WORKS" && /no app, no login/.test(Machine.step(fresh(), "2", facts()).reply));
  const faq = (n) => Machine.step(fresh("FAQ"), String(n), facts());
  check("FAQ: answers are fixed, factual and in the product's own words (NFC tap, no app, QR fallback, what is included, how to pay)", /NFC-enabled phone/.test(faq(2).reply) && /No\. Your Ringo profile opens in the phone's browser/.test(faq(3).reply) && /scan the QR code/.test(faq(4).reply) && /QR code that opens the same/.test(faq(5).reply) && /basic contact info is also stored directly on the card/.test(faq(6).reply) && /Mobile Money/.test(faq(10).reply) && /Never send your PIN/.test(faq(10).reply));
  check("FAQ: 'what's included' is built from the real offers", faq(9).reply.includes("Standard: 1 month Basic subscription included") && faq(9).reply.includes("Premium: 1 year Basic subscription included") && faq(9).reply.includes(EN.qrIncluded));
  check("FAQ: no invented claims (no delivery time, no guarantee, no shipping promise, no price in the fixed answers)", EN.faq.concat(FR.faq).every((a) => !/\b(days?|jours?|hours?|heures?|guarantee|garantie|free delivery|livraison gratuite|warranty)\b/i.test(a) && !/\d{1,3}[ ,]\d{3}\s*FCFA/.test(a)));
  let r1 = Machine.step(fresh("RECOMMEND_1"), "2", facts());
  check("RECOMMENDATION: a full year -> Premium", r1.state === "CARD_DETAIL" && r1.data.tier === "premium" && r1.reply.includes(price(10000)));
  r1 = Machine.step(Machine.step(fresh("RECOMMEND_1"), "1", facts()), "1", facts());
  r1 = Machine.step(fresh("RECOMMEND_2"), "1", facts());
  check("RECOMMENDATION: a month with Pro -> Pro; a month with Basic -> Standard", r1.data.tier === "pro" && Machine.step(fresh("RECOMMEND_2"), "2", facts()).data.tier === "standard");
  check("RECOMMENDATION: falls back to a tier that exists when the first choice is not offered", Machine.step(fresh("RECOMMEND_1"), "2", { ...facts(), offers: OFFERS.filter((o) => o.tier !== "premium") }).data.tier === "standard");
  check("no offers at all: the bot says the card cannot be ordered here and offers a person, instead of inventing one", Machine.step(fresh(), "1", { ...facts(), offers: [] }).reply === EN.unavailable);

  // order collection
  const d0 = { lang: "en", tier: "pro" };
  s = Machine.step(fresh("CARD_DETAIL", d0), "1", facts());
  check("ORDER_START: ordering a card asks for the name", s.state === "ASK_NAME" && s.reply === EN.askName("Pro"));
  s = Machine.step(fresh("ASK_NAME", d0), "J", facts());
  check("validation: a one-letter name is not accepted", s.state === "ASK_NAME");
  s = Machine.step(fresh("ASK_NAME", d0), "  Jean   Mbah ", facts());
  check("name is cleaned and the address is asked next", s.state === "ASK_ADDRESS" && s.data.name === "Jean Mbah");
  check("validation: a too-short address is refused; a real one moves on to the username question", Machine.step(fresh("ASK_ADDRESS", d0), "Dla", facts()).state === "ASK_ADDRESS" && Machine.step(fresh("ASK_ADDRESS", d0), "Akwa, Douala", facts()).state === "ASK_USERNAME");
  check("username: 'skip' continues without one", (() => { const x = Machine.step(fresh("ASK_USERNAME", d0), "skip", facts()); return x.state === "ASK_OPERATOR" && !x.data.username; })());
  check("username: under 3 characters is refused (the same minimum as the admin review)", Machine.step(fresh("ASK_USERNAME", d0), "ab", facts()).reply === EN.usernameShort);
  check("username: taken is refused with the name echoed", Machine.step(fresh("ASK_USERNAME", d0), "Taken_Name", facts({ usernameStatus: "taken" })).reply === EN.usernameTaken("taken_name"));
  check("username: same rule as the web form (lowercase; letters, digits and _ only)", Machine.step(fresh("ASK_USERNAME", d0), "John Mbah-1!", facts({ usernameStatus: "ok" })).data.username === "johnmbah1");
  check("username: available is kept and the payment question follows", (() => { const x = Machine.step(fresh("ASK_USERNAME", d0), "johnmbah", facts({ usernameStatus: "ok" })); return x.state === "ASK_OPERATOR" && x.reply.includes(EN.usernameKept("johnmbah")) && x.reply.includes(EN.askOperator); })());
  s = Machine.step(fresh("ASK_OPERATOR", d0), "1", facts());
  check("payment operator: 1 = MTN Mobile Money, then the payment number is asked, offering the verified WhatsApp number (shown only by its last digits)", s.state === "ASK_PAY_PHONE" && s.data.medium === "mobile money" && s.reply.includes("ending 456") && !s.reply.includes(CUST));
  check("payment number: '1' uses the sender's own WhatsApp number; nothing to retype", (() => { const x = Machine.step(fresh("ASK_PAY_PHONE", { ...d0, medium: "mobile money" }), "1", facts()); return x.state === "REVIEW" && x.data.payPhone === "677123456"; })());
  check("payment number: accepts +237 / spaces and normalises it", Machine.step(fresh("ASK_PAY_PHONE", { ...d0, medium: "mobile money" }), "+237 677 12 34 99", facts()).data.payPhone === "677123499");
  check("validation: a PIN-like or malformed number is refused with the never-send-your-PIN warning, nothing stored", ["1234", "4321", "12345678", "abc", "5551234567"].every((t) => { const x = Machine.step(fresh("ASK_PAY_PHONE", { ...d0, medium: "mobile money" }), t, { ...facts(), waDigits: "33612345678" }); return x.state === "ASK_PAY_PHONE" && x.reply === EN.payPhoneInvalid && !x.data.payPhone; }));
  s = Machine.step(fresh("ASK_PAY_PHONE", { ...d0, medium: "orange money" }), "677123456", facts());
  check("validation: a number whose network clearly differs from the chosen one sends the customer back to pick the network again", s.state === "ASK_OPERATOR" && /MTN Mobile Money/.test(s.reply) && !s.data.medium);
  const full = { lang: "en", tier: "pro", name: "Jean Mbah", address: "Akwa, Douala", username: "johnmbah", medium: "mobile money", payPhone: "677123456" };
  s = Machine.step(fresh("REVIEW", full), "xx", facts({ total: 5000 }));
  check("ORDER_REVIEW: confirmation not understood keeps the review", s.state === "REVIEW" && s.reply.includes("Everything correct?"));
  s = Machine.step(fresh("ASK_PAY_PHONE", { ...full, payPhone: undefined }), "1", facts({ total: 5000 }));
  check("ORDER_REVIEW summary: card, price, TOTAL (the figure passed in from the server), name, username, WhatsApp number, delivery address, payment network and last digits only; no delivery fee, no delivery promise", s.state === "REVIEW" && s.reply.includes("Card: Pro") && s.reply.includes(`Price: ${price(5000)}`) && s.reply.includes(`Total: ${price(5000)}`) && s.reply.includes("Name: Jean Mbah") && s.reply.includes("Username: johnmbah") && s.reply.includes(`WhatsApp: +${CUST}`) && s.reply.includes("Delivery: Akwa, Douala") && s.reply.includes("MTN Mobile Money · ending 456") && !/delivery (fee|cost|time)|livraison.*(frais|délai)|within|sous \d/i.test(s.reply) && !s.reply.split("\n").find((l) => l.startsWith("Payment:")).includes("677123456"), s.reply);
  s = Machine.step(fresh("REVIEW", full), "1", facts({ total: 5000 }));
  check("confirming asks the runner to create the order and send the payment request (one effect)", s.state === "CREATING" && s.effect === "create_and_pay");
  check("the total is NEVER computed by the bot: without the server's figure the review cannot be confirmed", Machine.step(fresh("REVIEW", full), "1", facts({ total: null })).effect === "none" && Machine.step(fresh("REVIEW", full), "1", facts()).effect === "none");
  s = Machine.step(fresh("REVIEW", full), "2", facts({ total: 5000 }));
  check("EDIT: the review's edit menu lists what can change, and each choice returns to the review afterwards", s.state === "EDIT_MENU" && (() => { const e1 = Machine.step(s, "2", facts()); const e2 = Machine.step({ ...fresh(), state: e1.state, data: e1.data }, "Bonamoussadi, Douala", facts({ total: 5000 })); return e1.state === "ASK_ADDRESS" && e2.state === "REVIEW" && e2.data.address === "Bonamoussadi, Douala" && e2.data.name === "Jean Mbah"; })());
  check("EDIT: changing the card keeps the other answers and shows the review again", (() => { let x = Machine.step(fresh("EDIT_MENU", full), "5", facts()); x = Machine.step({ ...fresh(), state: x.state, data: x.data }, "3", facts()); x = Machine.step({ ...fresh(), state: x.state, data: x.data }, "1", facts({ total: 10000 })); return x.state === "REVIEW" && x.data.tier === "premium" && x.reply.includes("Card: Premium"); })());
  check("0 = main menu everywhere; inside the order it clears the half-made order", Machine.step(fresh("ASK_ADDRESS", full), "0", facts()).state === "WELCOME" && Object.keys(Machine.step(fresh("ASK_ADDRESS", full), "0", facts()).data).join() === "lang" && Machine.step(fresh("FAQ", d0), "0", facts()).state === "WELCOME");
  check("cancel / annuler / reset behave like 0 and say nothing was charged", ["cancel", "annuler", "reset"].every((w) => Machine.step(fresh("REVIEW", full), w, facts()).reply.startsWith(EN.cancelled)));
  check("language switch: 'fr' / 'en' at any time keeps the place in the order", (() => { const x = Machine.step(fresh("ASK_ADDRESS", full), "fr", facts()); return x.state === "ASK_ADDRESS" && x.data.lang === "fr" && x.reply.includes(FR.askAddress); })());
  const humanWords = ["human", "agent", "support", "representative", "talk to someone", "I want to talk to someone please", "help", "humain", "conseiller", "parler à quelqu'un", "aide"];
  check("HUMAN request: every listed phrase, at any menu state, hands off", humanWords.every((w) => { const x = Machine.step(fresh("CARDS", d0), w, facts()); return x.effect === "handoff" && x.handoff === true && x.state === "HUMAN_HANDOFF"; }));
  check("HUMAN request while giving a free-text answer: a bare request hands off, but an address that merely contains the word does not", Machine.step(fresh("ASK_ADDRESS", full), "human", facts()).effect === "handoff" && Machine.step(fresh("ASK_ADDRESS", full), "Rue du Support, Akwa", facts()).state === "ASK_USERNAME");
  check("HUMAN_HANDOFF: the machine is silent and changes nothing", (() => { const x = Machine.step({ ...fresh("HUMAN_HANDOFF", full), handoff: true }, "1", facts()); return x.reply === "" && x.effect === "none" && x.handoff === true; })());
  check("PAYMENT state: status / resend / change number are the only actions; anything else repeats the waiting message", Machine.step(fresh("PAYMENT", full), "status", facts()).effect === "check_payment" && Machine.step(fresh("PAYMENT", full), "resend", facts()).effect === "resend_payment" && Machine.step(fresh("PAYMENT", full), "edit", facts()).state === "ASK_OPERATOR" && Machine.step(fresh("PAYMENT", full), "hello?", facts()).reply === EN.paymentResumed);
  check("CREATING that never finished (stuck) lets the customer go back to the review; a fresh one just waits", Machine.step(fresh("CREATING", full), "hi", facts({ stuck: true, total: 5000 })).state === "REVIEW" && Machine.step(fresh("CREATING", full), "hi", facts()).reply === EN.creating);
  check("EN and FR salesBot translations have exactly the same keys, every string non-empty (functions return text)", (() => { const k = (o, p = "") => Object.entries(o).flatMap(([key, v]) => (v && typeof v === "object" && !Array.isArray(v) ? k(v, `${p}${key}.`) : [`${p}${key}`])); return k(EN).join() === k(FR).join() && EN.faq.length === FR.faq.length && EN.faq.filter(Boolean).length === FR.faq.filter(Boolean).length; })());

  // ============================================================ end to end through the REAL webhook
  reset();
  let r = await say("Hi");
  const convC = await convOf(CUST);
  check("E2E welcome: a message through the signed webhook is stored (200), and the bot answers in the SAME Inbox conversation with the welcome menu, sent to the customer via Meta", r.status === 200 && r.reply === EN.welcome && (await count("inbox_messages", `conversation_id = '${convC}' and direction = 'inbound'`)) === 1 && fetchCalls.length === 1 && fetchCalls[0].url === `https://graph.facebook.com/v21.0/${PH_A}/messages` && JSON.parse(fetchCalls[0].init.body).to === CUST && JSON.parse(fetchCalls[0].init.body).text.body === EN.welcome, JSON.stringify({ r, f: fetchCalls.length }));
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
  let reply = await flow("1");
  check("E2E: card list from the live add-on prices", reply.includes(price(3500)) && reply.includes(price(5000)) && reply.includes(price(10000)));
  reply = await flow("2");
  check("E2E: Pro selected", reply.includes("*Ringo Connect Smart Card — Pro*") && reply.includes(price(5000)));
  reply = await flow("1");
  check("E2E: ordering asks for the name", reply === EN.askName("Pro"));
  await flow("Jean Mbah");
  reply = await flow("Akwa, Douala");
  check("E2E: the username question follows the address", reply === EN.askUsername);
  reply = await flow("Taken_Name");
  check("E2E: a username that already exists (profiles) is refused, using the same availability source the admin review uses", reply === EN.usernameTaken("taken_name"));
  reply = await flow("jeanmbah");
  check("E2E: an available username is accepted and the network question comes next", reply.includes(EN.usernameKept("jeanmbah")) && reply.includes(EN.askOperator));
  await flow("1");
  reply = await flow("1");
  check("E2E: the sender's own number is reused (not retyped) and the review shows the SERVER's total", reply.includes("Card: Pro") && reply.includes(`Total: ${price(5000)}`) && reply.includes("Username: jeanmbah") && reply.includes(`WhatsApp: +${CUST}`) && reply.includes("Delivery: Akwa, Douala") && !reply.split("\n").find((l) => l.startsWith("Payment:")).includes("677123456"), reply);
  check("E2E: nothing exists yet: no signup request, no payment request before the customer confirms", tables.signup_requests.length === 0 && fapshiCalls.length === 0);
  reply = await flow("1");
  const req = tables.signup_requests[0];
  check("EXISTING ORDER BACKEND: confirming creates ONE signup request through the existing /api/signup-requests handler with the collected data and the Smart Card add-on (the web form's shape)", tables.signup_requests.length === 1 && req.full_name === "Jean Mbah" && req.whatsapp_number === `+${CUST}` && req.suggested_username === "jeanmbah" && req.delivery_location === "Akwa, Douala" && JSON.stringify(req.requested_addon_ids) === JSON.stringify([A_PRO]) && req.requested_plan_id === null && req.email === null && req.status === "pending" && req.customer_paid === false && req.source === "get_started", JSON.stringify(req));
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
  check("CONFIRMATION: the hook messages the customer in WhatsApp with card, amount and a short reference, and the approval next step; no promise of a delivery date", paidMsg === EN.paidNotice("Pro", price(5000), `#${req.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`) && /reviews your request/.test(paidMsg) && !/deliver|livr/i.test(paidMsg), paidMsg);
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
  await say("hello", WA2); await say("1", WA2); await say("1", WA2); await say("1", WA2); await say("Paul Etoa", WA2); await say("Bonamoussadi, Douala", WA2); await say("skip", WA2); await say("2", WA2); await say("1", WA2); await say("1", WA2);
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
  for (const t of ["hi", "1", "3", "1", "Marie Ngo", "Bastos, Yaoundé", "skip", "1", "1"]) await say(t, WA3);
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
  for (const t of ["hi", "1", "1", "1", "Luc Biya", "Mvog-Ada, Yaoundé", "skip", "1", "1"]) await say(t, WA4);
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
  for (const t of ["hi", "1", "2", "1", "Anne Fotso", "Limbe, Fako", "skip", "1", "1"]) await say(t, WA5);
  const reqsBefore5 = tables.signup_requests.length;
  const [ra, rb] = await Promise.all([say("1", WA5), say("1", WA5)]);
  check("RACE: two simultaneous confirmations create exactly ONE signup request and ONE payment request", tables.signup_requests.length === reqsBefore5 + 1 && fapshiCalls.length === 1, JSON.stringify({ reqs: tables.signup_requests.length - reqsBefore5, fapshi: fapshiCalls.length, ra: ra.reply?.slice(0, 40), rb: rb.reply?.slice(0, 40) }));

  // --- French
  reset();
  const WA6 = "237655010203";
  r = await say("Bonjour", WA6);
  check("FR: a French greeting gets the French welcome", r.reply === FR.welcome);
  reply = (await say("1", WA6)).reply;
  check("FR: the card list is French with prices grouped the French way and the real subscriptions", reply.includes(priceFr(5000)) && reply.includes(priceFr(10000)) && reply.includes("Abonnement Pro de 1 mois inclus") && reply.includes("Abonnement Basic de 1 an inclus") && reply.includes("QR code sur la carte"), reply);
  reply = (await say("faq", WA6)).reply;
  reply = (await say("2", WA6)).reply;
  check("FR: the FAQ list works from the cards screen via 'comment ça marche'", true);
  r = await say("en", WA6);
  check("language switch to English mid-conversation", r.reply.startsWith(EN.langSwitched));
  r = await say("fr", WA6); r = await say("0", WA6);
  for (const t of ["1", "3", "1", "Aïcha Bello", "Akwa Nord, Douala", "passer", "2", "1"]) r = await say(t, WA6);
  check("FR: the review is in French, with the French payment network name and 'ending' digits", r.reply.includes("Votre commande Ringo Connect Smart Card") && r.reply.includes("Carte : Premium") && r.reply.includes(`Total : ${priceFr(10000)}`) && r.reply.includes("Orange Money · se terminant par 203"), r.reply);
  r = await say("1", WA6);
  check("FR: the payment instruction is French and the Orange network was used", r.reply === FR.paymentSent("Orange Money", "203") && fapshiCalls.at(-1).medium === "orange money" && fapshiCalls.at(-1).amount === 10000);
  globalThis.__fapshiStatus = "SUCCESSFUL";
  const frReq = tables.signup_requests.at(-1);
  await SignupPay.confirmSignupPayment(mkAdmin(), frReq.id); await new Promise((res) => setTimeout(res, 50));
  const frOut = await outboundOf(WA6);
  check("FR: the payment confirmation is sent in French", frOut.at(-1).body === FR.paidNotice("Premium", priceFr(10000), `#${frReq.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`));

  // --- human hand-off, end to end
  reset();
  const WA7 = "237677777888";
  await say("hello", WA7); await say("1", WA7); await say("1", WA7);
  pushes.length = 0; notes.length = 0;
  r = await say("I want to talk to someone", WA7);
  check("HAND-OFF: the customer is told a person will take over; the session is silenced", r.reply === EN.handoff && (await sessionOf(WA7)).handoff === true && (await sessionOf(WA7)).state === "HUMAN_HANDOFF");
  const conv7 = await convOf(WA7);
  check("HAND-OFF: the Inbox owner gets the existing bell + push (generic text, link to this conversation) in addition to the normal new-message push", pushes.some((p) => p.payload.category === "inbox_handoff" && p.userId === alice.user && p.payload.url === `/dashboard/inbox/${conv7}` && p.payload.title === EN.handoffNoticeTitle && p.kind === "bell"));
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
  await say("hi", WA8); await say("1", WA8);
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
  check("RESUME route: owner-only wrapper, the id comes from the URL, the body is not read, no owner/profile from the request", /withInboxOwner\(request, \(actor\) => resumeSalesBot\(actor, params\.id\)\)/.test(routeSrc) && !/withConversationActor|body\./.test(routeSrc) && !/profile_id|owner_id|p_actor_user_id/.test(routeSrc));
  check("RESUME copy exists in English and French", ["resumeSalesBot", "resumeSalesBotDone", "resumeSalesBotNotPaused", "resumeSalesBotFailed"].every((k) => typeof translations.en.inbox[k] === "string" && typeof translations.fr.inbox[k] === "string" && translations.fr.inbox[k] !== translations.en.inbox[k]));
  check("PAYMENT-SENT copy no longer promises a message 'as soon as' it is confirmed (EN and FR)", !/as soon as/i.test(EN.paymentSent("MTN", "123")) && !/dès (qu|que)/i.test(FR.paymentSent("MTN", "123")) && /try to let you know/.test(EN.paymentSent("MTN", "123")) && /essaierons de vous prévenir/.test(FR.paymentSent("MTN", "123")));

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
  const rollback = await db.exec(ROLLBACK).then(() => true, () => false);
  check("rollback removes exactly the bot's functions and tables, and is safe to re-run", rollback && (await q1(OBJ)).map((x) => x.x).filter((x) => /wa_sales_/.test(x)).length === 0 && await db.exec(ROLLBACK).then(() => true, () => false));
  reset();
  r = await say("hi", "237677999000");
  check("after the rollback the webhook still stores the message and answers 200 (the bot fails safely, the Inbox and push are untouched)", r.status === 200 && pushes.length === 1 && (await count("inbox_messages", `conversation_id = '${await convOf("237677999000")}' and direction = 'inbound'`)) === 1);
} finally { console.info = origInfo; console.error = origErr; globalThis.fetch = realFetch; }

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
