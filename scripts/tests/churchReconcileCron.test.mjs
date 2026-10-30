// The scheduled payment sweeps (church gifts and Shop payments): secret protection, counts-only answers, safe failure, and the schedule itself. OFFLINE: the gift flow is a recording stub, nothing reaches Fapshi or a database.
//   Run:  node scripts/tests/churchReconcileCron.test.mjs
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { kit, REPO, SRC } from "./ministryApiHarness.mjs";

const require = createRequire(import.meta.url);
const { check, eq, section, summary } = kit();
console.error = () => {};
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const strip = (s) => s.replace(/\/\/[^\n]*/g, "");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "church-reconcile-cron-"));
const stub = (name, body) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, body);
  return p;
};
globalThis.__sweeps = [];
globalThis.__sweepMode = "ok";
const alias = {
  "@/lib/church/giving/gifts/flow": stub("flow.ts", `export async function reconcileGifts(deps, opts) { globalThis.__sweeps.push(opts); if (globalThis.__sweepMode === "throw") throw new Error("fapshi secret detail 0612345678"); return { checked: 3, settled: 1, failed: 0, stillPending: 2 }; }`),
  "@/lib/church/giving/gifts/http": stub("http.ts", `export function buildGiftDeps() { return { stub: true }; }`),
  "@": SRC,
};
const jiti = require("jiti")(import.meta.url, { alias, interopDefault: true, cache: false, requireCache: false });
const route = jiti(path.join(SRC, "app/api/cron/reconcile-church-gifts/route.ts"));
const call = (auth) => route.GET(new Request("http://test.local/api/cron/reconcile-church-gifts", { headers: auth === undefined ? {} : { authorization: auth } }));

const saved = process.env.CRON_SECRET;

section("A. the gift sweep refuses everyone without the secret: ");
{
  delete process.env.CRON_SECRET;
  for (const h of [undefined, "Bearer undefined", "Bearer ", "", "Bearer"]) eq(`no secret configured, header ${JSON.stringify(h)}`, (await call(h)).status, 401);
  process.env.CRON_SECRET = "";
  eq("an EMPTY secret authorises nothing", (await call("Bearer ")).status, 401);
  process.env.CRON_SECRET = "s3cret-value";
  for (const h of [undefined, "Bearer wrong", "Bearer s3cret-valu", "Bearer s3cret-value2", "s3cret-value", "bearer s3cret-value"]) eq(`wrong header ${JSON.stringify(h)}`, (await call(h)).status, 401);
  eq("nothing was swept by any refused request", globalThis.__sweeps.length, 0);
}

section("B. with the secret it sweeps once, bounded, and answers counts only: ");
{
  process.env.CRON_SECRET = "s3cret-value";
  const res = await call("Bearer s3cret-value");
  const body = await res.json();
  eq("200 with the counts", [res.status, body.ok, body.checked, body.settled, body.failed, body.stillPending], [200, true, 3, 1, 0, 2]);
  eq("exactly one sweep, with a bounded limit", [globalThis.__sweeps.length, globalThis.__sweeps[0].limit], [1, 50]);
  check("the answer carries no id, phone, amount or text", Object.keys(body).sort().join() === "checked,failed,ok,settled,stillPending");

  globalThis.__sweepMode = "throw";
  const bad = await call("Bearer s3cret-value");
  const badText = await bad.text();
  check("a failing sweep is a plain 500 that echoes nothing from the error", bad.status === 500 && !/fapshi|secret|0612345678/i.test(badText), badText);
  globalThis.__sweepMode = "ok";
}

section("C. the route and the schedule: ");
{
  const src = strip(read("src/app/api/cron/reconcile-church-gifts/route.ts"));
  check("the comparison is constant-time and an unset secret rejects", /timingSafeEqual/.test(src) && /if \(!secret\) return false/.test(src));
  check("the route has no settlement logic of its own: it only calls the shared sweep", /reconcileGifts\(buildGiftDeps\(\), \{ limit: 50 \}\)/.test(src) && !/fapshi|\.from\(|rpc\(|createAdminClient/i.test(src.replace(/buildGiftDeps|Buffer\.from/g, "")));
  check("GET only", !/export (async )?function (POST|PUT|PATCH|DELETE)/.test(src));
  const crons = JSON.parse(read("vercel.json")).crons;
  const once = (p) => crons.filter((c) => c.path === p).length === 1;
  check("each payment sweep is scheduled exactly once", once("/api/cron/reconcile-church-gifts") && once("/api/cron/reconcile-product-payments"));
  check("every schedule is daily (the hosting plan allows one run a day)", crons.every((c) => /^\d{1,2} \d{1,2} \* \* \*$/.test(c.schedule)));
  check("the older schedules are untouched (the first nine are exactly as they were)", crons.slice(0, 9).map((c) => `${c.path}@${c.schedule}`).join() === "/api/cron/downgrade-expired@0 3 * * *,/api/cron/cleanup-demo-accounts@0 4 * * *,/api/cron/protection-auto-release@0 5 * * *,/api/cron/content-calendar-reminders@0 6 * * *,/api/cron/ambassador-activation-sweep@0 7 * * *,/api/cron/reconcile-signup-payments@0 8 * * *,/api/cron/invoice-reminders@0 9 * * *,/api/cron/inbox-follow-ups@0 10 * * *,/api/cron/church-push@0 6 * * *");
  check("the two new sweeps run at different times", new Set(crons.map((c) => c.schedule)).size >= 9 && crons.find((c) => /reconcile-church-gifts/.test(c.path)).schedule !== crons.find((c) => /reconcile-product-payments/.test(c.path)).schedule);
  const shop = strip(read("src/app/api/cron/reconcile-product-payments/route.ts"));
  check("the Shop sweep route that is now scheduled is secret-protected the same way", /timingSafeEqual/.test(shop) && /if \(!secret\) return false/.test(shop));
  check("every cron route in the project requires the secret", fs.readdirSync(path.join(SRC, "app/api/cron")).every((d) => /CRON_SECRET/.test(read(`src/app/api/cron/${d}/route.ts`))));
  check("the manual administrator sweep is still admin-only and not scheduled", /assertAdmin/.test(read("src/app/api/admin/church/gifts-reconcile/route.ts")) && !crons.some((c) => /admin/.test(c.path)));
  const flow = strip(read("src/lib/church/giving/gifts/flow.ts"));
  check("a gift is settled only from the provider's own answer (status asked of Fapshi, amount checked)", /provider\.getStatus\(/.test(flow) && /amount/.test(flow));
}

if (saved === undefined) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = saved;
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(summary());
