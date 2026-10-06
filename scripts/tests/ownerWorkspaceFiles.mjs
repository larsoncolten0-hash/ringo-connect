import { PHASE13_FILES } from "./phase13Files.mjs"; // the visual / UX refinement phase: its exact files are exempted by the older scope guards too
import { PHASE14_FILES } from "./phase14Files.mjs"; // the commercial-destination / paid-tools lock phase: likewise

// The EXACT files the Owner Workspace UX simplification and polish pass (Bookkeeping, Record Sale, receipt, Invoices, Reports, Customers,
// Ambassador, Team Leader, dashboard footer / hamburger / account menu, section tabs) changes or adds, on top of phase12Files.mjs.
// Same convention as phase2Files.mjs ... phase12Files.mjs: an explicit list, no wildcards, no directories. The older scope guards
// (overview, customers, reports, aiBusinessTools, whatsappSecurityAudit) exempt exactly these files and nothing else, so each of them still
// fails on any other changed file: no API route, no library, no migration, no payment, auth, commission or WhatsApp file is on this list.
export const OWNER_WORKSPACE_FILES = new Set([
  ...PHASE13_FILES,
  ...PHASE14_FILES,
  "scripts/tests/aiBusinessDrafts.test.mjs", // scope guard: exempts this list
  "scripts/tests/aiBusinessTools.test.mjs", // scope guard: exempts this list
  "scripts/tests/customerAttention.test.mjs", // scope guard: exempts this list
  "scripts/tests/customerLocationSql.test.mjs", // the customer-location feature, proven on a real in-memory PostgreSQL (old and new functions side by side)
  "src/lib/receivables/constants.ts", // CONTACT_LIMITS.address (300)
  "src/lib/receivables/handlers.ts", // passes the optional location to bk_customer_save only when there is one
  "src/lib/receivables/http.ts", // invalid_address -> 400
  "src/lib/receivables/uiErrors.ts", // invalid_address -> a translated message
  "src/lib/receivables/validation.ts", // the optional `address` of a contact
  "supabase/migrations/2026-12-15_customer_location.sql", // UN-APPLIED: bk_customers.address, bk_customer_save overload, sale_record reads the address
  "supabase/support/2026-12-15_customer_location.rollback.sql",
  "supabase/support/2026-12-15_customer_location.verify.sql",
  "scripts/tests/customers.test.mjs", // scope guard: exempts this list
  "scripts/tests/inventory.test.mjs", // scope guard: exempts this list
  "scripts/tests/musicProfile.test.mjs", // the Phase 3 scope guard now pins Phase 3 to its two commits instead of reading the working tree
  "scripts/tests/overview.test.mjs", // scope guard: exempts this list (and the Reports screen's no-diff freeze, which this pass supersedes)
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/recordSaleUnit.test.mjs", // scope guard: exempts this list
  "scripts/tests/reports.test.mjs", // scope guard + the Bookkeeping screen's one added read-only endpoint (the monthly summary)
  "scripts/tests/whatsappSecurityAudit.test.mjs", // scope guard: exempts this list
  "src/components/bookkeeping/EntriesView.tsx", // summary cards (read-only /api/bookkeeping/summary), Add income / Add expense, lighter rows
  "src/components/customers/CustomersView.tsx", // shorter header, empty state with its one action
  "src/components/dashboard/AmbassadorCodeEditor.tsx", // 44px touch target on "Edit code" (class only)
  "src/components/dashboard/AmbassadorDashboardView.tsx", // earnings first, copy-link action, no sideways scrolling on a phone
  "src/components/dashboard/AvatarMenu.tsx", // Subscription lives in the account menu; 44px rows
  "src/components/dashboard/DashboardShell.tsx", // Home first in the footer dock, Subscription out of the dock, aria-current, 44px targets
  "src/components/dashboard/MobileMoreMenu.tsx", // aria-current, 44px targets (Subscription no longer listed)
  "src/components/dashboard/SectionTabs.tsx", // every section page always visible (no hidden arrow menu)
  "src/components/dashboard/TeamLeaderDashboardView.tsx", // team, earnings first, no sideways scrolling on a phone
  "src/components/dashboard/ambassadorParts.tsx", // the tiles and stage chips both dashboards were drawing separately
  "src/components/documents/DocumentView.tsx", // the receipt: business, amount, customer, items, payment, footer
  "src/components/documents/InvoiceEditor.tsx", // four clear parts, details tucked away
  "src/components/documents/InvoicesList.tsx", // two figures per invoice, empty state with its action
  "src/components/documents/shared.tsx", // 44px fields, visible focus ring (classes only)
  "src/components/editor/EmptyState.tsx", // an optional action under the text
  "src/components/reports/ReportsView.tsx", // key figures first, details one tap away
  "src/components/sales/RecordSaleView.tsx", // Sale / Customer / Payment / Summary; customer details first
  "src/lib/i18n/translations.ts", // shorter copy and the new labels, EN and FR
]);
