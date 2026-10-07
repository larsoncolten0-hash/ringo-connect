// Security Phase 7 hardening (testing & observability): the audit rows and events added after the Phase 7 audit, and the fail-closed security suite.
//   1. payout destination change -> one audit row + one owner notification, metadata only (no phone / email / account number, no masked value)
//   2. the four admin routes that wrote no audit row now do (ambassador-settings was already audited through ambassador_log_action)
//   3. a failed admin payout send and an over-balance payout request refusal are recorded as a category only, never the provider's text
//   4. PGlite missing = FAIL (wrappers and the aggregator), unless SKIP_SQL=1 is set explicitly
// No network, no Supabase, no Fapshi, no money.     Run:  node scripts/tests/securityPhase7.test.mjs
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

const P = jiti(path.join(SRC, "lib/payoutAudit.ts"));
const { translations } = jiti(path.join(SRC, "lib/i18n/translations.ts"));

// a recording stand-in for the service-role client: every insert is kept, every read comes back empty (so no push subscription exists and nothing is delivered)
function fakeAdmin() {
  const inserts = [];
  const chain = (table) => {
    const q = { _t: table };
    for (const m of ["select", "eq", "in", "is", "not", "neq", "gte", "lte", "order", "limit", "update", "delete", "or", "match"]) q[m] = () => q;
    q.insert = (row) => { inserts.push({ table, row }); return q; };
    q.maybeSingle = async () => ({ data: null, error: null });
    q.single = async () => ({ data: null, error: null });
    q.then = (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
    return q;
  };
  return { inserts, from: chain, rpc: async () => ({ data: [], error: null }) };
}
const PHONE = "670123456", EMAIL = "owner@example.test", ACCT = "ACCT-9988776655", NAME = "Jane Owner";
const mm = { method: "mobile_money", details: { phone: PHONE, provider: "mtn" } };
const dump = (a) => JSON.stringify(a.inserts);

// ----------------------------------------------------------------------------------------------------------------- 1. payout destination
await test("destination: classification (added / changed / removed / unchanged; a re-save of the same value is unchanged)", () => {
  assert.equal(P.classifyDestinationChange(null, mm), "added");
  assert.equal(P.classifyDestinationChange({ method: null, details: null }, mm), "added");
  assert.equal(P.classifyDestinationChange(mm, mm), "unchanged");
  assert.equal(P.classifyDestinationChange(mm, { method: "mobile_money", details: { provider: "mtn", phone: ` ${PHONE} ` } }), "unchanged"); // key order / whitespace
  assert.equal(P.classifyDestinationChange(mm, { method: "mobile_money", details: { phone: "671000000", provider: "mtn" } }), "changed");
  assert.equal(P.classifyDestinationChange(mm, { method: "mobile_money", details: { phone: PHONE, provider: "orange" } }), "changed");
  assert.equal(P.classifyDestinationChange(mm, { method: "paypal", details: { email: EMAIL } }), "changed");
  assert.equal(P.classifyDestinationChange(mm, { method: null }), "removed");
  assert.equal(P.classifyDestinationChange(null, null), "unchanged");
});
await test("destination: a change writes ONE audit row and ONE owner bell; neither contains the phone, email, account number or name", async () => {
  const a = fakeAdmin();
  const c = await P.recordPayoutDestinationChange(a, { userId: "u-1", previous: mm, next: { method: "bank", details: { accountName: NAME, accountNumber: ACCT, bankName: "B", phone: PHONE, email: EMAIL } } });
  assert.equal(c, "changed");
  const audit = a.inserts.filter((i) => i.table === "admin_audit_log");
  const bell = a.inserts.filter((i) => i.table === "notifications").map((i) => ({ ...i, row: Array.isArray(i.row) ? i.row[0] : i.row })); // the bell helper inserts an array of rows
  assert.equal(audit.length, 1);
  assert.equal(bell.length, 1);
  assert.deepEqual({ admin_id: audit[0].row.admin_id, action: audit[0].row.action, target: audit[0].row.target_user_id }, { admin_id: "u-1", action: "payout_destination_changed", target: "u-1" });
  assert.deepEqual(audit[0].row.details, { programs: ["affiliate", "music", "shop"], change: "changed", method: "bank", previousMethod: "mobile_money", methodChanged: true });
  assert.equal(bell[0].row.type, "payout_destination_changed");
  assert.equal(bell[0].row.user_id, "u-1");
  for (const secret of [PHONE, EMAIL, ACCT, NAME, "670", "mtn"]) assert.ok(!dump(a).includes(secret), `leaked ${secret}`);
});
await test("destination: first-time add uses the 'added' copy; re-saving the same destination records nothing", async () => {
  const a = fakeAdmin();
  assert.equal(await P.recordPayoutDestinationChange(a, { userId: "u-2", previous: null, next: mm }), "added");
  assert.equal(a.inserts.find((i) => i.table === "admin_audit_log").row.details.change, "added");
  assert.match([].concat(a.inserts.find((i) => i.table === "notifications").row)[0].title, /added/i);
  const b = fakeAdmin();
  assert.equal(await P.recordPayoutDestinationChange(b, { userId: "u-2", previous: mm, next: { ...mm } }), "unchanged");
  assert.equal(b.inserts.length, 0);
});
await test("destination: the notification text exists in English AND French and promises nothing the system does not do (no payout hold)", () => {
  for (const loc of ["en", "fr"]) for (const k of ["added", "changed"]) {
    const c = translations[loc].payoutDestinationNotifications[k];
    assert.ok(c.title.length > 5 && c.body.length > 20, `${loc}.${k}`);
    assert.ok(!/24|hold|suspend/i.test(c.body), `${loc}.${k} must not claim a payout hold`);
  }
  assert.notEqual(translations.en.payoutDestinationNotifications.changed.title, translations.fr.payoutDestinationNotifications.changed.title);
});
await test("destination: an audit or notification failure never throws into the request", async () => {
  const broken = { from() { throw new Error("db down"); } };
  const c = await P.recordPayoutDestinationChange(broken, { userId: "u-3", previous: null, next: mm });
  assert.equal(c, "added");
});
await test("destination: the route reads the previous value, saves, THEN records; the save logic and response are unchanged", () => {
  const s = read("src/app/api/affiliate/payout-method/route.ts");
  assert.ok(s.indexOf('.select("affiliate_payout_method, affiliate_payout_details")') < s.indexOf("await saveAffiliatePayoutMethod("));
  assert.ok(s.indexOf("await saveAffiliatePayoutMethod(") < s.indexOf("await recordPayoutDestinationChange("));
  assert.ok(s.includes("return NextResponse.json({ ok: true });"));
  assert.ok(/return NextResponse\.json\(\{ error: err\.message \|\| "Could not save payout method\." \}, \{ status: 400 \}\);\s*\}\s*\/\/ Audit row/.test(s), "a failed save returns before anything is recorded");
  assert.equal(read("src/lib/affiliate.ts").match(/export async function saveAffiliatePayoutMethod[\s\S]*?\n\}/)[0].includes("payoutAudit"), false);
});

