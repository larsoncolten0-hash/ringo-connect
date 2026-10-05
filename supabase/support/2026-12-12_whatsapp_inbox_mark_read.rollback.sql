-- ROLLBACK for 2026-12-12_whatsapp_inbox_mark_read.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Drops the one function. Touches no table, row, message or other function; unread counts that were already cleared stay cleared (ordinary data).
-- After a rollback the application cannot mark a conversation read (the open-conversation call answers with a safe error and is ignored); reading is unaffected.
-- Safe to re-run (IF EXISTS).
begin;

drop function if exists public.inbox_mark_conversation_read(uuid, uuid);

commit;
