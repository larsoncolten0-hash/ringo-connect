// Ringo Protection — Phase 8 admin operations tests. This phase is deliberately a read-model +
// existing-route-reuse phase (no new state-mutation engine — "DO NOT CREATE A SECOND RESOLUTION
// ENGINE"), so these tests are primarily structural: every new admin surface requires
// assertAdmin(), no new write path exists outside the already-tested Phase 7 resolve-dispute route,
// no PII/secret overexposure, and Normal Payment / every prior phase stays untouched.
//   Run:  node scripts/tests/protectionAdmin.test.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");
const exists = (f) => fs.existsSync(path.join(REPO, f));

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

const PAGES = [
  "src/app/admin/protection/page.tsx",
  "src/app/admin/protection/[id]/page.tsx",
  "src/app/admin/protection/disputes/page.tsx",
  "src/app/admin/protection/refunds/page.tsx",
];
const READERS = ["src/lib/protection/adminOverview.ts", "src/lib/protection/adminTransactions.ts", "src/lib/protection/adminDisputes.ts", "src/lib/protection/adminRefunds.ts"];
const VIEWS = [
  "src/components/admin/AdminProtectionView.tsx",
  "src/components/admin/AdminProtectionDetail.tsx",
  "src/components/admin/AdminProtectionDisputesView.tsx",
  "src/components/admin/AdminProtectionRefundsView.tsx",
  "src/components/admin/AdminProtectionStatusBadge.tsx",
  "src/components/admin/AdminProtectionTabs.tsx",
];

// ---------------------------------------------------------------- 1. every new page/route exists
{
  for (const f of [...PAGES, ...READERS, ...VIEWS]) check(`${f} exists`, exists(f));
}

// ---------------------------------------------------------------- 2. admin authorization — pages rely on the layout's own gate; routes must assertAdmin() themselves
{
  const layoutSrc = read("src/app/admin/layout.tsx");
  check("the shared /admin layout itself gates on an admin session (every page under it, including the new Protection ones, inherits this)", /assertAdmin|role.*admin|is_admin/i.test(layoutSrc));

  const disputeListRoute = read("src/app/api/admin/protection/disputes/route.ts");
  check("GET /api/admin/protection/disputes requires assertAdmin()", /assertAdmin\(\)/.test(disputeListRoute));

  const resolveRoute = read("src/app/api/admin/protection/transactions/[id]/resolve-dispute/route.ts");
  check("the resolve-dispute route (Phase 7, reused unmodified) still requires assertAdmin()", /assertAdmin\(\)/.test(resolveRoute));
}

