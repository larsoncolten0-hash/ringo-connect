-- ROLLBACK for 2026-12-18_whatsapp_inbox_push_claim.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Drops the one function and the one throttle table. Touches no message, conversation, contact or other function; only the "last push" timestamps are lost.
-- After a rollback the webhook's push step fails safely (logged, ignored) and the Inbox keeps receiving and storing every message. Safe to re-run (IF EXISTS).
begin;

drop function if exists public.inbox_push_claim(text, text);
drop table if exists public.inbox_push_throttle;

commit;
