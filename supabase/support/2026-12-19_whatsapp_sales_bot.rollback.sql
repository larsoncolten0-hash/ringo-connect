-- ROLLBACK for 2026-12-19_whatsapp_sales_bot.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Drops the four functions and the two tables. Touches no Inbox message, contact or conversation, and no signup request or payment. Only the bot's own state is lost
-- (where each customer was in the sales conversation, and the link from a conversation to the order it created). Safe to re-run (IF EXISTS).
-- After a rollback the bot's database calls fail safely (logged, ignored); the webhook, the Inbox and the push notifications keep working.
begin;

drop function if exists public.wa_sales_payment_context(uuid);
drop function if exists public.wa_sales_set_handoff(uuid, uuid, boolean);
drop function if exists public.wa_sales_save(uuid, integer, text, jsonb, boolean, uuid);
drop function if exists public.wa_sales_begin(text, text);
drop table if exists public.wa_sales_processed;
drop table if exists public.wa_sales_sessions;

commit;
