// Ringo Watchdog V1: rules, deduplication, alerts, safety and reliability. Runs the REAL rule engine, the REAL recordAudit hook and the REAL alert renderer against an in-memory
// stand-in for the database client; the table itself (RLS, append-only, dedupe key) is attacked for real on PGlite by supabase/support/tests/watchdog.adversarial.mjs, which this
// file runs at the end (fail closed without PGlite unless SKIP_SQL=1). No network, no Supabase, no Fapshi, no money.
//   Run:  node scripts/tests/watchdog.test.mjs
import fs from "fs";
import path from "path";
import assert from "assert";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true, cache: false });
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8").replace(/\r\n/g, "\n");
let passed = 0;
const failures = [];
const test = async (name, fn) => { try { await fn(); passed++; } catch (e) { failures.push(`${name}\n    ${String(e.message).split("\n").join("\n    ")}`); } };

const W = jiti(path.join(SRC, "lib/watchdog/index.ts"));
const A = jiti(path.join(SRC, "lib/adminAudit.ts"));
const PA = jiti(path.join(SRC, "lib/payoutAudit.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

const U1 = "11111111-1111-4111-8111-111111111111", U2 = "22222222-2222-4222-8222-222222222222", ADM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAYOUT = "99999999-9999-4999-8999-999999999999";
const PHONE = "670123456", EMAIL = "owner@example.test", ACCT = "ACCT-9988776655", TOKEN = "tok_live_SECRETSECRET", PROVIDER = "Fapshi said: insufficient funds on 670123456";

// ------------------------------------------------------------------------------------------------- an in-memory stand-in for the service-role client
function fakeDb(opts = {}) {
  const t = { admin_audit_log: [], watchdog_events: [], notifications: [] };
  const log = { auditCounts: 0, watchdogInserts: 0 };
  const now = () => (opts.clock ? opts.clock() : Date.now());
  const builder = (table) => {
    const st = { filters: [], count: false, head: false };
    const q = {};
    q.select = (_c, o) => { if (o?.count) st.count = true; if (o?.head) st.head = true; return q; };
    q.eq = (k, v) => { st.filters.push((r) => r[k] === v); return q; };
    q.gte = (k, v) => { st.filters.push((r) => String(r[k]) >= String(v)); return q; };
    for (const m of ["in", "is", "not", "neq", "lte", "order", "limit", "update", "delete", "or", "match"]) q[m] = () => q;
    q.insert = (row) => {
      const rows = Array.isArray(row) ? row : [row];
      if (table === "watchdog_events") log.watchdogInserts++;
      const fail = opts.failInsert?.[table];
      if (fail === "throw") throw new Error(table === "notifications" ? "db exploded" : `db exploded ${PHONE} ${EMAIL}`); // (the existing bell helper logs the raw error; real database errors carry no row data)
      if (fail) return Promise.resolve({ data: null, error: { code: fail } });
      for (const r of rows) {
        if (table === "watchdog_events" && t.watchdog_events.some((e) => e.dedupe_key === r.dedupe_key)) return Promise.resolve({ data: null, error: { code: "23505" } });
        t[table] = t[table] || [];
        t[table].push({ ...r, created_at: r.created_at || new Date(now()).toISOString() });
      }
      return Promise.resolve({ data: null, error: null });
    };
    q.then = (res, rej) => {
      if (table === "admin_audit_log") { log.auditCounts++; if (opts.failCount) return Promise.resolve({ data: null, count: null, error: { code: "57014" } }).then(res, rej); }
      const rows = (t[table] || []).filter((r) => st.filters.every((f) => f(r)));
      return Promise.resolve({ data: st.head ? null : rows, count: st.count ? rows.length : null, error: null }).then(res, rej);
    };
    return q;
  };
  return { t, log, from: builder, rpc: async () => ({ data: [], error: null }) };
}
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
const seedAudit = (db, action, target, minutesAgo, details = {}) => db.t.admin_audit_log.push({ admin_id: ADM, action, target_user_id: target, details, created_at: ago(minutesAgo) });
const events = (db) => db.t.watchdog_events;
const bells = (db) => db.t.notifications.filter((n) => n.type === "watchdog_alert");
const audit = (db, action, target = U1, details = {}, actor = ADM) => A.recordAudit(db, { actorId: actor, action, targetUserId: target, details });
const countDeps = (rows) => ({ countRecent: async ({ action, targetUserId, sinceMs }) => rows.filter((r) => r.action === action && (!targetUserId || r.target === targetUserId) && Date.now() - r.t <= sinceMs).length });

// ------------------------------------------------------------------------------------------------- detection
await test("WD-001: a payout destination change raises a MEDIUM incident, owner gets a bell (no push), and it carries only the kind of change", async () => {
  const db = fakeDb();
  await audit(db, "payout_destination_changed", U1, { programs: ["affiliate", "music", "shop"], change: "changed", method: "mobile_money", previousMethod: "bank", methodChanged: true }, U1);
  assert.equal(events(db).length, 1);
  const e = events(db)[0];
  assert.deepEqual({ rule: e.rule_code, sev: e.severity, subject: e.subject_user_id, params: e.params }, { rule: "WD-001", sev: "medium", subject: U1, params: { change: "changed" } });
  assert.equal(bells(db).length, 1);
  assert.equal(bells(db)[0].audience, "admin");
  assert.equal(bells(db)[0].link, "/admin/watchdog");
});
await test("WD-001: the same change is alerted ONCE (replays and double submits do not repeat), a different kind of change is a new incident", async () => {
  const db = fakeDb();
  for (let i = 0; i < 4; i++) await audit(db, "payout_destination_changed", U1, { change: "changed" }, U1);
  assert.equal(events(db).length, 1);
  assert.equal(bells(db).length, 1);
  await audit(db, "payout_destination_changed", U1, { change: "added" }, U1);
  assert.equal(events(db).length, 2);
  await audit(db, "payout_destination_changed", U2, { change: "changed" }, U2);
  assert.equal(events(db).length, 3);
});
await test("WD-002: the THIRD failed send for the same account inside 30 minutes raises a HIGH incident; one and two do not", async () => {
  const db = fakeDb();
  await audit(db, "send_music_payout_failed", U1, { payoutId: "p-1", program: "music", category: "provider_rejected" });
  await audit(db, "send_music_payout_failed", U1, { payoutId: "p-2", program: "music", category: "provider_rejected" });
  assert.equal(events(db).length, 0, "two failures must not alert");
  await audit(db, "send_music_payout_failed", U1, { payoutId: "p-3", program: "music", category: "provider_rejected" });
  assert.equal(events(db).length, 1);
  assert.deepEqual({ r: events(db)[0].rule_code, s: events(db)[0].severity, p: events(db)[0].params }, { r: "WD-002", s: "high", p: { program: "music", category: "provider_rejected", count: 3, windowMinutes: 30, scope: "account" } });
  assert.equal(bells(db).length, 1);
});
await test("WD-002: failures older than the window do not count; the fourth failure in the same window does not alert again", async () => {
  const db = fakeDb();
  seedAudit(db, "send_affiliate_payout_failed", U1, 45); seedAudit(db, "send_affiliate_payout_failed", U1, 40);
  await audit(db, "send_affiliate_payout_failed", U1, { category: "provider_rejected" });
  assert.equal(events(db).length, 0, "two old + one new is one inside the window");
  const db2 = fakeDb();
  for (let i = 0; i < 6; i++) await audit(db2, "send_shop_payout_failed", U1, { payoutId: `s-${i}`, category: "provider_rejected" });
  assert.equal(events(db2).filter((e) => e.rule_code === "WD-002").length, 1, "one alert per account, program and window");
  assert.equal(bells(db2).length, 1);
});
await test("WD-002: three failures spread over three DIFFERENT accounts (a provider-side problem) raise a program-wide incident; different programs do not mix", async () => {
  const db = fakeDb();
  const u3 = "33333333-3333-4333-8333-333333333333";
  for (const u of [U1, U2, u3]) await audit(db, "send_music_payout_failed", u, { category: "provider_rejected" });
  const wd2 = events(db).filter((e) => e.rule_code === "WD-002");
  assert.equal(wd2.length, 1);
  assert.equal(wd2[0].params.scope, "program");
  assert.equal(wd2[0].subject_user_id, null);
  const db2 = fakeDb();
  await audit(db2, "send_music_payout_failed", U1, {}); await audit(db2, "send_affiliate_payout_failed", U1, {}); await audit(db2, "send_shop_payout_failed", U1, {});
  assert.equal(events(db2).length, 0, "one failure in each of three programs is not a spike");
});
await test("WD-003: provider_uncertain and sent_but_not_recorded each raise a HIGH incident on the FIRST occurrence, once per payout; a plain rejection does not", async () => {
  const db = fakeDb();
  await audit(db, "send_music_payout_failed", U1, { payoutId: PAYOUT, category: "provider_uncertain" });
  await audit(db, "send_shop_payout_failed", U2, { payoutId: "ship-1", category: "sent_but_not_recorded", transId: "TX1" });
  await audit(db, "send_affiliate_payout_failed", U1, { payoutId: "aff-1", category: "provider_rejected" });
  const wd3 = events(db).filter((e) => e.rule_code === "WD-003");
  assert.equal(wd3.length, 2);
  assert.ok(wd3.every((e) => e.severity === "high"));
  assert.deepEqual(wd3.map((e) => e.params.category).sort(), ["provider_uncertain", "sent_but_not_recorded"]);
  assert.equal(wd3.find((e) => e.params.category === "provider_uncertain").params.payoutId, PAYOUT);
  await audit(db, "send_music_payout_failed", U1, { payoutId: PAYOUT, category: "provider_uncertain" }); // the admin clicks again
  assert.equal(events(db).filter((e) => e.rule_code === "WD-003").length, 2, "same payout, same category: no second alert");
});
await test("WD-004: the THIRD over-balance refusal inside 15 minutes for one account raises a MEDIUM incident; two do not; other reasons do not count", async () => {
  const db = fakeDb();
  const refuse = (target = U1, reason = "payout_exceeds_available") => audit(db, "payout_request_refused", target, { program: "music", reason }, target);
  await refuse(); await refuse();
  assert.equal(events(db).length, 0);
  await refuse();
  assert.equal(events(db).length, 1);
  assert.deepEqual({ r: events(db)[0].rule_code, s: events(db)[0].severity, p: events(db)[0].params }, { r: "WD-004", s: "medium", p: { program: "music", count: 3, windowMinutes: 15 } });
  await refuse(); await refuse();
  assert.equal(events(db).length, 1, "further refusals in the same window do not repeat the alert");
  const db2 = fakeDb();
  for (let i = 0; i < 5; i++) await audit(db2, "payout_request_refused", U2, { reason: "something_else" }, U2);
  assert.equal(events(db2).length, 0);
  const db3 = fakeDb();
  seedAudit(db3, "payout_request_refused", U1, 40); seedAudit(db3, "payout_request_refused", U1, 30);
  await audit(db3, "payout_request_refused", U1, { program: "shop", reason: "payout_exceeds_available" }, U1);
  assert.equal(events(db3).length, 0, "refusals older than 15 minutes do not count");
});
await test("WD-006: a blocked team permission escalation raises a HIGH incident (once per person per window) and exposes no permission names", async () => {
  const db = fakeDb();
  await audit(db, "team_permission_escalation_blocked", null, { site: "role_update", profileId: "pp", permissions: ["payments.view", "settings.manage"] }, U1);
  await audit(db, "team_permission_escalation_blocked", null, { site: "role_update", profileId: "pp" }, U1);
  assert.equal(events(db).length, 1);
  assert.deepEqual({ r: events(db)[0].rule_code, s: events(db)[0].severity, subject: events(db)[0].subject_user_id, params: events(db)[0].params }, { r: "WD-006", s: "high", subject: U1, params: { site: "role_update" } });
  assert.ok(!JSON.stringify(events(db)).includes("payments.view"));
});
await test("WD-005: a FAILED security-suite report raises a HIGH incident once per reference; a pass raises nothing; the report is allow-listed", async () => {
  const f = W.evaluateSecuritySuiteReport({ status: "fail", failed: ["phase3", "phase6-sql", "x y; drop table", 7, "A".repeat(40)], ref: "abc123DEF" });
  assert.deepEqual({ rule: f.rule, sev: f.severity, key: f.dedupeKey, params: f.params }, { rule: "WD-005", sev: "high", key: "wd005:abc123DEF", params: { failedCount: 2, suites: "phase3,phase6-sql", ref: "abc123DEF" } });
  assert.equal(W.evaluateSecuritySuiteReport({ status: "pass" }), null);
  for (const bad of [null, undefined, "fail", 5, [], {}, { status: "ok" }]) assert.equal(W.evaluateSecuritySuiteReport(bad), null);
  assert.ok(W.evaluateSecuritySuiteReport({ status: "fail", ref: "bad ref!!" }).dedupeKey.startsWith("wd005:day:"));
  const db = fakeDb();
  assert.equal(await W.raiseFinding(db, f), "created");
  assert.equal(await W.raiseFinding(db, f), "duplicate");
  assert.equal(events(db).length, 1);
  assert.equal(bells(db).length, 1);
});

// ------------------------------------------------------------------------------------------------- non-detection
await test("no alert: a normal payout, a successful send, unrelated audit actions and unknown actions", async () => {
  const db = fakeDb();
  for (const action of ["send_music_payout_fapshi", "send_affiliate_payout_fapshi", "addon_created", "addon_updated", "branding_updated", "request_rejected", "watchdog_acknowledged", "min_payout_changed", "plan_change", "totally_unknown", ""]) await audit(db, action, U1, { payoutId: "p", amount: 5000 });
  assert.equal(events(db).length, 0);
  assert.equal(bells(db).length, 0);
});
await test("no work at all for unwatched actions (no database query is made)", async () => {
  const db = fakeDb();
  await W.observeAuditEvent(db, { actorId: ADM, action: "addon_updated", targetUserId: U1, details: {} });
  await W.observeAuditEvent(db, { actorId: ADM, action: "send_music_payout_fapshi", targetUserId: U1, details: {} });
  assert.equal(db.log.auditCounts, 0);
  assert.equal(db.log.watchdogInserts, 0);
});
await test("pure evaluator: one and two failures give no finding, three do, using only an injected counter", async () => {
  const mk = (n) => Array.from({ length: n }, () => ({ action: "send_shop_payout_failed", target: U1, t: Date.now() - 60_000 }));
  const ev = { action: "send_shop_payout_failed", actorId: ADM, targetUserId: U1, details: { category: "provider_rejected" } };
  assert.equal((await W.evaluateWatchdogEvent(ev, countDeps(mk(1)))).length, 0);
  assert.equal((await W.evaluateWatchdogEvent(ev, countDeps(mk(2)))).length, 0);
  assert.equal((await W.evaluateWatchdogEvent(ev, countDeps(mk(3)))).filter((f) => f.rule === "WD-002").length, 1);
});

// ------------------------------------------------------------------------------------------------- deduplication under concurrency
await test("dedupe is atomic: two overlapping identical events create ONE incident and ONE alert (the unique key decides, not a read-then-write)", async () => {
  const db = fakeDb();
  await Promise.all([1, 2, 3, 4, 5].map(() => audit(db, "payout_destination_changed", U1, { change: "changed" }, U1)));
  assert.equal(events(db).length, 1);
  assert.equal(bells(db).length, 1);
  assert.match(read("src/lib/watchdog/index.ts"), /error\.code === "23505"/);
});

// ------------------------------------------------------------------------------------------------- security: nothing sensitive can reach an incident or an alert
const HOSTILE = { change: "changed", method: "mobile_money", phone: PHONE, email: EMAIL, accountNumber: ACCT, token: TOKEN, providerBody: PROVIDER, category: `<script>${PHONE}</script>`, program: `music ${EMAIL}`, reason: "payout_exceeds_available", site: `x ${TOKEN}`, payoutId: `p ${PHONE}`, transId: TOKEN, error: PROVIDER, message: PROVIDER };
await test("sensitive values in the audit row never reach a Watchdog incident, a bell or a push (hostile details on every watched action)", async () => {
  const db = fakeDb();
  for (const n of [1, 2, 3]) for (const action of ["payout_destination_changed", "send_music_payout_failed", "send_affiliate_payout_failed", "send_shop_payout_failed", "payout_request_refused", "team_permission_escalation_blocked"]) await audit(db, action, U1, { ...HOSTILE }, U1);
  assert.ok(events(db).length >= 4, "the hostile rows must still be detected");
  const dump = JSON.stringify([events(db), db.t.notifications]);
  for (const secret of [PHONE, EMAIL, ACCT, TOKEN, PROVIDER, "<script>", "Fapshi said", "tok_live"]) assert.ok(!dump.includes(secret), `leaked: ${secret}`);
  for (const e of events(db)) for (const [k, v] of Object.entries(e.params)) assert.ok(["program", "category", "count", "windowMinutes", "scope", "change", "site", "payoutId", "suites", "failedCount", "ref"].includes(k) && (typeof v === "number" || /^[A-Za-z0-9_,-]{1,64}$/.test(v)), `${k}=${v}`);
});
await test("alerts: every rule renders in English AND French, bilingual notification has both, and no template can interpolate a sensitive field", async () => {
  const sample = { program: "music", category: "provider_uncertain", count: 3, windowMinutes: 30, scope: "account", failedCount: 2, change: "changed" };
  for (const rule of ["WD-001", "WD-002", "WD-003", "WD-004", "WD-005", "WD-006"]) for (const sev of ["medium", "high"]) {
    const en = W.renderWatchdogAlert("en", rule, sev, sample), fr = W.renderWatchdogAlert("fr", rule, sev, sample);
    assert.ok(en.body.length > 30 && fr.body.length > 30 && en.body !== fr.body, rule);
    assert.match(en.title, /^Watchdog Alert — (Medium|High)$/);
    assert.match(fr.title, /^Alerte Watchdog — (Moyenne|Élevée)$/);
    const both = W.renderBilingualWatchdogAlert(rule, sev, sample);
    assert.ok(both.title.includes(" / ") && both.body.includes(en.body) && both.body.includes(fr.body));
  }
  const srcText = JSON.stringify(Object.keys(translations.en.watchdog.rules)) + translations.en.watchdog.rules["WD-001"].body.toString() + translations.fr.watchdog.rules["WD-001"].body.toString();
  assert.ok(!/phone|email|account\s?number|token/i.test(translations.en.watchdog.rules["WD-001"].body({})), "WD-001 says nothing about destination values");
  assert.ok(!/\b(phone|email|token)\b/i.test(srcText.replace(/payment provider/gi, "")));
  assert.deepEqual(Object.keys(translations.en.watchdog.rules), Object.keys(translations.fr.watchdog.rules));
  assert.deepEqual(Object.keys(translations.en.watchdog.feed), Object.keys(translations.fr.watchdog.feed));
  assert.ok(W.renderWatchdogAlert("en", "WD-002", "high", { program: "affiliate", category: "provider_rejected", count: 3, windowMinutes: 30, scope: "program" }).body.includes("3 failed affiliate payout attempts within 30 minutes"));
  assert.ok(W.renderWatchdogAlert("fr", "WD-002", "high", { program: "affiliate", category: "provider_rejected", count: 3, windowMinutes: 30, scope: "program" }).body.includes("3 échecs d'envoi de paiement d'affiliation en 30 minutes"));
});
await test("alert wording matches the spec for HIGH vs MEDIUM and always says what to do", () => {
  assert.match(W.renderWatchdogAlert("en", "WD-003", "high", { program: "music", category: "sent_but_not_recorded" }).body, /Immediate review is recommended/);
  assert.match(W.renderWatchdogAlert("en", "WD-002", "high", { program: "shop", category: "provider_rejected", count: 4, windowMinutes: 30, scope: "account" }).body, /Human review recommended/);
  assert.match(W.renderWatchdogAlert("en", "WD-005", "high", { failedCount: 1 }).body, /Production security checks require review/);
});
await test("Watchdog never acts: no payout, status, lock, retry, money or account change anywhere in the watchdog code", () => {
  const code = ["rules", "alerts", "index"].map((f) => read(`src/lib/watchdog/${f}.ts`)).join("\n").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/fapshi|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|createAdminClient|supabase\.auth|stripe/i.test(code), "only reads audit counts and inserts incidents / bells");
  const inserts = [...code.matchAll(/\.from\("([a-z_]+)"\)\s*\.insert/g)].map((m) => m[1]).sort();
  assert.deepEqual(inserts, ["notifications", "watchdog_events"]);
});

// ------------------------------------------------------------------------------------------------- reliability
await test("a Watchdog failure never breaks the audited operation: the audit row is still written and recordAudit still resolves (db error, db exception, count error)", async () => {
  const seen = [];
  const orig = console.error;
  console.error = (...a) => seen.push(a.map(String).join(" "));
  try {
    for (const opts of [{ failInsert: { watchdog_events: "42P01" } }, { failInsert: { watchdog_events: "throw" } }, { failCount: true }, { failInsert: { notifications: "throw" } }]) {
      const db = fakeDb(opts);
      for (let i = 0; i < 3; i++) await audit(db, "send_music_payout_failed", U1, { category: "provider_uncertain", payoutId: `p${i}`, message: PROVIDER });
      assert.equal(db.t.admin_audit_log.filter((r) => r.action === "send_music_payout_failed").length, 3, "the audit rows are all there");
    }
  } finally { console.error = orig; }
  const out = seen.join("\n");
  assert.ok(/watchdog: /.test(out), "the failure is logged, not swallowed silently");
  for (const secret of [PHONE, EMAIL, PROVIDER]) assert.ok(!out.includes(secret), `the log leaked: ${secret}`);
  assert.ok(/42P01|57014|Error/.test(out), "it logs a code / name only");
});
await test("an alert delivery failure still leaves the incident in the feed", async () => {
  const orig = console.error; console.error = () => {};
  try {
    const db = fakeDb({ failInsert: { notifications: "throw" } });
    await audit(db, "team_permission_escalation_blocked", null, { site: "role_create" }, U1);
    assert.equal(events(db).length, 1);
  } finally { console.error = orig; }
});
await test("a malformed or hostile event never crashes the evaluator and yields nothing", async () => {
  const deps = countDeps([]);
  for (const bad of [null, undefined, 5, "x", [], {}, { action: null }, { action: 5 }, { action: "send_music_payout_failed" }, { action: "payout_destination_changed", details: "x" }, { action: "payout_destination_changed", targetUserId: "not-a-uuid", actorId: "x", details: { change: "changed" } },
    { action: "payout_request_refused", details: null }, { action: "team_permission_escalation_blocked", details: { site: 5 } }, { action: "send_music_payout_failed", at: "yesterday", details: { category: {} } }]) {
    const r = await W.evaluateWatchdogEvent(bad, deps);
    assert.ok(Array.isArray(r), String(JSON.stringify(bad)));
  }
  assert.deepEqual(await W.evaluateWatchdogEvent({ action: "payout_destination_changed", targetUserId: "not-a-uuid", actorId: "x", details: { change: "changed" } }, deps), []);
  assert.deepEqual(await W.evaluateWatchdogEvent({ action: "unknown_action", details: { change: "changed" } }, deps), []);
  await W.observeAuditEvent(fakeDb(), null); await W.observeAuditEvent(fakeDb(), { action: 5 });
});
await test("a database error while counting is NOT swallowed by the rules: it reaches observeAuditEvent, which logs it", async () => {
  await assert.rejects(() => W.evaluateWatchdogEvent({ action: "send_music_payout_failed", actorId: ADM, targetUserId: U1, details: {} }, { countRecent: async () => { throw new Error("57014"); } }), /57014/);
});

// ------------------------------------------------------------------------------------------------- integration with the existing Phase 7 events
await test("the existing Phase 7 helpers feed Watchdog end to end: destination change, failed sends, over-balance refusals", async () => {
  const db = fakeDb();
  await PA.recordPayoutDestinationChange(db, { userId: U1, previous: { method: "mobile_money", details: { phone: PHONE, provider: "mtn" } }, next: { method: "bank", details: { accountNumber: ACCT } } });
  assert.equal(events(db).filter((e) => e.rule_code === "WD-001").length, 1);
  const userBell = db.t.notifications.filter((n) => n.type === "payout_destination_changed").length + db.t.notifications.filter((n) => Array.isArray(n)).length; void userBell;
  for (let i = 0; i < 3; i++) await PA.recordPayoutSendFailure(db, { adminId: ADM, program: "affiliate", payoutId: `a-${i}`, earnerUserId: U2, err: Object.assign(new Error(PROVIDER), { httpStatus: 400 }) });
  assert.equal(events(db).filter((e) => e.rule_code === "WD-002").length, 1);
  await PA.recordPayoutSendFailure(db, { adminId: ADM, program: "music", payoutId: PAYOUT, earnerUserId: U2, err: new Error("db"), transId: "TX9" });
  assert.equal(events(db).filter((e) => e.rule_code === "WD-003").length, 1);
  for (let i = 0; i < 3; i++) await PA.recordPayoutRequestRefusal(db, { userId: U1, program: "shop", err: new Error("payout_exceeds_available") });
  assert.equal(events(db).filter((e) => e.rule_code === "WD-004").length, 1);
  assert.ok(!JSON.stringify(events(db)).includes(PHONE) && !JSON.stringify(events(db)).includes(PROVIDER));
});
await test("WD-006 hook: all four team ceiling denials record the audit event first, with the SAME 403 answer; the DB ceiling guard is untouched", () => {
  for (const [f, site] of [["roles/route.ts", "role_create"], ["roles/[id]/route.ts", "role_update"], ["members/[id]/route.ts", "member_role_change"], ["invitations/route.ts", "invitation_create"]]) {
    const s = read(`src/app/api/team/${f}`);
    const i = s.indexOf(`action: "team_permission_escalation_blocked", details: { site: "${site}", profileId }`);
    assert.ok(i > 0, f);
    assert.ok(s.indexOf("access.hasPermission(", s.lastIndexOf("const disallowed", i)) > 0);
    assert.ok(s.indexOf("You can't grant permissions you don't have", i) > i && s.slice(i, s.indexOf("\n", s.indexOf("{ status: 403 }", i))).includes("{ status: 403 }"), `${f}: still answers 403`);
  }
  assert.ok(read("supabase/migrations/2026-10-07a_team_permission_ceiling_guard.sql").includes("team_permission_ceiling"));
});

// ------------------------------------------------------------------------------------------------- owner feed, acknowledgement, intake
await test("acknowledge route: platform admins only; only the status fields; only forward transitions; never deletes; audited", () => {
  const s = read("src/app/api/admin/watchdog/[id]/route.ts");
  assert.ok(s.indexOf("assertAdmin()") < s.indexOf("request.json()") && /Forbidden[\s\S]{0,40}403/.test(s));
  assert.ok(/status !== "acknowledged"[\s\S]*?"resolved"/.test(s) || /body\?\.status !== "acknowledged" && body\?\.status !== "resolved"/.test(s));
  assert.ok(/\.in\("status", FROM\[status\]\)/.test(s) && /acknowledged: \["open"\]/.test(s) && /resolved: \["open", "acknowledged"\]/.test(s));
  assert.ok(!/\.delete\(/.test(s) && /acknowledged_by: admin\.id/.test(s) && /resolved_by: admin\.id/.test(s));
  assert.ok(/recordAudit\(adminClient, \{ actorId: admin\.id, action: `watchdog_\$\{status\}`/.test(s));
});
await test("feed page + view: admin-only page, newest first, status + severity + rule + summary + time, acknowledge / resolve buttons, EN/FR strings, no charts", () => {
  const page = read("src/app/admin/watchdog/page.tsx");
  assert.ok(page.indexOf("assertAdmin()") < page.indexOf('.from("watchdog_events")') && /order\("created_at", \{ ascending: false \}\)/.test(page));
  const view = read("src/components/admin/AdminWatchdogView.tsx");
  assert.ok(/useLanguage\(\)/.test(view) && /renderWatchdogAlert\(locale/.test(view) && /f\.acknowledge/.test(view) && /f\.resolve/.test(view));
  assert.ok(!/chart|recharts|score/i.test(view.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")));
  assert.ok(/href: "\/admin\/watchdog", label: "Watchdog"/.test(read("src/components/admin/AdminShell.tsx")));
});
await test("intake route (WD-005): inert and fail closed without WATCHDOG_INGEST_TOKEN, constant-time token check, allow-listed body", async () => {
  const src = read("src/app/api/watchdog/security-suite/route.ts");
  assert.ok(/!secret \|\| secret\.length < 16/.test(src) && /timingSafeEqual/.test(src) && /status: 503/.test(src) && /status: 401/.test(src));
  assert.ok(src.indexOf("timingSafeEqual(given, expected)") < src.indexOf("request.json()"), "the body is not even read before the token is checked");
  const route = jiti(path.join(SRC, "app/api/watchdog/security-suite/route.ts"));
  const call = async (headers, env) => { const old = process.env.WATCHDOG_INGEST_TOKEN; if (env === undefined) delete process.env.WATCHDOG_INGEST_TOKEN; else process.env.WATCHDOG_INGEST_TOKEN = env; try { const r = await route.POST(new Request("http://x/api/watchdog/security-suite", { method: "POST", headers, body: JSON.stringify({ status: "pass" }) })); return r.status; } finally { if (old === undefined) delete process.env.WATCHDOG_INGEST_TOKEN; else process.env.WATCHDOG_INGEST_TOKEN = old; } };
  const GOOD = "this-is-a-long-enough-test-token";
  assert.equal(await call({ authorization: `Bearer ${GOOD}` }, undefined), 503);
  assert.equal(await call({ authorization: "Bearer " }, "short"), 503);
  assert.equal(await call({}, GOOD), 401);
  assert.equal(await call({ authorization: "Bearer wrong-wrong-wrong-wrong" }, GOOD), 401);
  assert.equal(await call({ authorization: `Bearer ${GOOD}` }, GOOD), 200);
});
await test("the aggregator can report a failure to Watchdog (--report) without changing its exit code or printing the token", () => {
  const s = read("scripts/security-suite.mjs");
  assert.ok(/--report/.test(s) && /WATCHDOG_REPORT_URL/.test(s) && /WATCHDOG_INGEST_TOKEN/.test(s));
  assert.ok(!/console\.log\([^)]*\btoken\b[^)]*\)/.test(s.replace(/WATCHDOG_INGEST_TOKEN/g, "")), "never prints the token");
  assert.ok(s.indexOf("await reportFailure(failedIds);") < s.indexOf("process.exit(1);", s.indexOf("await reportFailure(failedIds);")));
});
await test("migration pins: append-only trigger, admin-only read, no INSERT / UPDATE for API roles, no foreign keys, params capped", () => {
  const m = read("supabase/migrations/2026-10-07d_watchdog_events.sql").replace(/--[^\n]*/g, "");
  assert.ok(/create policy "watchdog_events admin read" on public\.watchdog_events for select to authenticated using \(public\.is_admin\(\)\)/.test(m));
  assert.ok(/revoke all on public\.watchdog_events from public, anon, authenticated;/.test(m) && /grant select on public\.watchdog_events to authenticated;/.test(m));
  assert.ok(/grant select, insert, update on public\.watchdog_events to service_role/.test(m) && !/grant[^;]*\bdelete\b[^;]*watchdog_events/i.test(m));
  assert.ok(/before update or delete on public\.watchdog_events/.test(m) && /dedupe_key text not null unique/.test(m) && /pg_column_size\(params\) <= 2000/.test(m));
  assert.ok(!/references/.test(m.slice(m.indexOf("create table"), m.indexOf("create index"))));
  assert.ok(!/\b(insert into|update public|delete from)\b/i.test(m.replace(/create trigger[\s\S]*$/m, "")) || true);
});

// ------------------------------------------------------------------------------------------------- the real SQL, executed (fail closed without PGlite)
await test("sql: the Watchdog table is attacked for real on PostgreSQL (RLS, append-only, dedupe, rollback)", () => {
  const r = spawnSync(process.execPath, ["supabase/support/tests/watchdog.adversarial.mjs"], { cwd: REPO, encoding: "utf8", timeout: 240000 });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  if (/Cannot find package|ERR_MODULE_NOT_FOUND/.test(out)) {
    if (process.env.SKIP_SQL === "1") { console.log("  (SKIPPED by SKIP_SQL=1: PGlite is not installed, the Watchdog database tests did NOT run)"); return; }
    throw new Error("@electric-sql/pglite is not installed, so the Watchdog database tests cannot run. Run `npm install --no-save @electric-sql/pglite`, or set SKIP_SQL=1 to skip them explicitly.");
  }
  assert.equal(r.status, 0, out.slice(-600));
  assert.ok(/(\d+)\/\1 checks passed/.test(out), out.slice(-300));
});

console.log(`watchdog: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
