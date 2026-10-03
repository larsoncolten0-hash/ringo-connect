// The EXACT files the Phase 5 commerce accessibility and customer-experience work (catalogue card name, checkout
// quantity / focus / receipt link, product-page back button, seller filter and pagination semantics, noindex on
// the private order pages, their EN/FR strings) changes or adds. Same purpose and convention as phase2Files.mjs /
// phase3Files.mjs / phase4Files.mjs: the older scope-guard tests allow these files and nothing else, via
// isPhase2File (which accepts this list too).
// An explicit list (no wildcards, no directories) is deliberate: adding a file here is a conscious, reviewable act.
export const PHASE5_FILES = new Set([
  "scripts/tests/commerceA11y.test.mjs",
  "scripts/tests/phase2Files.mjs",
  "scripts/tests/phase5Files.mjs",
  "scripts/tests/shopReceiptPdf.test.mjs",
  "scripts/tests/shopSeller.test.mjs",
  "src/app/order/[id]/page.tsx",
  "src/app/shop/orders/[id]/page.tsx",
  "src/components/catalog/CatalogSection.tsx",
  "src/components/catalog/ProductDetailView.tsx",
  "src/components/checkout/ProductCheckout.tsx",
  "src/components/shop/ShopEarningsView.tsx",
  "src/components/shop/ShopOrdersView.tsx",
  "src/lib/i18n/translations.ts"
]);
