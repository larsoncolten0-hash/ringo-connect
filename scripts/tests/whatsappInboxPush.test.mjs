// Phase A push notifications for the WhatsApp Inbox, end to end: the REAL webhook route (signature, parse, ingest, then automation), the REAL
// automation module, and the REAL database functions (Phase 4 + 7 + 8 + 9 + 10 migrations + the push-claim migration) on scratch in-memory PostgreSQL (PGlite).
// The push senders (src/lib/push/send.ts, withBell.ts) are captured stand-ins: no web-push, no network, no Supabase, no credentials, no production ids.
//   Run:  node scripts/tests/whatsappInboxPush.test.mjs
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
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 500)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");

const React = nodeRequire("react");
const notes = [];
const pushes = []; // { kind: "bell" | "only", userId, payload }
const STUBS = {
  "next/server": { NextResponse: { json: (body, init) => new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } }) } },
  "react": { ...React, cache: (fn) => fn },
  "@/lib/supabase/server": { createClient: () => ({}), createAdminClient: () => globalThis.__admin() },
  "@/lib/notifications": { notifyUser: async (userId, n) => { if (globalThis.__notifyThrows) throw new Error("notify down"); notes.push({ userId, ...n }); } },
  "@/lib/push/withBell": { sendPushAndBellToUser: async (_admin, userId, payload) => { if (globalThis.__pushMode === "throw") throw new Error("push down SECRET PUSH TEXT"); if (globalThis.__pushMode === "hang") return new Promise(() => {}); pushes.push({ kind: "bell", userId, payload }); } },
  "@/lib/push/send": { sendPushToUser: async (_admin, userId, payload) => { if (globalThis.__pushMode === "throw") throw new Error("push down SECRET PUSH TEXT"); if (globalThis.__pushMode === "hang") return new Promise(() => {}); pushes.push({ kind: "only", userId, payload }); } },
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
const Auto = src("lib/inbox/automation.ts");
const webhook = src("app/api/integrations/whatsapp/webhook/route.ts");
const { translations } = src("lib/i18n/translations.ts");