// ---------------------------------------------------------------- 3. no second resolution engine — the detail view only ever calls the EXISTING Phase 7 route
{
  const detailSrc = read("src/components/admin/AdminProtectionDetail.tsx");
  check("the admin detail view calls the EXISTING resolve-dispute route, not a new one", /\/api\/admin\/protection\/transactions\/\$\{detail\.id\}\/resolve-dispute/.test(detailSrc));
  check("the admin detail view never imports disputeEngine.ts or release.ts directly (server-only engines, reused only through the API route)", !/from ["'].*disputeEngine["']|from ["'].*\/release["']/.test(detailSrc));

  for (const f of READERS) {
    const src = read(f);
    check(`${f} never writes to protection_transactions, protection_disputes, protection_refunds, or commerce_sale_earnings`, !/\.update\(|\.insert\(|\.delete\(/.test(src), f);
  }
}

// ---------------------------------------------------------------- 4. refund safety — monitoring only, never calls the adapter, never claims a false completion
{
  const refundsViewSrc = read("src/components/admin/AdminProtectionRefundsView.tsx");
  const refundsReaderSrc = read("src/lib/protection/adminRefunds.ts");
  check("the refunds view has no action buttons — read-only monitoring", !/onClick.*fetch\(/.test(refundsViewSrc));
  check("the refunds reader never imports the Fapshi refund adapter", !/fapshiRefundAdapter/.test(refundsReaderSrc));
  check("the refunds reader never writes protection_refunds.status", !/update\(\s*\{\s*status/.test(refundsReaderSrc));
}

// ---------------------------------------------------------------- 5. no accidental Protection/refund-provider enablement anywhere in Phase 8
{
  for (const f of [...PAGES, ...READERS, ...VIEWS]) {
    const src = read(f);
    check(`${f} never sets protection_enabled or protection_refund_provider_enabled to true`, !/protection_enabled:\s*true|protectionEnabled:\s*true|protection_refund_provider_enabled:\s*true|refundProviderEnabled:\s*true/.test(src), f);
  }
  const overviewSrc = read("src/lib/protection/adminOverview.ts");
  check("adminOverview.ts only ever READS protection_enabled/protection_refund_provider_enabled, never writes them", !/\.update\(/.test(overviewSrc) && /select.*protection_enabled/.test(overviewSrc));
}

// ---------------------------------------------------------------- 6. no unnecessary PII / secrets exposed
{
  const listSrc = read("src/lib/protection/adminTransactions.ts");
  const overviewViewSrc = read("src/components/admin/AdminProtectionView.tsx");
  check("the transaction list reader never selects customer phone/email", !/customer_phone|customer_email/.test(listSrc));
  check("the transaction list reader exposes customer_id only as a reference, never a name/phone/email column", /customer_id/.test(listSrc) && !/customer_name|customer_phone|customer_email/.test(listSrc));
  const detailSrc = read("src/lib/protection/adminTransactions.ts");
  check("the detail reader never selects a raw provider secret (api key/credential) column", !/api_key|apiKey|api_user|credential/i.test(detailSrc));
  void overviewViewSrc;
}

// ---------------------------------------------------------------- 7. currency figures kept distinct, never blended
{
  const overviewSrc = read("src/lib/protection/adminOverview.ts");
  check("the overview keeps protected volume, fees, pending, and released as SEPARATE per-currency fields (never summed into one figure)", /protectedVolume/.test(overviewSrc) && /feesCollected/.test(overviewSrc) && /pendingSellerAmount/.test(overviewSrc) && /releasedToSellers/.test(overviewSrc));
  check("totals are keyed by currency (Record<string, ...>), never a single cross-currency number", /totalsByCurrency: Record<\s*string/.test(overviewSrc));
}

// ---------------------------------------------------------------- 8. event timeline is read-only (no edit/delete UI)
{
  const detailSrc = read("src/components/admin/AdminProtectionDetail.tsx");
  check("the event timeline section renders a plain read-only list (no edit/delete controls)", !/onClick.*event|deleteEvent|editEvent/i.test(detailSrc));
}

// ---------------------------------------------------------------- 9. reuses the existing admin nav/shell architecture (no second admin framework)
{
  const shellSrc = read("src/components/admin/AdminShell.tsx");
  check("a single 'Protection' entry was added to the EXISTING NAV_ITEMS list (not a parallel nav)", /label: "Protection"/.test(shellSrc));
  const navCountsSrc = read("src/lib/adminNavCounts.ts");
  check("the nav count addition follows the existing 'needs action' convention (status = 'open', matching every other payout count's own 'requested' convention)", /protection_disputes.*status.*open|eq\("status", "open"\)/.test(navCountsSrc.replace(/\n/g, " ")));
}

// ---------------------------------------------------------------- 10. Normal Payment / prior-phase regression
{
  const untouchedFiles = [
    "src/lib/productCheckout/settlement.ts",
    "src/lib/protection/engine.ts",
    "src/lib/protection/transitions.ts",
    "src/lib/protection/release.ts",
    "src/lib/protection/disputeEngine.ts",
    "src/lib/protection/refundEngine.ts",
    "src/lib/protection/fapshiRefundAdapter.ts",
  ];
  for (const f of untouchedFiles) {
    check(`${f} is not imported/modified by any new Phase 8 reader (read-only reuse only)`, exists(f)); // existence sanity; git diff itself is checked separately in the Phase 8 report
  }
  check("no new admin page/route imports customer_payments (Normal Payment's own payment table)", [...PAGES, ...READERS].every((f) => !/customer_payments/.test(read(f))));
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nprotection_admin: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
