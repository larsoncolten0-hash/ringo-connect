// Ringo Protection — Phase 1 foundation checks (data model + settings only; no checkout, no
// charge, no release engine exists to test). No network, no real database, no Fapshi: everything
// here either exercises pure TypeScript logic (loaded through jiti, same convention as
// scripts/tests/ringo_ai_unit.test.mjs) or statically cross-checks the new migration's raw SQL
// text against the values the application code expects — the same technique
// scripts/tests/shopSeller.test.mjs already uses to keep a status list and its migration in sync
// without ever running SQL.
//
//   Run:  node scripts/tests/protectionFoundation.test.mjs
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const SRC = path.join(REPO, "src");
const jiti = require("jiti")(import.meta.url, { alias: { "@": SRC }, interopDefault: true });
const load = (p) => jiti(path.join(SRC, p));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const { mapProtectionSettingsRow, parseProtectionFeeRatePct, parseProtectionAutoReleaseHours } = load("lib/protectionSettings.ts");

const MIGRATION_PATH = "supabase/migrations/2026-11-06_ringo_protection_foundation.sql";
const migrationSql = read(MIGRATION_PATH);

// ============================================================== settings: defaults are OFF
check(
  "no row (migration not applied / never configured) -> protection disabled, fee unset, 48h default",
  (() => {
    const s = mapProtectionSettingsRow(null);
    return s.protectionEnabled === false && s.protectionFeeRate === null && s.protectionAutoReleaseHours === 48;
  })()
);
check(
  "a real row with protection_enabled=false and no fee still maps to the same safe shape",
  (() => {
    const s = mapProtectionSettingsRow({ protection_enabled: false, protection_fee_rate: null, protection_auto_release_hours: 48 });
    return s.protectionEnabled === false && s.protectionFeeRate === null && s.protectionAutoReleaseHours === 48;
  })()
);
check(
  "an enabled row with a configured fee rate maps correctly",
  (() => {
    const s = mapProtectionSettingsRow({ protection_enabled: true, protection_fee_rate: "0.0375", protection_auto_release_hours: 72 });
    return s.protectionEnabled === true && s.protectionFeeRate === 0.0375 && s.protectionAutoReleaseHours === 72;
  })()
);

// ============================================================== fee rate validation
check("3% -> 0.03", parseProtectionFeeRatePct(3) === 0.03);
check("3.5% -> 0.035", parseProtectionFeeRatePct(3.5) === 0.035);
check("3.75% -> 0.0375 (two decimal points of percentage precision)", parseProtectionFeeRatePct(3.75) === 0.0375);
check("0% -> 0 (a valid, if pointless, rate)", parseProtectionFeeRatePct(0) === 0);
check("100% -> 1 (upper bound accepted)", parseProtectionFeeRatePct(100) === 1);
check("null -> null (explicitly clears back to 'not configured')", parseProtectionFeeRatePct(null) === null);
check("negative fee rejected", throws(() => parseProtectionFeeRatePct(-1)));
check("fee over 100% rejected", throws(() => parseProtectionFeeRatePct(100.01)));
check("NaN fee rejected", throws(() => parseProtectionFeeRatePct(NaN)));
check("Infinity fee rejected", throws(() => parseProtectionFeeRatePct(Infinity)));

// ============================================================== auto-release hours validation
check("48 accepted", parseProtectionAutoReleaseHours(48) === 48);
check("1 accepted (minimum positive)", parseProtectionAutoReleaseHours(1) === 1);
check("0 rejected (must be positive)", throws(() => parseProtectionAutoReleaseHours(0)));
check("negative hours rejected", throws(() => parseProtectionAutoReleaseHours(-24)));
check("non-integer hours rejected", throws(() => parseProtectionAutoReleaseHours(48.5)));
check("NaN hours rejected", throws(() => parseProtectionAutoReleaseHours(NaN)));

// ============================================================== migration: schema/security invariants (static text checks — no SQL executed)
check("platform_settings.protection_enabled defaults to false", /protection_enabled boolean not null default false/.test(migrationSql));
check(
  "platform_settings.protection_fee_rate has NO default (never a guessed percentage)",
  /protection_fee_rate numeric\(5,4\);/.test(migrationSql) && !/protection_fee_rate numeric\(5,4\) not null default/.test(migrationSql)
);
check("platform_settings.protection_auto_release_hours defaults to 48", /protection_auto_release_hours int not null default 48/.test(migrationSql));

