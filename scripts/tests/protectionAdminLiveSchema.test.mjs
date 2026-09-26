// Ringo Protection — live production-schema regression test for the admin read models.
//
// Why this file exists: /admin/protection, /admin/protection/[id], /admin/protection/disputes, and
// /admin/protection/refunds all threw in production (PGRST200) because their reader functions used
// PostgREST's `table!column(...)` embed shorthand against protection_transactions.target_id /
// protection_disputes.order_id / protection_refunds.order_id — columns that are DELIBERATELY
// unconstrained (no real foreign key to product_orders; see
// 2026-11-06_ringo_protection_foundation.sql's own comment on target_id being a polymorphic
// reference). PostgREST can only resolve an embed against a real, discoverable FK, so this class of
// bug can ONLY be caught against a real Postgres+PostgREST schema — every other Protection test file
// in this repo uses an in-memory fake DB that happily returns whatever shape you hand it, and would
// never have caught this. This file is a deliberate exception: it makes real, read-only calls
// against the actual configured Supabase project (via the service-role key already used for every
// "live verification" pass elsewhere in this project's history) and simply asserts the reader
// functions do not throw.
//
// This is NOT part of the always-required fully-offline suite — it needs real network access and
// .env.local's real credentials. It skips gracefully (exit 0) rather than failing if those aren't
// available, so it never blocks a sandboxed/offline run. Run it explicitly whenever a Protection
// admin reader's query shape changes, to catch exactly this regression class before it reaches
// production again.
//   Run:  node scripts/tests/protectionAdminLiveSchema.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const envPath = path.join(REPO, ".env.local");

if (!fs.existsSync(envPath)) {
  console.log("protection_admin_live_schema: SKIPPED (.env.local not found — no live credentials available in this environment)");
  process.exit(0);
}
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("protection_admin_live_schema: SKIPPED (Supabase credentials not set)");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const L = (f) => jiti(path.join(REPO, "src/lib/protection", f));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

(async () => {
  {
    const { getProtectionAdminOverview } = L("adminOverview.ts");
    try {
      const overview = await getProtectionAdminOverview();
      check("getProtectionAdminOverview() resolves without throwing against the live schema", typeof overview === "object" && overview !== null);
    } catch (err) {
      check("getProtectionAdminOverview() resolves without throwing against the live schema", false, err?.message);
    }
  }
  {
    const { listAdminProtectionTransactions, getAdminProtectionTransactionDetail } = L("adminTransactions.ts");
    try {
      const rows = await listAdminProtectionTransactions();
      check("listAdminProtectionTransactions() resolves without throwing against the live schema (the exact call that threw PGRST200 in production)", Array.isArray(rows));
    } catch (err) {
      check("listAdminProtectionTransactions() resolves without throwing against the live schema (the exact call that threw PGRST200 in production)", false, err?.message);
    }
    try {
      // A nonexistent id still exercises the full query shape — PostgREST validates an embed's
      // resolvability at parse time, independent of whether any row actually matches the filter, so
      // this reproduces the same PGRST200 a real transaction id would.
      const detail = await getAdminProtectionTransactionDetail(NONEXISTENT_ID);
      check("getAdminProtectionTransactionDetail() resolves without throwing against the live schema", detail === null);
    } catch (err) {
      check("getAdminProtectionTransactionDetail() resolves without throwing against the live schema", false, err?.message);
    }
  }
  {
    const { listAdminProtectionDisputes } = L("adminDisputes.ts");
    try {
      const rows = await listAdminProtectionDisputes();
      check("listAdminProtectionDisputes() resolves without throwing against the live schema", Array.isArray(rows));
    } catch (err) {
      check("listAdminProtectionDisputes() resolves without throwing against the live schema", false, err?.message);
    }
  }
  {
    const { listAdminProtectionRefunds } = L("adminRefunds.ts");
    try {
      const rows = await listAdminProtectionRefunds();
      check("listAdminProtectionRefunds() resolves without throwing against the live schema", Array.isArray(rows));
    } catch (err) {
      check("listAdminProtectionRefunds() resolves without throwing against the live schema", false, err?.message);
    }
  }

  const passed = results.filter((r) => r.pass).length;
  console.log(`\nprotection_admin_live_schema: ${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})();
