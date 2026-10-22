-- ROLLBACK for 2026-12-25_card_orders.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Drops the four functions and the two tables (their policies, indexes and rows go with them). Touches no Inbox message, contact, conversation or role, no signup request,
-- payment or subscription, and nothing in card_appointments. Only the list of paid orders and its audit events are lost. Safe to re-run (IF EXISTS).
-- After a rollback the payment hook's recording call fails safely (logged, nothing else changes); the payment, the receipt and the rest of the bot keep working.
begin;

drop function if exists public.card_order_record_notify(uuid, uuid, text);
drop function if exists public.card_order_set_status(uuid, uuid, text, text);
drop function if exists public.card_order_locate(uuid);
drop function if exists public.card_order_record_paid(uuid, text, text, integer);
drop table if exists public.card_order_events;
drop table if exists public.card_orders;

commit;
