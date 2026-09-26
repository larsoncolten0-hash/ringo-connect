// Cron route authentication: an UNSET (or empty) CRON_SECRET must never authorise a request — in
// particular the literal header "Bearer undefined" must not match. Covers the two daily jobs that used
// the bare `Bearer ${process.env.CRON_SECRET}` comparison. No database, no network: every import the
// routes make is stubbed, and the stub for the admin client throws a sentinel so the tests can tell
// "rejected before doing any work" from "authorised and started working".
//   Run:  node scripts/tests/cronAuth.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", detail); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cron-auth-"));
const stub = (name, body) => { const p = path.join(tmp, name); fs.writeFileSync(p, body); return p; };
const SRC = path.join(REPO, "src");
const alias = {
  "@/lib/supabase/server": stub("supa.ts", `export function createAdminClient() { (globalThis as any).__reached = ((globalThis as any).__reached || 0) + 1; throw new Error("REACHED"); }`),
  "@/lib/subscriptionReminderSettings": stub("rem.ts", `export async function getSubscriptionReminderSettings() { throw new Error("REACHED"); }`),
  "@/lib/notifications": stub("notif.ts", `export async function notifyUser() {}`),
  "@/lib/push/send": stub("push.ts", `export async function sendPushToUser() {}`),
  "@/lib/email/provider": stub("email.ts", `export async function sendEmail() {}`),
  "@/lib/email/emailShell": stub("shell.ts", `export function emailShell() { return ""; }`),
  "@": SRC,
};
const jiti = require("jiti")(import.meta.url, { alias, interopDefault: true, cache: false, requireCache: false });
const routes = {
  "downgrade-expired": jiti(path.join(SRC, "app/api/cron/downgrade-expired/route.ts")),
  "cleanup-demo-accounts": jiti(path.join(SRC, "app/api/cron/cleanup-demo-accounts/route.ts")),
};

const saved = process.env.CRON_SECRET;
const call = async (route, auth) => {
  globalThis.__reached = 0;
  const req = new Request("http://localhost/api/cron/x", { headers: auth === undefined ? {} : { authorization: auth } });
  const quiet = console.error; console.error = () => {};
  try {
    const res = await route.GET(req);
    return { status: res.status, reached: globalThis.__reached, threw: false };
  } catch (e) {
    return { status: null, reached: globalThis.__reached, threw: /REACHED/.test(e.message) };
  } finally { console.error = quiet; }
};

for (const [name, route] of Object.entries(routes)) {
  delete process.env.CRON_SECRET;
  let r = await call(route, "Bearer undefined");
  check(`${name}: CRON_SECRET unset + "Bearer undefined" -> 401, no work started`, r.status === 401 && r.reached === 0, JSON.stringify(r));
  r = await call(route, undefined);
  check(`${name}: CRON_SECRET unset + no header -> 401`, r.status === 401 && r.reached === 0);
  r = await call(route, "Bearer ");
  check(`${name}: CRON_SECRET unset + "Bearer " -> 401`, r.status === 401 && r.reached === 0);
  process.env.CRON_SECRET = "";
  r = await call(route, "Bearer ");
  check(`${name}: CRON_SECRET empty + "Bearer " -> 401 (an empty secret authorises nothing)`, r.status === 401 && r.reached === 0);
  r = await call(route, "Bearer ");
  process.env.CRON_SECRET = "s3cret-value";
  r = await call(route, undefined);
  check(`${name}: secret set, no header -> 401`, r.status === 401 && r.reached === 0);
  r = await call(route, "Bearer wrong");
  check(`${name}: secret set, wrong secret -> 401`, r.status === 401 && r.reached === 0);
  r = await call(route, "Bearer undefined");
  check(`${name}: secret set, "Bearer undefined" -> 401`, r.status === 401 && r.reached === 0);
  r = await call(route, "Bearer s3cret-value");
  check(`${name}: correct secret still authorises (behaviour preserved: the job starts)`, r.reached >= 1 && r.status !== 401, JSON.stringify(r));
}

// every cron route in the app now refuses an unset secret
const dir = path.join(REPO, "src/app/api/cron");
for (const d of fs.readdirSync(dir)) {
  const f = path.join(dir, d, "route.ts"); if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
  const guarded = /!\s*(process\.env\.CRON_SECRET|secret)\b/.test(src);
  check(`source: /api/cron/${d} rejects when CRON_SECRET is unset`, guarded);
}
// scheduling: the original two daily jobs are unchanged; Ringo Protection
// Phase 12 legitimately added its own auto-release cron alongside them.
check("source: vercel.json still has the original two daily jobs, plus only the Protection auto-release cron", JSON.stringify(JSON.parse(fs.readFileSync(path.join(REPO, "vercel.json"), "utf8"))) === JSON.stringify({ crons: [{ path: "/api/cron/downgrade-expired", schedule: "0 3 * * *" }, { path: "/api/cron/cleanup-demo-accounts", schedule: "0 4 * * *" }, { path: "/api/cron/protection-auto-release", schedule: "0 5 * * *" }] }));

if (saved === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = saved;
fs.rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
