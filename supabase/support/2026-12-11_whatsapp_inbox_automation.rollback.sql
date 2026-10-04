-- ROLLBACK for 2026-12-11_whatsapp_inbox_automation.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- WARNING: THIS DELETES every owner's automation settings (hours, acknowledgement text, follow-up rule, notification switches) and the per-conversation
-- automation bookkeeping. It touches no Phase 4/7/8/9 table or function: no message, no conversation, no media row and no WhatsApp account is changed,
-- and automatic acknowledgements that were already sent stay in the conversations as ordinary outbound messages.
-- After a rollback the application treats every profile as "automation off" (it answers settings requests with a safe error) and the webhook and
-- the daily cron skip automation. Replying, media, saved replies and the AI assistant are unaffected.
-- Order: functions -> policies -> triggers -> tables -> guard functions. Safe to re-run (IF EXISTS).
begin;

drop function if exists public.inbox_claim_follow_ups(integer);
drop function if exists public.inbox_automation_failed(text, text);
drop function if exists public.inbox_automation_record_ack(uuid, uuid);
drop function if exists public.inbox_automation_inbound(text, text);
drop function if exists public.inbox_settings_save(uuid, uuid, jsonb);

drop policy if exists "inbox_conversation_state owner read" on public.inbox_conversation_state;
drop policy if exists "inbox_settings owner read" on public.inbox_settings;
drop trigger if exists inbox_conversation_state_guard_trg on public.inbox_conversation_state;
drop trigger if exists inbox_settings_guard_trg on public.inbox_settings;
drop table if exists public.inbox_conversation_state;
drop table if exists public.inbox_settings;
drop function if exists public.inbox_conversation_state_guard();
drop function if exists public.inbox_settings_guard();
drop function if exists public.inbox_within_hours(jsonb, text, timestamptz);
drop function if exists public.inbox_hours_valid(jsonb);

commit;
