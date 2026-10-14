// The EXACT files the WhatsApp card-appointment work changes or adds ("Buy a card -> Meet a Ringo agent"): the bot's meeting-request flow, one additive UN-APPLIED migration (two tables,
// five service_role-only functions, SELECT-only row level security reusing the Inbox permissions inbox.view / inbox.reply), one authenticated route to confirm / decline / cancel, the
// Appointments page and its Inbox link, English + French copy, and their tests and scope-guard registrations.
// Not touched: bookings, signup, orders, Fapshi, payments, prices, the WhatsApp sender and webhook, the permission catalogue and its guards.
// Same convention as phase28Files.mjs .. phase32Files.mjs: explicit, no wildcards, no directories.
export const PHASE33_FILES = new Set([
  "scripts/tests/phase33Files.mjs",
  "scripts/tests/cardAppointments.test.mjs",
  "scripts/tests/cardAppointmentsSql.test.mjs",
  "scripts/tests/whatsappSalesBot.test.mjs",
  "scripts/tests/whatsappSecurityAudit.test.mjs",
  "scripts/tests/whatsappReply.test.mjs",
  "scripts/tests/inbox.test.mjs",
  "scripts/tests/performance.test.mjs",
  "scripts/tests/avatarShape.test.mjs",
  "scripts/tests/legal.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "supabase/migrations/2026-12-23_card_appointments.sql",
  "supabase/support/2026-12-23_card_appointments.preflight.sql",
  "supabase/support/2026-12-23_card_appointments.verify.sql",
  "supabase/support/2026-12-23_card_appointments.rollback.sql",
  "src/lib/salesBot/machine.ts",
  "src/lib/salesBot/runner.ts",
  "src/lib/salesBot/appointments.ts",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "src/app/api/inbox/appointments/[id]/status/route.ts",
  "src/app/dashboard/inbox/appointments/page.tsx",
  "src/components/inbox/AppointmentsView.tsx",
  "src/components/inbox/InboxView.tsx",
]);
