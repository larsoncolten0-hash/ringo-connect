-- ROLLBACK for 2026-12-09_whatsapp_inbox_tools.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- WARNING: THIS DELETES EVERY SAVED REPLY (the owners' templates). Conversation statuses that were already closed or reopened stay as they are
-- (they are ordinary data in a Phase 4 table). It touches no Phase 4 or Phase 7 table or function, no message and no WhatsApp account.
-- After a rollback the application cannot save/delete replies or close/reopen conversations (it answers with a safe error); reading is unaffected.
-- Order: functions -> policy -> trigger -> table -> guard function. Safe to re-run (IF EXISTS).
begin;

drop function if exists public.inbox_saved_reply_save(uuid, uuid, uuid, text, text);
drop function if exists public.inbox_saved_reply_delete(uuid, uuid, uuid);
drop function if exists public.inbox_set_conversation_status(uuid, uuid, text);

drop policy if exists "inbox_saved_replies owner read" on public.inbox_saved_replies;
drop trigger if exists inbox_saved_replies_guard_trg on public.inbox_saved_replies;
drop table if exists public.inbox_saved_replies;
drop function if exists public.inbox_saved_replies_guard();

commit;
