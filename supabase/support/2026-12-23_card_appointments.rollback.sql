-- ROLLBACK for 2026-12-23_card_appointments.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Drops the five functions and the two tables (their policies, indexes and rows go with them). Touches no Inbox message, contact, conversation or role, no signup request,
-- payment or subscription, and nothing in `bookings`. Only the appointment requests and their audit events are lost. Safe to re-run (IF EXISTS).
-- After a rollback the bot's appointment calls fail safely (logged, the customer is told nothing was saved); the rest of the bot, the Inbox and the push notifications keep working.
begin;

drop function if exists public.card_appt_record_notify(uuid, uuid, text);
drop function if exists public.card_appt_set_status(uuid, uuid, text, text);
drop function if exists public.card_appt_locate(uuid);
drop function if exists public.card_appt_status(uuid);
drop function if exists public.card_appt_create(uuid, text, text, text, text, text, text);
drop table if exists public.card_appointment_events;
drop table if exists public.card_appointments;

commit;
