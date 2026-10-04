-- ROLLBACK for 2026-12-08_whatsapp_outbound_replies.sql — FOR OWNER REVIEW; do not run unless rolling back.
-- Drops ONLY the three Phase 7 functions. It touches no table: every stored message (including outbound rows already created) is kept.
-- After a rollback the application can no longer send replies (it answers with a safe error); reading the Inbox is unaffected.
-- Safe to re-run (IF EXISTS).
begin;
drop function if exists public.inbox_prepare_outbound_text(uuid, uuid, uuid, text);
drop function if exists public.inbox_complete_outbound(uuid, uuid, text);
drop function if exists public.inbox_fail_outbound(uuid, uuid, integer[]);
commit;
