-- ROLLBACK for 2026-12-07_whatsapp_inbox_foundation.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- WARNING: THIS DESTROYS EVERY PHASE 4 INBOX ROW (accounts, contacts, conversations, messages, media metadata, status history).
-- There is no undo. Use it only before go-live, or after exporting what you need.
--
-- It touches ONLY objects the migration created. profiles, users, bk_customers (including any link made from an inbox contact, which
-- simply disappears with the contact) and every other existing table are not altered.
-- Order: RPCs -> policies -> triggers -> tables (children first) -> guard/helper functions. Safe to re-run (IF EXISTS everywhere).

begin;

-- 1. RPCs
drop function if exists public.inbox_ingest_whatsapp_message(text, text, text, text, timestamptz, text, text, text, text, text, text, text, text, text, text);
drop function if exists public.inbox_ingest_whatsapp_status(text, text, text, text, timestamptz, integer[]);

-- 2. policies
drop policy if exists "wa_accounts owner read" on public.wa_accounts;
drop policy if exists "inbox_contacts owner read" on public.inbox_contacts;
drop policy if exists "inbox_conversations owner read" on public.inbox_conversations;
drop policy if exists "inbox_messages owner read" on public.inbox_messages;
drop policy if exists "inbox_message_media owner read" on public.inbox_message_media;
drop policy if exists "inbox_status_events owner read" on public.inbox_status_events;

-- 3. triggers
drop trigger if exists wa_accounts_guard_trg on public.wa_accounts;
drop trigger if exists inbox_contacts_guard_trg on public.inbox_contacts;
drop trigger if exists inbox_conversations_guard_trg on public.inbox_conversations;
drop trigger if exists inbox_messages_guard_trg on public.inbox_messages;
drop trigger if exists inbox_message_media_guard_trg on public.inbox_message_media;
drop trigger if exists inbox_status_events_guard_trg on public.inbox_status_events;

-- 4. tables, in dependency order (their indexes, constraints and grants go with them)
drop table if exists public.inbox_status_events;
drop table if exists public.inbox_message_media;
drop table if exists public.inbox_messages;
drop table if exists public.inbox_conversations;
drop table if exists public.inbox_contacts;
drop table if exists public.wa_accounts;

-- 5. guard + helper functions
drop function if exists public.wa_accounts_guard();
drop function if exists public.inbox_contacts_guard();
drop function if exists public.inbox_conversations_guard();
drop function if exists public.inbox_messages_guard();
drop function if exists public.inbox_message_media_guard();
drop function if exists public.inbox_status_events_guard();
drop function if exists public.inbox_status_rank(text);

commit;
