-- ROLLBACK for 2026-12-20_whatsapp_sales_bot_owner_switch.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Drops the three functions and the two tables (the owners' saved switch values and the audit trail are lost). Touches no Inbox message, conversation, signup request or
-- payment, and not the sales bot's own state from 2026-12-19. Safe to re-run (IF EXISTS).
-- After a rollback the bot's gate call fails, and a failed gate means the bot stays silent (fail closed): the webhook, the Inbox, push and payments keep working.
begin;

drop function if exists public.wa_sales_settings_set(uuid, uuid, boolean);
drop function if exists public.wa_sales_settings_get(uuid, uuid);
drop function if exists public.wa_sales_enabled(text);
drop table if exists public.wa_sales_settings_log;
drop table if exists public.wa_sales_settings;

commit;
