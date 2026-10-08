// The EXACT files the WhatsApp Inbox push notification phase (Phase A) changes or adds: a generic, throttled web push for every newly stored inbound
// message, sent to the owner the DATABASE derives from the phone number's account (never from the request).
// Reuses the existing Web Push stack unchanged (src/lib/push/send.ts, withBell.ts, public/pwa-sw.js, the VAPID variables). The webhook's signature check, account
// allowlist, ingestion, Meta credentials and the wa_accounts mapping are NOT touched. One additive migration (a throttle table and one service_role-only function).
// Same convention as phase27Files.mjs: explicit, no wildcards, no directories.
export const PHASE28_FILES = new Set([
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase28Files.mjs",
  "scripts/tests/whatsappInboxPush.test.mjs",
  "src/app/api/integrations/whatsapp/webhook/route.ts",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "src/lib/inbox/automation.ts",
  "supabase/migrations/2026-12-18_whatsapp_inbox_push_claim.sql",
  "supabase/support/2026-12-18_whatsapp_inbox_push_claim.rollback.sql",
  "supabase/support/2026-12-18_whatsapp_inbox_push_claim.verify.sql",
]);

export const isPhase28File = (f) => PHASE28_FILES.has(String(f).replace(/\\/g, "/"));
