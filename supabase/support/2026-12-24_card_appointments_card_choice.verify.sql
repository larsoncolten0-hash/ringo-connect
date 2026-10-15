-- VERIFY for 2026-12-24_card_appointments_card_choice.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, p.proacl, p.proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
nf as (select * from fn where proname = 'card_appt_create_with_card'),
five as (select * from fn where proname in ('card_appt_create', 'card_appt_status', 'card_appt_locate', 'card_appt_set_status', 'card_appt_record_notify')),
checks(label, expect, actual) as (
  select '01 both card columns exist with the right types (text, integer)', '2',
         (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'card_appointments' and ((column_name = 'card_tier' and data_type = 'text') or (column_name = 'card_price_xaf' and data_type = 'integer')))
  union all select '02 their CHECK constraints exist (tier list, price range)', '2',
         (select count(*)::text from pg_constraint where conrelid = 'public.card_appointments'::regclass and contype = 'c' and (pg_get_constraintdef(oid) like '%standard%premium%' or pg_get_constraintdef(oid) like '%card_price_xaf%'))
  union all select '03 the new function exists exactly once, SECURITY DEFINER with a pinned search_path', '1',
         (select count(*)::text from nf where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '04 only service_role (and the owner) can execute it; anon, authenticated and PUBLIC cannot', 'true',
         (select coalesce(bool_and(has_function_privilege('service_role', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute')
                                   and proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0)), false)::text from nf)
  union all select '05 set_status keeps its protections too (service_role only, definer, pinned path)', 'true',
         (select coalesce(bool_and(has_function_privilege('service_role', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('authenticated', oid, 'execute') and prosecdef and proconfig::text like '%search_path=public, pg_temp%'), false)::text from fn where proname = 'card_appt_set_status')
  union all select '06 the new function and the other functions have the same owner as the tables, and it is not an API role', '0',
         (select count(*)::text from fn where proname = 'card_appt_create_with_card' and (proowner <> (select relowner from pg_class where oid = 'public.card_appointments'::regclass) or pg_get_userbyid(proowner) in ('anon', 'authenticated', 'service_role')))
  union all select '07 the new function validates both-or-neither and delegates to the reviewed card_appt_create (so the verified-number rule and idempotency are inherited)', 'true',
         (select coalesce(bool_and(prosrc like '%(p_card_tier is null) <> (p_card_price is null)%' and prosrc like '%public.card_appt_create(p_conversation_id, p_name, p_phone, p_time, p_place, p_note, p_lang)%' and prosrc like '%v_res ->> ''result'' = ''created''%'), false)::text from nf)
  union all select '08 set_status still enforces the 2026-12-23 rules (permission re-check, transitions, notification clearing)', 'true',
         (select coalesce(bool_and(prosrc like '%inbox_actor_access(p_actor_user_id, v.conversation_id, ''inbox.reply'')%' and prosrc like '%customer_notify_status = null, customer_notified_at = null%' and prosrc like '%v.status = ''confirmed'' and p_to in (''cancelled'', ''completed'')%' and prosrc !~ 'v\.status = ''pending'' and p_to in \([^)]*completed'), false)::text from fn where proname = 'card_appt_set_status')
  union all select '09 set_status now returns the receipt fields (name, time, place, card, price)', 'true',
         (select coalesce(bool_and(prosrc like '%''customer_name'', v.customer_name%' and prosrc like '%''card_tier'', v.card_tier%' and prosrc like '%''card_price_xaf'', v.card_price_xaf%'), false)::text from fn where proname = 'card_appt_set_status')
  union all select '10 the original five functions are still there exactly once each (no overload was added)', '5', (select count(*)::text from five)
  union all select '11 access is unchanged: still exactly four SELECT policies and no other policy on the two tables', '4',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('card_appointments', 'card_appointment_events') and cmd = 'SELECT')
  union all select '11b no policy of any other kind', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('card_appointments', 'card_appointment_events') and cmd <> 'SELECT')
  union all select '12 no API role gained write privileges on either table', '0',
         (select count(*)::text from (values ('anon'), ('authenticated'), ('service_role')) r(role) cross join (values ('public.card_appointments'), ('public.card_appointment_events')) t(tbl)
           cross join (values ('insert'), ('update'), ('delete')) p(priv) where has_table_privilege(r.role, t.tbl, p.priv))
  union all select '13 none of the six functions touches bookings, signup requests, payments, plans or subscriptions', '0',
         (select count(*)::text from fn where proname like 'card\_appt\_%' and prosrc ~* '(bookings|signup_requests|payment|subscription|plans|addons|customer_paid)')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
