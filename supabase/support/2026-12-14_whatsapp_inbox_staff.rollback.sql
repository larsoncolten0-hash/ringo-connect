-- ROLLBACK for 2026-12-14_whatsapp_inbox_staff.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes staff Inbox access: the staff read policies and the member functions. Touches no table, row, message, conversation, role or membership.
-- Messages already sent by staff keep their sent_by_user_id (ordinary data). Owners are unaffected (their policies and functions are not touched).
-- The Team guard (2026-12-13) is separate and stays in place. Safe to re-run (IF EXISTS).
begin;

drop policy if exists "inbox_contacts staff read" on public.inbox_contacts;
drop policy if exists "inbox_conversations staff read" on public.inbox_conversations;
drop policy if exists "inbox_messages staff read" on public.inbox_messages;
drop policy if exists "inbox_message_media staff read" on public.inbox_message_media;
drop policy if exists "inbox_status_events staff read" on public.inbox_status_events;
drop policy if exists "inbox_saved_replies staff read" on public.inbox_saved_replies;

drop function if exists public.inbox_member_saved_reply_save(uuid, uuid, uuid, text, text);
drop function if exists public.inbox_member_mark_conversation_read(uuid, uuid);
drop function if exists public.inbox_member_set_conversation_status(uuid, uuid, text);
drop function if exists public.inbox_member_fail_outbound(uuid, uuid, integer[]);
drop function if exists public.inbox_member_complete_outbound_media(uuid, uuid, text, text, text, text, text);
drop function if exists public.inbox_member_complete_outbound(uuid, uuid, text);
drop function if exists public.inbox_member_prepare_outbound_media(uuid, uuid, uuid, text, text);
drop function if exists public.inbox_member_prepare_outbound_text(uuid, uuid, uuid, text);
drop function if exists public.inbox_staff_can_read(uuid, text);
drop function if exists public.inbox_member_workspaces(uuid);
drop function if exists public.inbox_actor_access(uuid, uuid, text);
drop function if exists public.inbox_actor_relation(uuid, uuid, text);
drop function if exists public.inbox_member_can(uuid, uuid, text);

commit;
