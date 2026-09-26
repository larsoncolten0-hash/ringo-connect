// Live production-schema regression test for the new subscription-entitlement embed queries.
//
// Lesson learned the hard way (see the /admin/protection PGRST200 incident): PostgREST's
// `table!column(...)` embed shorthand only resolves against a REAL, discoverable foreign key — an
// in-memory fake DB test can't catch a broken embed, since it happily returns whatever shape you
// hand it regardless of whether Postgres could actually resolve that relationship. This file makes
// real, read-only calls (service-role key) against the actual configured Supabase project to prove
// the new `profiles -> users!user_id -> plans` embed (added to the main profile page and the music
// storefront page for plan-based content visibility) actually resolves.
//
// Skips gracefully (exit 0) when no live credentials are available, so it never blocks an offline
// run — but whenever it CAN run, it's the only thing that would catch this regression class.
//   Run:  node scripts/tests/subscriptionEntitlementsLiveSchema.test.mjs
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const envPath = path.join(REPO, ".env.local");

if (!fs.existsSync(envPath)) {
  console.log("subscription_entitlements_live_schema: SKIPPED (.env.local not found — no live credentials available in this environment)");
  process.exit(0);
}
const env = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("subscription_entitlements_live_schema: SKIPPED (Supabase credentials not set)");
  process.exit(0);
}

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

function get(selectClause) {
  return new Promise((resolve, reject) => {
    const q = encodeURIComponent(selectClause);
    const req = https.request(
      `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?select=${q}&published=eq.true&limit=1`,
      { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  {
    // Exactly the select shape src/app/[username]/page.tsx now uses.
    const r = await get("id,username,links(id,sort_order),products(id,sort_order),users!user_id(plans(max_links,max_products,custom_theme_enabled))");
    check("the main profile page's owner-plan embed resolves against the live schema (no PGRST200)", r.status === 200, r.data);
  }
  {
    // Exactly the select shape src/app/m/[username]/page.tsx now uses.
    const r = await get("id,username,products(id),users!user_id(plans(max_products))");
    check("the music storefront page's owner-plan embed resolves against the live schema (no PGRST200)", r.status === 200, r.data);
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nsubscription_entitlements_live_schema: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
