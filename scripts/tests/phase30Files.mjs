// The EXACT files the WhatsApp Inbox UX and media upgrade changes or adds: incoming photos, voice notes, videos and documents are shown and played inside the conversation through ONE
// authenticated streaming route (the Meta token stays on the server, no Meta url reaches the browser); a video can now be up to 16 MB (min of the 50 MB application ceiling and Meta's
// own 16 MB limit) by way of a private, signed-upload staging bucket (one additive, UN-APPLIED migration: a private storage bucket, nothing else); the conversation layout is rebuilt
// around a single scrolling area with stable scroll behaviour; the reply box is redesigned; and the page's floating Ringo AI and Help buttons are kept clear of the Send button.
// Not touched: the webhook and its signature check, ingestion, the inbound/outbound database functions and migrations, the text sender, the media sender's validator and Meta calls
// (media.ts), authentication, payments, the Sales Bot and its gates.
// Same convention as phase28Files.mjs / phase29Files.mjs: explicit, no wildcards, no directories.
export const PHASE30_FILES = new Set([
  "scripts/tests/ownerWorkspaceFiles.mjs",
  "scripts/tests/phase30Files.mjs",
  "scripts/tests/inboxMediaUx.test.mjs",
  "scripts/tests/mp4Fixtures.mjs",
  "scripts/tests/inbox.test.mjs",
  "scripts/tests/musicProfile.test.mjs",
  "scripts/tests/whatsappInboxTools.test.mjs",
  "scripts/tests/whatsappMedia.test.mjs",
  "scripts/tests/whatsappReply.test.mjs",
  "scripts/tests/whatsappSecurityAudit.test.mjs",
  "src/app/api/inbox/conversations/[id]/media/[messageId]/route.ts",
  "src/app/api/inbox/conversations/[id]/media/route.ts",
  "src/app/api/inbox/conversations/[id]/media/stage/route.ts",
  "src/app/dashboard/inbox/[id]/page.tsx",
  "src/app/dashboard/inbox/loading.tsx",
  "src/app/globals.css",
  "src/components/ai/RingoAiLauncher.tsx",
  "src/components/dashboard/HelpWidget.tsx",
  "src/components/inbox/ImageLightbox.tsx",
  "src/components/inbox/InboxView.tsx",
  "src/components/inbox/MessageMedia.tsx",
  "src/components/inbox/ReplyComposer.tsx",
  "src/components/inbox/ThreadDock.tsx",
  "src/components/inbox/ThreadScroller.tsx",
  "src/lib/i18n/translations.en.ts",
  "src/lib/i18n/translations.fr.ts",
  "src/lib/inbox/client.ts",
  "src/lib/inbox/format.ts",
  "src/lib/inbox/localSend.ts",
  "src/lib/inbox/mediaView.ts",
  "src/lib/inbox/scrollPolicy.ts",
  "src/lib/inbox/stagedMedia.ts",
  "src/lib/inbox/threadLimit.ts",
  "src/lib/publicStorageHeaders.ts",
  "src/lib/whatsapp/media.ts",
  "src/lib/whatsapp/mediaFetch.ts",
  "src/lib/whatsapp/mediaRules.ts",
  "src/lib/whatsapp/mp4Inspect.ts",
  "supabase/migrations/2026-12-21_inbox_outbound_media_staging.sql",
  "supabase/support/2026-12-21_inbox_outbound_media_staging.rollback.sql",
  "supabase/support/2026-12-21_inbox_outbound_media_staging.verify.sql",
]);

export const isPhase30File = (f) => PHASE30_FILES.has(String(f).replace(/\\/g, "/"));
