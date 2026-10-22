// The EXACT files the WhatsApp sales-bot follow-up changes or adds: the "Paid orders" place for customers who paid through the bot (mark completed once the card is delivered, with a thank-you
// to the customer), the website / official-profile lines in Discover Ringo and Know more, and the tests that cover them. The database part is a PROPOSED migration with its preflight, verify
// and rollback (not applied by this change).
// Not touched: authentication, payments, Fapshi, prices, plans, subscriptions, the signup request flow, the appointments (their tables, routes and page), NFC card writing, the profile-subdomain feature.
// Same convention as phase28Files.mjs .. phase36Files.mjs: explicit, no wildcards, no directories.
export const PHASE37_FILES = new Set([
  "scripts/tests/phase37Files.mjs",
  "scripts/tests/cardOrders.test.mjs",
  "scripts/tests/cardOrdersSql.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/performance.test.mjs",
  "scripts/tests/whatsappSalesBot.test.mjs",
  "scripts/tests/inbox.test.mjs",
  "scripts/tests/legal.test.mjs",
  "scripts/tests/whatsappReply.test.mjs",
  "scripts/tests/whatsappSecurityAudit.test.mjs",
  "src/lib/salesBot/cardOrders.ts",
  "src/lib/salesBot/paymentNotice.ts",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "src/app/api/inbox/orders/[id]/status/route.ts",
  "src/app/dashboard/inbox/orders/page.tsx",
  "src/components/inbox/OrdersView.tsx",
  "src/components/inbox/InboxView.tsx",
  "supabase/migrations/2026-12-25_card_orders.sql",
  "supabase/support/2026-12-25_card_orders.preflight.sql",
  "supabase/support/2026-12-25_card_orders.verify.sql",
  "supabase/support/2026-12-25_card_orders.rollback.sql",
]);