const EXPECTED_STATUSES = [
  "awaiting_payment",
  "protected",
  "fulfillment_started",
  "awaiting_confirmation",
  "released",
  "disputed",
  "resolved_release",
  "resolved_refund",
  "refunded",
  "cancelled",
  "expired",
  "payment_failed",
];
const statusCheckMatch = migrationSql.match(/status text not null default 'awaiting_payment' check \(status in \(([\s\S]*?)\)\)/);
const migrationStatuses = statusCheckMatch
  ? statusCheckMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
  : [];
check(
  "protection_transactions status list matches the designed state machine exactly",
  EXPECTED_STATUSES.length === migrationStatuses.length && EXPECTED_STATUSES.every((s) => migrationStatuses.includes(s)),
  JSON.stringify({ expected: EXPECTED_STATUSES, found: migrationStatuses })
);
check("status defaults to awaiting_payment", /status text not null default 'awaiting_payment'/.test(migrationSql));

// Immutable-column guard: every snapshot field must be in the frozen-column list, so an admin's
// later settings change can never retroactively alter an already-created transaction.
const FROZEN_COLUMNS = [
  "target_type",
  "target_id",
  "profile_id",
  "creator_user_id",
  "currency",
  "product_amount",
  "protection_fee_rate",
  "protection_fee_amount",
  "customer_total",
  "seller_protected_amount",
  "created_at",
];
const guardMatch = migrationSql.match(/create or replace function protection_transactions_guard\(\)[\s\S]*?end \$\$;/);
const guardBody = guardMatch ? guardMatch[0] : "";
for (const col of FROZEN_COLUMNS) {
  check(`protection_transactions_guard freezes "${col}"`, guardBody.includes(`new.${col}`));
}
check("status is NOT in the frozen list (must remain changeable for future transitions)", !/if new\.status/.test(guardBody));

// Append-only ledger: both UPDATE and DELETE must be unconditionally rejected.
check("protection_ledger_entries has a before-update reject trigger", /protection_ledger_entries_no_update_trg[\s\S]*?before update/.test(migrationSql));
check("protection_ledger_entries has a before-delete reject trigger", /protection_ledger_entries_no_delete_trg[\s\S]*?before delete/.test(migrationSql));
check("the ledger guard function unconditionally raises (append-only, not conditionally)", /raise exception 'protection_ledger_entries: append-only/.test(migrationSql));

// RLS: enabled on both tables, restrictive (no blanket authenticated write grant), ledger has no
// authenticated read policy at all.
check("RLS enabled on protection_transactions", /alter table protection_transactions enable row level security/.test(migrationSql));
check("RLS enabled on protection_ledger_entries", /alter table protection_ledger_entries enable row level security/.test(migrationSql));
check("anon/authenticated privileges revoked by default on both new tables", /revoke all on protection_transactions, protection_ledger_entries from anon, authenticated/.test(migrationSql));
check("only SELECT is granted to authenticated (never insert/update/delete)", /grant select on protection_transactions to authenticated/.test(migrationSql));
check(
  "protection_ledger_entries gets NO authenticated grant beyond the blanket revoke (admin/service-role only)",
  !/grant[^;]*protection_ledger_entries[^;]*to authenticated/.test(migrationSql)
);
check("owner-or-admin read policy exists for protection_transactions", /protection_transactions owner read/.test(migrationSql));

// Existing, protected surfaces must not be touched by this migration at all.
check("does not alter commerce_sale_earnings", !/alter table commerce_sale_earnings/.test(migrationSql));
check("does not alter product_orders", !/alter table product_orders/.test(migrationSql));
check("does not alter commerce_payouts", !/alter table commerce_payouts/.test(migrationSql));
check("does not touch the draft abuse-protection migration's own tables", !/commerce_rate_events|commerce_rate_limit_hit/.test(migrationSql));

const passed = results.filter((r) => r.pass).length;
console.log(`\nprotection_foundation: ${passed}/${results.length} checks passed`);
if (passed !== results.length) process.exit(1);
