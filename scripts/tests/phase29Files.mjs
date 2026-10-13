// The EXACT files the WhatsApp Smart Card sales bot phase changes or adds: a deterministic (no AI) WhatsApp sales conversation for the Ringo Connect Smart Card that reuses the
// Inbox for all messages, the EXISTING /api/signup-requests and /api/signup-requests/[id]/pay handlers for the order and the Mobile Money payment request, and one additive,
// best-effort hook in signupPayment.ts that tells the customer on WhatsApp AFTER the existing payment code has recorded the payment. It is switched on for ONE number by the
// WHATSAPP_SALES_BOT_PHONE_NUMBER_ID environment variable (off by default). One additive, UN-APPLIED migration (two tables, four service_role-only functions).
// Older guard tests edited only to register this phase's files / the new owner route in their inventories (listed below).
// Not touched: the payment calculation / verification (computeSignupAmount, confirmSignupPayment, markSignupPaid, the Fapshi client), the signup and pay routes, authentication,
// middleware, Stripe, the webhook's signature check and account allowlist, the wa_accounts mapping.
// Same convention as phase28Files.mjs: explicit, no wildcards, no directories.
export const PHASE29_FILES = new Set([
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/inbox.test.mjs",
  "scripts/tests/legal.test.mjs",
  "scripts/tests/performance.test.mjs",
  "scripts/tests/whatsappReply.test.mjs",
  "scripts/tests/whatsappSecurityAudit.test.mjs",
  "scripts/tests/phase29Files.mjs",
  "scripts/tests/whatsappSalesBot.test.mjs",
  "src/app/api/inbox/conversations/[id]/sales-bot/route.ts",
  "src/app/api/integrations/whatsapp/webhook/route.ts",
  "src/app/dashboard/inbox/[id]/page.tsx",
  "src/components/inbox/InboxView.tsx",
  "src/components/inbox/ResumeSalesBotButton.tsx",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "src/lib/inbox/automation.ts",
  "src/lib/salesBot/handoff.ts",
  "src/lib/salesBot/ids.ts",
  "src/lib/salesBot/machine.ts",
  "src/lib/salesBot/offers.ts",
  "src/lib/salesBot/paymentNotice.ts",
  "src/lib/salesBot/runner.ts",
  "src/lib/signupPayment.ts",
  "supabase/migrations/2026-12-19_whatsapp_sales_bot.sql",
  "supabase/support/2026-12-19_whatsapp_sales_bot.rollback.sql",
  "supabase/support/2026-12-19_whatsapp_sales_bot.verify.sql",
]);

export const isPhase29File = (f) => PHASE29_FILES.has(String(f).replace(/\\/g, "/"));
