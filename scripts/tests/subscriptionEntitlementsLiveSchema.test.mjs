// Live production-schema regression test for the subscription-entitlement owner-plan lookup.
//
// Two lessons learned the hard way on this exact feature, both invisible to any in-memory fake-DB
// test:
//   1. PostgREST's `table!column(...)` embed shorthand only resolves against a REAL, discoverable
//      foreign key (the /admin/protection PGRST200 incident).
//   2. An embedded relation that the CURRENT ROLE has no RLS access to doesn't error — it silently
//      resolves to `null`. The first deployed version of this feature embedded `users!user_id(plans(...))`
//      inside the public page's own ANON-key query; that query verified fine against the SERVICE
//      ROLE key (which bypasses RLS) but silently returned `users: null` for every real anonymous
//      visitor once live, since anon has no RLS access to the `users` table at all — meaning the
//      "current plan" was always read as null (= unlimited), and the entire entitlement limit
//      silently never applied in production. Fixed by moving the owner-plan lookup to the admin
//      client (see [username]/page.tsx and m/[username]/page.tsx's own comments), the same pattern
//      that file's pre-existing staffBadges lookup already used for the identical reason.
//
// This file proves BOTH failure modes are closed: the admin-client lookup resolves correctly, and
// the anon key genuinely cannot read `users`/`plans` directly (confirming RLS itself is unchanged —
// the fix is in application code routing around it via the admin client, never in weakening RLS).
//
// Skips gracefully (exit 0) when no live credentials are available.
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
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.log("subscription_entitlements_live_schema: SKIPPED (Supabase credentials not set)");
  process.exit(0);
}

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

function req(pathAndQuery, key) {
  return new Promise((resolve, reject) => {
    const r = https.request(
      `${env.NEXT_PUBLIC_SUPABASE_URL}${pathAndQuery}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data }));
      }
    );
    r.on("error", reject);
    r.end();
  });
}

(async () => {
  // Find a real published profile to test against, via the service-role key.
  const profileRes = await req(`/rest/v1/profiles?select=id,user_id,username&published=eq.true&limit=1`, env.SUPABASE_SERVICE_ROLE_KEY);
  const profile = JSON.parse(profileRes.data)?.[0];
  check("found a real published profile to test against", !!profile?.user_id, profileRes.data);
  if (!profile?.user_id) {
    console.log(`\nsubscription_entitlements_live_schema: ${results.filter((r) => r.pass).length}/${results.length} checks passed`);
    process.exit(1);
  }

  {
    // Exactly the query [username]/page.tsx and m/[username]/page.tsx now run via createAdminClient().
    const q = encodeURIComponent("plans(max_links,max_products,custom_theme_enabled)");
    const r = await req(`/rest/v1/users?select=${q}&id=eq.${profile.user_id}`, env.SUPABASE_SERVICE_ROLE_KEY);
    const row = JSON.parse(r.data)?.[0];
    check("the admin-client owner-plan lookup resolves and returns a real plan object (not null)", r.status === 200 && !!row?.plans, r.data);
  }

  {
    // The failure mode this file exists to catch: the SAME lookup, but through anon (what the old,
    // buggy code effectively relied on by embedding it in the public page's own anon-key query).
    // This MUST come back empty/null — if it ever starts returning real plan data, RLS on `users`
    // has been weakened, which is a separate, serious problem to investigate immediately.
    const q = encodeURIComponent("plans(max_links,max_products)");
    const r = await req(`/rest/v1/users?select=${q}&id=eq.${profile.user_id}`, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const rows = JSON.parse(r.data);
    const gotRealData = Array.isArray(rows) && rows.length > 0 && rows[0]?.plans != null;
    check(
      "anon truly cannot read the owner's plan directly — confirms the admin-client route-around is necessary, and that RLS itself was never weakened",
      !gotRealData,
      r.data
    );
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nsubscription_entitlements_live_schema: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
