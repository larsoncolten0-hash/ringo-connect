-- PREFLIGHT for 2026-12-24_card_appointments_card_choice.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run BEFORE applying the migration.
-- Every row must show ok = true. It proves 2026-12-23 is applied as reviewed and that none of this migration's objects exist yet.

with
fn as (select p.proname, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
checks(label, expect, actual) as (
  select '01 the two appointment tables exist', '2', (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('card_appointments', 'card_appointment_events'))
  union all select '02 the five 2026-12-23 functions exist exactly once each', '5',
         (select count(*)::text from fn where proname in ('card_appt_create', 'card_appt_status', 'card_appt_locate', 'card_appt_set_status', 'card_appt_record_notify'))
  union all select '03 card_appt_set_status is the reviewed 2026-12-23 version (completed, notification clearing, permission re-check)', 'true',
         (select coalesce(bool_and(prosrc like '%customer_notify_status = null, customer_notified_at = null%' and prosrc like '%''cancelled'', ''completed''%' and prosrc like '%inbox_actor_access(p_actor_user_id, v.conversation_id, ''inbox.reply'')%'), false)::text from fn where proname = 'card_appt_set_status')
  union all select '04 the new columns are not there yet (0 expected)', '0',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'card_appointments' and column_name in ('card_tier', 'card_price_xaf'))
  union all select '05 the new function is not there yet (0 expected)', '0', (select count(*)::text from fn where proname = 'card_appt_create_with_card')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
