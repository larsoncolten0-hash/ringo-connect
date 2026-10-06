// The EXACT files the commercial-destination phase changes or adds: a still product rail, the dedicated shop / services page (/[username]/shop), the
// dashboard preview scroll fix, and the locked (upgrade) state of the paid business tools for a Free plan. Presentation, routing and a read-only plan
// lookup only: no API route, payment, checkout, commission, payout, auth, WhatsApp, booking, order, NFC/QR, migration or Supabase file is on this list.
// Same convention as phase13Files.mjs: explicit, no wildcards.
export const PHASE14_FILES = new Set([
  "scripts/tests/phase14Files.mjs",
  "scripts/tests/phase14.test.mjs",
  "src/app/[username]/shop/page.tsx",
  "src/app/[username]/shop/", // git status lists a brand-new untracked directory collapsed to its name; it is this one route file
  "src/app/dashboard/bookkeeping/layout.tsx",
  "src/app/dashboard/documents/layout.tsx",
  "src/app/dashboard/inventory/layout.tsx",
  "src/app/dashboard/layout.tsx",
  "src/app/dashboard/reports/layout.tsx",
  "src/app/dashboard/sales/layout.tsx",
  "src/app/globals.css",
  "src/components/catalog/CatalogSection.tsx",
  "src/components/dashboard/DashboardShell.tsx",
  "src/components/dashboard/MobileMoreMenu.tsx",
  "src/components/editor/LivePreviewPanel.tsx",
  "src/components/shop/ShopDestination.tsx",
  "src/components/subscription/ToolkitLocked.tsx",
  "src/components/ui/Rail.tsx",
  "src/lib/toolkitLock.ts",
  "src/lib/i18n/translations.ts",
  "scripts/tests/ownerWorkspaceFiles.mjs",
]);