// ----------------------------------------------------------------------------------------------------------------- 2. the admin routes
const ADMIN = "src/app/api/admin/";
await test("admin audit: add-ons (create + price update), branding (settings + upload), request charge and request reject each write an audit row", () => {
  const need = [
    ["addons/route.ts", "addon_created"], ["addons/[id]/route.ts", "addon_updated"], ["branding/route.ts", "branding_updated"], ["branding/upload/route.ts", "branding_asset_uploaded"],
    ["requests/[id]/charge/route.ts", "request_charge_started"], ["requests/[id]/reject/route.ts", "request_rejected"],
  ];
  for (const [f, action] of need) {
    const s = read(ADMIN + f);
    assert.ok(s.includes('import { recordAudit } from "@/lib/adminAudit";'), f);
    assert.ok(new RegExp(`recordAudit\\([^)]*actorId: admin\\.id, action: "${action}"|action: "${action}"`).test(s), `${f} -> ${action}`);
    assert.ok(s.indexOf("assertAdmin()") < s.indexOf("recordAudit("), `${f}: audited after the admin check`);
  }
});
await test("admin audit: the rows carry ids and field names only (no phone, no free-text reason, no secret)", () => {
  const charge = read(ADMIN + "requests/[id]/charge/route.ts");
  assert.ok(/action: "request_charge_started", details: \{ requestId: params\.id, transId: result\.transId, amount, medium, planId \}/.test(charge));
  assert.ok(!/recordAudit\([^;]*\bphone\b/.test(charge));
  const rej = read(ADMIN + "requests/[id]/reject/route.ts");
  assert.ok(/details: \{ requestId: params\.id, hasReason: !!reason \}/.test(rej) && !/details: \{[^}]*reason: reason/.test(rej));
  assert.ok(/updated && updated\.length > 0/.test(rej), "only when a pending request was actually rejected");
  assert.ok(/fields: Object\.keys\(body\)/.test(read(ADMIN + "branding/route.ts")));
});
await test("admin audit: the audited actions run AFTER the mutation succeeded and the HTTP answers are unchanged", () => {
  const a = read(ADMIN + "addons/[id]/route.ts");
  assert.ok(a.indexOf('.update(patch).eq("id", params.id)') < a.indexOf("recordAudit("));
  assert.ok(a.includes("return NextResponse.json({ ok: true });") && a.includes('return NextResponse.json({ error: error.message }, { status: 400 });'));
  const ch = read(ADMIN + "requests/[id]/charge/route.ts");
  assert.ok(ch.indexOf('.update({ pending_fapshi_trans_id: result.transId })') < ch.indexOf("recordAudit(") && ch.includes("return NextResponse.json({ transId: result.transId });"));
});
await test("admin audit: ambassador-settings was already audited (ambassador_log_action with before/after) and still is", () => {
  const s = read("src/lib/ambassador/settings.ts");
  assert.ok(s.includes('p_action: "min_payout_changed"') && s.includes("p_before:") && s.includes("p_after:"));
  assert.ok(read(ADMIN + "ambassador-settings/route.ts").includes("setAmbassadorPayoutMinimum(createAdminClient(), admin.id"));
});

// ----------------------------------------------------------------------------------------------------------------- 3. failed sends, refused requests
await test("failed send: category only (never the provider text), with the admin, the payout and the earner; 'sent but not recorded' is its own category", async () => {
  const providerErr = Object.assign(new Error(`Fapshi said: bad number ${PHONE} for ${EMAIL}`), { httpStatus: 400, uncertain: false });
  assert.equal(P.payoutSendFailureCategory(providerErr, false), "provider_rejected");
  assert.equal(P.payoutSendFailureCategory(Object.assign(new Error("x"), { uncertain: true }), false), "provider_uncertain");
  assert.equal(P.payoutSendFailureCategory(new Error("x"), true), "sent_but_not_recorded");
  const a = fakeAdmin();
  await P.recordPayoutSendFailure(a, { adminId: "adm-1", program: "music", payoutId: "po-1", earnerUserId: "u-9", err: providerErr });
  assert.equal(a.inserts.length, 1);
  assert.deepEqual(a.inserts[0].row, { admin_id: "adm-1", action: "send_music_payout_failed", target_user_id: "u-9", details: { payoutId: "po-1", program: "music", category: "provider_rejected", providerHttpStatus: 400 } });
  for (const secret of [PHONE, EMAIL, "Fapshi said", "bad number"]) assert.ok(!dump(a).includes(secret), `leaked ${secret}`);
  const b = fakeAdmin();
  await P.recordPayoutSendFailure(b, { adminId: "adm-1", program: "shop", payoutId: "po-2", err: new Error("db"), transId: "TX123" });
  assert.deepEqual(b.inserts[0].row.details, { payoutId: "po-2", program: "shop", category: "sent_but_not_recorded", transId: "TX123" });
});
await test("failed send: all three admin send routes record it in the catch, keep the 502 answer, and track the moment Fapshi accepted the money", () => {
  for (const [prog, f] of [["music", "music"], ["affiliate", "affiliate"], ["shop", "shop"]]) {
    const s = read(`${ADMIN}${f}/payouts/[id]/send/route.ts`);
    assert.ok(s.includes("let sentTransId: string | null = null;"));
    assert.ok(s.indexOf("const result = await fapshiPayout(") < s.indexOf("sentTransId = result.transId;") && s.indexOf("sentTransId = result.transId;") < s.search(/await mark\w*Processing\(/));
    const c = s.slice(s.indexOf("} catch (err: any) {"));
    assert.ok(c.includes(`recordPayoutSendFailure(adminClient, { adminId: admin.id, program: "${prog}"`) && c.includes("transId: sentTransId"));
    assert.ok(c.includes("{ status: 502 }") && c.includes("err.message || \"Could not start the Fapshi disbursement.\""), "the answer to the admin is unchanged");
    assert.ok(!/recordPayoutSendFailure\([^)]*err\.message/.test(c), "never the provider message");
  }
});
await test("refused request: payout_exceeds_available is recorded (program + reason only); ordinary refusals and non-errors are not", async () => {
  const a = fakeAdmin();
  assert.equal(await P.recordPayoutRequestRefusal(a, { userId: "u-5", program: "affiliate", err: new Error('payout_exceeds_available: requested 5000 but only 0 is available') }), true);
  assert.deepEqual(a.inserts[0].row, { admin_id: "u-5", action: "payout_request_refused", target_user_id: "u-5", details: { program: "affiliate", reason: "payout_exceeds_available" } });
  assert.ok(!dump(a).includes("5000"), "the amounts are not copied into the row");
  const b = fakeAdmin();
  for (const err of [new Error("Your available balance (0 XAF) is below the XAF minimum payout of 5000 XAF."), new Error("Add a payout method before requesting a payout."), null, undefined, {}]) {
    assert.equal(await P.recordPayoutRequestRefusal(b, { userId: "u-5", program: "music", err }), false);
  }
  assert.equal(b.inserts.length, 0);
});
await test("refused request: the three payout request routes record it first in the catch and still return the SAME 400 with the SAME message", () => {
  for (const [prog, f] of [["affiliate", "affiliate/payouts"], ["music", "music/payouts"], ["shop", "shop/payouts"]]) {
    const s = read(`src/app/api/${f}/route.ts`);
    const c = s.slice(s.indexOf("} catch (err: any) {"));
    assert.ok(c.indexOf(`recordPayoutRequestRefusal(createAdminClient(), { userId: user.id, program: "${prog}", err })`) > 0);
    assert.ok(c.includes('return NextResponse.json({ error: err.message || "Could not request a payout." }, { status: 400 });'));
  }
});
await test("nothing in the observability code touches amounts, eligibility, the Fapshi call, RLS or the payout functions", () => {
  const code = read("src/lib/payoutAudit.ts") + read("src/lib/adminAudit.ts");
  assert.ok(!/fapshiPayout|fapshiDirectPay|\.rpc\(|\.update\(|\.delete\(/.test(code.replace(/\/\/[^\n]*/g, "")));
  assert.ok(!/^\s*(create|alter)\s+(policy|table|function)/im.test(code));
  assert.ok(!fs.readdirSync(path.join(REPO, "supabase/migrations")).some((f) => /^2026-10-07d/.test(f)), "no migration is part of this change");
});

// ----------------------------------------------------------------------------------------------------------------- 4. fail closed + the aggregator
const run = (file, args = [], env = {}) => spawnSync(process.execPath, [path.join(REPO, file), ...args], { cwd: REPO, encoding: "utf8", timeout: 300000, env: { ...process.env, SKIP_SQL: "", ...env } });
const NO_PGLITE = "@electric-sql/pglite-not-installed-for-this-test";
await test("fail closed: the Phase 2 wrapper FAILS when PGlite is unavailable, and passes only with SKIP_SQL=1 (and says it skipped)", () => {
  const closed = run("scripts/tests/securityPhase2.test.mjs", [], { PGLITE_ENTRY: NO_PGLITE });
  assert.notEqual(closed.status, 0, "must fail without PGlite");
  assert.ok(/PGlite is not installed/.test(closed.stdout + closed.stderr));
  const open = run("scripts/tests/securityPhase2.test.mjs", [], { PGLITE_ENTRY: NO_PGLITE, SKIP_SQL: "1" });
  assert.equal(open.status, 0, open.stdout + open.stderr);
  assert.ok(/SKIPPED SQL run by SKIP_SQL=1/.test(open.stdout), "the skip must be announced, never silent");
});
await test("fail closed: the Phase 3 and Phase 6 wrappers behave the same way", () => {
  for (const f of ["securityPhase3", "securityPhase6"]) {
    assert.notEqual(run(`scripts/tests/${f}.test.mjs`, [], { PGLITE_ENTRY: NO_PGLITE }).status, 0, f);
    assert.equal(run(`scripts/tests/${f}.test.mjs`, [], { PGLITE_ENTRY: NO_PGLITE, SKIP_SQL: "1" }).status, 0, f);
  }
});
await test("fail closed: the Phase 1 wrapper source fails without PGlite unless SKIP_SQL=1", () => {
  const s = read("scripts/tests/securityPhase1.test.mjs");
  assert.ok(/if \(process\.env\.SKIP_SQL === "1"\)/.test(s) && /throw new Error\("@electric-sql\/pglite is not installed/.test(s));
  assert.ok(!/\(skipped: @electric-sql\/pglite is not installed[^)]*\)"\); return; \}\n/.test(s), "the old silent skip is gone");
});
await test("aggregator: lists every suite, every suite file exists, covers Phases 1-7 and the standalone adversarial scripts", () => {
  const list = run("scripts/security-suite.mjs", ["--list"]);
  assert.equal(list.status, 0);
  const files = [...list.stdout.matchAll(/(scripts\/tests\/\S+|supabase\/support\/tests\/\S+)  -/g)].map((m) => m[1]);
  assert.ok(files.length >= 16, `only ${files.length} suites`);
  for (const f of files) assert.ok(fs.existsSync(path.join(REPO, f)), `${f} missing`);
  for (const must of ["securityPhase1", "securityPhase2", "securityPhase3", "securityPhase4", "securityPhase5", "securityPhase6", "securityPhase7", "security_phase1.adversarial", "team_permission_ceiling.adversarial", "private_file_path.adversarial", "payout_concurrency.adversarial"]) assert.ok(files.some((f) => f.includes(must)), must);
});
await test("aggregator: without PGlite it FAILS up front (exit 1, names the suites); with SKIP_SQL=1 the standalone SQL suites are SKIPPED, never passed", () => {
  const closed = run("scripts/security-suite.mjs", ["phase2-sql"], { PGLITE_ENTRY: NO_PGLITE });
  assert.equal(closed.status, 1);
  assert.ok(/FAIL: @electric-sql\/pglite is not installed/.test(closed.stderr) && /phase2-sql/.test(closed.stderr));
  const open = run("scripts/security-suite.mjs", ["phase2-sql"], { PGLITE_ENTRY: NO_PGLITE, SKIP_SQL: "1" });
  assert.equal(open.status, 0, open.stdout + open.stderr);
  assert.ok(/SKIPPED 1/.test(open.stdout) && /not a full security pass/.test(open.stdout) && !/Security suite passed\./.test(open.stdout));
});
await test("aggregator: a failing suite makes it exit non-zero and a missing suite file counts as a failure", () => {
  const src = read("scripts/security-suite.mjs");
  assert.ok(src.includes("process.exit(1)") && /suite file is MISSING/.test(src) && /r\.status !== 0/.test(src));
  assert.ok(!/status: "PASS"[^\n]*existsSync/.test(src));
});
await test("package.json: exactly one script added (security:test), nothing else touched", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["security:test"], "node scripts/security-suite.mjs");
  assert.deepEqual(Object.keys(pkg.scripts), ["dev", "build", "start", "lint", "validate:ai-knowledge", "security:test"]);
});

console.log(`securityPhase7: ${passed} passed, ${failures.length} failed`);
if (failures.length) { console.log("FAILURES:\n - " + failures.join("\n - ")); process.exit(1); }
