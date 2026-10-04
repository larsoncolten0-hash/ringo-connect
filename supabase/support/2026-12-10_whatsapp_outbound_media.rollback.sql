-- ROLLBACK for 2026-12-10_whatsapp_outbound_media.sql — FOR OWNER REVIEW; do not run unless rolling back.
-- Drops ONLY the two Phase 9 functions. It touches no table: every stored message and every media metadata row (including outbound ones already
-- created) is kept. After a rollback the application cannot send media (it answers with a safe error); text replies and reading are unaffected.
-- Safe to re-run (IF EXISTS).
begin;
drop function if exists public.inbox_prepare_outbound_media(uuid, uuid, uuid, text, text);
drop function if exists public.inbox_complete_outbound_media(uuid, uuid, text, text, text, text, text);
commit;