// ============================================================ database + harness
const MIGRATION_FILE = "supabase/migrations/2026-12-18_whatsapp_inbox_push_claim.sql";
const MIGRATION = read(MIGRATION_FILE);
const VERIFY = read("supabase/support/2026-12-18_whatsapp_inbox_push_claim.verify.sql");
const ROLLBACK = read("supabase/support/2026-12-18_whatsapp_inbox_push_claim.rollback.sql");
const db = new PGlite();
const U = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PRF = (n) => `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const alice = { user: U(1), profile: PRF(1) }, bob = { user: U(2), profile: PRF(2) };
const PH_A = "1110000000001", WABA_A = "1110000000002", PH_B = "9990000000001", WABA_B = "9990000000002", PH_OFF = "5550000000001";
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
for (const m of ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media", "2026-12-11_whatsapp_inbox_automation"]) await db.exec(read(`supabase/migrations/${m}.sql`));
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id) values ('${alice.profile}', '${PH_A}', '${WABA_A}'), ('${bob.profile}', '${PH_B}', '${WABA_B}')`);
await db.exec(`insert into public.wa_accounts (profile_id, phone_number_id, waba_id, status) values ('${bob.profile}', '${PH_OFF}', '5550000000002', 'disabled')`);
const q1 = async (sql) => (await db.query(sql)).rows;
const count = async (t, w = "true") => Number((await q1(`select count(*)::int n from public.${t} where ${w}`))[0].n);
const sq = (v) => (v === null || v === undefined ? "null" : Array.isArray(v) ? `'{${v.join(",")}}'` : typeof v === "number" || typeof v === "boolean" ? String(v) : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`);
let chain = Promise.resolve();
const asRole = (role, sql) => { const run = async () => { await db.exec(`set role ${role}`); try { return await db.query(sql); } finally { await db.exec("reset role"); } }; const p = chain.then(run, run); chain = p.then(() => undefined, () => undefined); return p; };
const asService = (sql) => asRole("service_role", sql);
let rpcMode = "ok"; let rpcCalls = [];
globalThis.__admin = () => ({ rpc: async (fn, args) => {
  rpcCalls.push({ fn, args });
  if (rpcMode === "push_claim_error" && fn === "inbox_push_claim") return { data: null, error: { code: "42883", message: "function inbox_push_claim does not exist SECRET CLAIM TEXT" } };
  const named = Object.entries(args).map(([k, val]) => `${k} => ${sq(val)}`).join(", ");
  try { return { data: (await asService(`select public.${fn}(${named}) as r`)).rows[0].r, error: null }; } catch (e) { return { data: null, error: { code: e.code || "XX000", message: e.message } }; }
} });
const SECRET = "test-app-secret";
process.env.WHATSAPP_APP_SECRET = SECRET; delete process.env.META_APP_SECRET; delete process.env.WHATSAPP_ACCESS_TOKEN;
process.env.WHATSAPP_PHONE_NUMBER_ID = PH_A; process.env.WHATSAPP_WABA_ID = WABA_A;
const sign = (b) => "sha256=" + crypto.createHmac("sha256", SECRET).update(b).digest("hex");
const payload = (value) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: WABA_A, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PH_A }, ...value } }] }] });
const BODY_TEXT = "My card number is 4111-SECRET-BODY, please call me";
const inboundVal = (id, from = "237600000001", name = "Customer One") => ({ contacts: [{ profile: { name }, wa_id: from }], messages: [{ from, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: BODY_TEXT } }] });
const logs = []; const origInfo = console.info, origErr = console.error;
console.info = (...a) => logs.push(a.join(" ")); console.error = (...a) => logs.push(a.join(" "));
const post = (raw) => webhook.POST(new Request("http://localhost/api/integrations/whatsapp/webhook", { method: "POST", body: raw, headers: { "x-hub-signature-256": sign(raw) } }));
const reset = () => { rpcMode = "ok"; rpcCalls = []; notes.length = 0; pushes.length = 0; globalThis.__notifyThrows = false; globalThis.__pushMode = "ok"; };
const convOf = async (wa) => (await q1(`select cv.id from public.inbox_conversations cv join public.inbox_contacts c on c.id = cv.contact_id where c.external_id = '${wa}'`))[0].id;
const backdatePush = (conv, seconds) => db.exec(`update public.inbox_push_throttle set last_push_at = now() - interval '${seconds} seconds' where conversation_id = '${conv}'`);
const OBJ = `select 'fn:' || p.proname as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' union all select 'tbl:' || tablename from pg_tables where schemaname = 'public' union all select 'col:' || table_name || '.' || column_name from information_schema.columns where table_schema = 'public' union all select 'idx:' || indexname from pg_indexes where schemaname = 'public' union all select 'pol:' || tablename || '.' || policyname from pg_policies where schemaname = 'public' union all select 'trg:' || tgname from pg_trigger where not tgisinternal order by 1`;
const firstStatement = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(/;[ \t]*\n/)[0];

try {
  // ---------- the migration: additive, one table + one function, privileged for service_role only, verifiable, reversible
  const before = (await q1(OBJ)).map((r) => r.x);
  const bare = MIGRATION.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  check("migration: no alter/drop of any existing object and no hard-coded ids", !/\balter\s+table\s+public\.(?!inbox_push_throttle)/i.test(bare) && !/\bdrop\s+(table|function|policy|trigger)/i.test(bare) && !/[0-9]{12,}/.test(bare));
  await db.exec(MIGRATION);
  check("migration applies and is idempotent", await db.exec(MIGRATION).then(() => true, () => false));
  const added = (await q1(OBJ)).map((r) => r.x).filter((x) => !before.includes(x));
  check("exactly one new table and one new function (plus the table's own columns and index)", added.filter((x) => x.startsWith("tbl:")).join() === "tbl:inbox_push_throttle" && added.filter((x) => x.startsWith("fn:")).join() === "fn:inbox_push_claim" && added.every((x) => /^(tbl:inbox_push_throttle|fn:inbox_push_claim|col:inbox_push_throttle\.|idx:inbox_push_throttle)/.test(x)), added.join());
  const ver = await q1(firstStatement(VERIFY));
  check("verify script: every row ok", ver.length >= 8 && ver.every((x) => x.ok === true), JSON.stringify(ver.filter((x) => !x.ok)));
  check("privileges: anon / authenticated cannot execute the function or touch the throttle table; service_role can execute the function but not read the table directly",
    (await q1(`select has_function_privilege('anon', 'public.inbox_push_claim(text,text)', 'execute') a, has_function_privilege('authenticated', 'public.inbox_push_claim(text,text)', 'execute') b, has_function_privilege('service_role', 'public.inbox_push_claim(text,text)', 'execute') c, has_table_privilege('authenticated', 'public.inbox_push_throttle', 'select') d, has_table_privilege('anon', 'public.inbox_push_throttle', 'select') e`))
      .every((r) => r.a === false && r.b === false && r.c === true && r.d === false && r.e === false));

  // ---------- owner derived server-side; first message of a new conversation
  reset();
  let r = await post(payload(inboundVal("wamid.P1")));
  const conv1 = await convOf("237600000001");
  check("a new inbound message is stored (200) and the OWNER (derived by the database from the phone number's account) gets a push", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.P1'")) === 1 && pushes.length === 1 && pushes[0].userId === alice.user, JSON.stringify({ st: r.status, pushes, logs: logs.slice(-4) }));
  check("first message: the new-conversation bell notice is kept AND the push is added WITHOUT a second bell row (push-only sender)", notes.length === 1 && notes[0].type === "inbox_new_conversation" && pushes[0].kind === "only");
  const p1 = pushes[0].payload;
  check("payload: exactly category, title, body and url; generic text; opens THIS conversation", JSON.stringify(Object.keys(p1).sort()) === JSON.stringify(["body", "category", "title", "url"]) && p1.category === "inbox_new_message" && p1.url === `/dashboard/inbox/${conv1}` && p1.title === translations.fr.inbox.notify.pushTitle && p1.body === translations.fr.inbox.notify.pushBody, JSON.stringify(p1));
  const flat = JSON.stringify(pushes) + logs.join("\n");
  check("payload and logs contain NO message text, NO customer name, NO phone number", !flat.includes("4111-SECRET-BODY") && !flat.includes("Customer One") && !flat.includes("237600000001") && !/please call me/.test(flat));
  check("the push is recorded in the throttle table for that conversation", (await count("inbox_push_throttle", `conversation_id = '${conv1}'`)) === 1);

  // ---------- throttle: one push per conversation per 60 seconds; every message still stored
  reset();
  r = await post(payload(inboundVal("wamid.P2")));
  const r3 = await post(payload(inboundVal("wamid.P3")));
  check("rapid messages inside 60 seconds: stored (200), NO further push, no extra bell row", r.status === 200 && r3.status === 200 && pushes.length === 0 && notes.length === 0 && (await count("inbox_messages", "provider_message_id in ('wamid.P2','wamid.P3')")) === 2 && logs.some((l) => l.includes("push_throttled")));
  check("throttling never touches the Inbox: all three messages are stored as unread inbound", (await count("inbox_messages", `conversation_id = '${conv1}' and direction = 'inbound'`)) === 3 && Number((await q1(`select unread_count from public.inbox_conversations where id = '${conv1}'`))[0].unread_count) === 3);
  await backdatePush(conv1, 59);
  reset();
  await post(payload(inboundVal("wamid.P4")));
  check("59 seconds after the last push: still throttled", pushes.length === 0);
  await backdatePush(conv1, 61);
  reset();
  r = await post(payload(inboundVal("wamid.P5")));
  check("every later message can push once the slot is free (61 seconds): a push WITH the bell row, to the same owner, for the same conversation", r.status === 200 && pushes.length === 1 && pushes[0].kind === "bell" && pushes[0].userId === alice.user && pushes[0].payload.url === `/dashboard/inbox/${conv1}` && notes.length === 0, JSON.stringify({ pushes, notes }));
  reset();
  await post(payload(inboundVal("wamid.P6")));
  check("the slot is taken again immediately after a push", pushes.length === 0);
  const other = await post(payload(inboundVal("wamid.Q1", "237600000002", "Customer Two")));
  check("the throttle is per conversation: a different customer's first message pushes at once", other.status === 200 && pushes.length === 1 && pushes[0].payload.url === `/dashboard/inbox/${await convOf("237600000002")}`);
  const claims = await Promise.all([1, 2].map(() => asService(`select public.inbox_push_claim('${PH_A}', 'wamid.P5') as r`).then((x) => x.rows[0].r.result)));
  await backdatePush(conv1, 61);
  const race = await Promise.all([1, 2, 3].map(() => asService(`select public.inbox_push_claim('${PH_A}', 'wamid.P5') as r`).then((x) => x.rows[0].r.result)));
  check("concurrent claims for one conversation: exactly one wins", claims.every((x) => x === "throttled") && race.filter((x) => x === "ok").length === 1 && race.filter((x) => x === "throttled").length === 2, JSON.stringify({ claims, race }));

  // ---------- language
  await db.exec(`insert into public.inbox_settings (profile_id, notification_locale) values ('${alice.profile}', 'en')`);
  await backdatePush(conv1, 61);
  reset();
  await post(payload(inboundVal("wamid.L1")));
  check("English notification language: English generic text", pushes.length === 1 && pushes[0].payload.title === translations.en.inbox.notify.pushTitle && pushes[0].payload.body === translations.en.inbox.notify.pushBody);
  check("both languages have a title and a body without any placeholder for a name", ["en", "fr"].every((l) => typeof translations[l].inbox.notify.pushTitle === "string" && typeof translations[l].inbox.notify.pushBody === "string" && translations[l].inbox.notify.pushTitle && translations[l].inbox.notify.pushBody));

  // ---------- duplicates and ownership
  reset();
  r = await post(payload(inboundVal("wamid.L1")));
  check("a redelivery of a stored event (duplicate) triggers no push and no claim", r.status === 200 && pushes.length === 0 && rpcCalls.every((c) => c.fn.startsWith("inbox_ingest_")));
  await db.exec(`select public.inbox_ingest_whatsapp_message('${PH_B}', null, 'wamid.B1', '237611111111', now(), 'text', 'hi', 'Bob Customer', null, null, null, null, null, null, null)`);
  reset();
  const adminLike = globalThis.__admin();
  const push = async (u, p, o) => { pushes.push({ kind: o.bell ? "bell" : "only", userId: u, payload: p }); };
  const bobReport = await Auto.onInboundMessage({ admin: adminLike, notify: async () => {}, push }, { phoneNumberId: PH_B, messageId: "wamid.B1" });
  check("another profile's message pushes to THAT owner only (bob), never to alice", bobReport.push === "sent" && pushes.length === 1 && pushes[0].userId === bob.user);
  reset();
  const cross = await Auto.onInboundMessage({ admin: adminLike, notify: async () => {}, push }, { phoneNumberId: PH_A, messageId: "wamid.B1" });
  check("a message id of ANOTHER profile presented with alice's phone number id pushes to nobody", cross.push === "none" && pushes.length === 0);
  const unknown = await asService(`select public.inbox_push_claim('0000000000000', 'wamid.B1') as r`).then((x) => x.rows[0].r.result);
  const disabled = await asService(`select public.inbox_push_claim('${PH_OFF}', 'wamid.B1') as r`).then((x) => x.rows[0].r.result);
  const nulls = await asService(`select public.inbox_push_claim(null, null) as r`).then((x) => x.rows[0].r.result);
  const outboundId = await asService(`select public.inbox_prepare_outbound_text('${alice.user}', '${conv1}', 'e0000000-0000-4000-8000-0000000000bb', 'a reply') as r`).then((x) => x.rows[0].r);
  check("the claim skips an unknown account, a disabled account, null ids, and never answers for an outbound row", unknown === "skip" && disabled === "skip" && nulls === "skip" && outboundId.message_id && (await asService(`select public.inbox_push_claim('${PH_A}', 'wamid.NOPE') as r`).then((x) => x.rows[0].r.result)) === "skip");

  // ---------- failures never break the webhook
  await backdatePush(conv1, 61);
  reset(); globalThis.__pushMode = "throw";
  r = await post(payload(inboundVal("wamid.F1")));
  check("push sender THROWS: 200 to Meta, the message is stored, the failure is logged by category and no push text leaks", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.F1'")) === 1 && logs.some((l) => l.includes("push_failed")) && !logs.join("\n").includes("SECRET PUSH TEXT"));
  reset(); rpcMode = "push_claim_error";
  r = await post(payload(inboundVal("wamid.F2")));
  check("claim function missing (migration not applied yet) or failing: 200, the message is stored, no push, no database text in the logs", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.F2'")) === 1 && pushes.length === 0 && logs.some((l) => l.includes("push_claim_failed")) && !logs.join("\n").includes("SECRET CLAIM TEXT"));
  reset(); globalThis.__notifyThrows = true; await backdatePush(conv1, 61);
  r = await post(payload(inboundVal("wamid.F3")));
  check("a failing bell notice does not stop the push, and a failing push does not stop the bell", r.status === 200 && pushes.length === 1);
  reset(); globalThis.__pushMode = "hang"; await backdatePush(conv1, 61);
  const t0 = Date.now();
  r = await post(payload(inboundVal("wamid.F4")));
  const took = Date.now() - t0;
  check("a push that never finishes is cut off after the timeout: 200, the message is stored, and the answer is not held for long", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.F4'")) === 1 && took >= Auto.PUSH_TIMEOUT_MS - 200 && took < Auto.PUSH_TIMEOUT_MS + 3000 && logs.some((l) => l.includes("timeout")), `took=${took}`);

  // ---------- existing behaviour stays intact
  reset();
  const state = await q1(`select count(*)::int n from public.inbox_conversation_state`);
  check("existing automation is untouched: its state rows are still created and the follow-up / failure functions still exist", Number(state[0].n) >= 1 && (await q1(`select count(*)::int n from pg_proc where proname in ('inbox_automation_inbound','inbox_automation_failed','inbox_claim_follow_ups')`))[0].n === 3);
  const autoSrc = read("src/lib/inbox/automation.ts");
  const pushFn = autoSrc.slice(autoSrc.indexOf("async function pushForInbound"), autoSrc.indexOf("/** A NEW inbound customer message"));
  check("static: the payload builder never reads a message body, contact name or number", pushFn.length > 200 && !pushFn.includes("contact_name") && !pushFn.includes("from_number") && !pushFn.includes("text") && autoSrc.includes('category: "inbox_new_message", title: n.pushTitle, body: n.pushBody, url: link(conversationId)'));
  check("static: the webhook still verifies the signature before anything else and its push wiring uses the existing senders", read("src/app/api/integrations/whatsapp/webhook/route.ts").indexOf("verifyWhatsAppSignature(rawBody") < read("src/app/api/integrations/whatsapp/webhook/route.ts").indexOf("sendPushAndBellToUser(admin") && /sendPushToUser\(admin, userId, payload\)/.test(read("src/app/api/integrations/whatsapp/webhook/route.ts")));

  // ---------- rollback
  await db.exec(ROLLBACK);
  check("rollback removes exactly the new function and table, and is safe to re-run", (await q1(OBJ)).map((x) => x.x).filter((x) => !before.includes(x)).length === 0 && await db.exec(ROLLBACK).then(() => true, () => false));
  reset();
  r = await post(payload(inboundVal("wamid.Z1", "237600000009", "Customer Nine")));
  check("after the rollback the webhook still stores the message and answers 200 (the push step fails safely)", r.status === 200 && (await count("inbox_messages", "provider_message_id = 'wamid.Z1'")) === 1 && pushes.length === 0);
} finally { console.info = origInfo; console.error = origErr; }

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
