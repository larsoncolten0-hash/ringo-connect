-- VERIFY for 2026-12-19_whatsapp_sales_bot.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('wa_sales_begin', 'wa_sales_save', 'wa_sales_set_handoff', 'wa_sales_payment_context')),
checks(label, expect, actual) as (
  select '01 the four functions exist exactly once each', '4', (select count(*)::text from fn)
  union all select '02 all are SECURITY DEFINER with a pinned search_path', '4', (select count(*)::text from fn where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '03 service_role can execute all four', '4', (select count(*)::text from fn where has_function_privilege('service_role', oid, 'execute'))
  union all select '04 anon, authenticated and public can execute none', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('public', oid, 'execute'))
  union all select '05 both tables exist with row level security on', '2', (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('wa_sales_sessions', 'wa_sales_processed') and c.relrowsecurity)
  union all select '06 no API role can read or write either table', '0', (select count(*)::text from (values ('anon'), ('authenticated'), ('service_role')) r(role) cross join (values ('public.wa_sales_sessions'), ('public.wa_sales_processed')) t(tbl) where has_table_privilege(r.role, t.tbl, 'select,insert,update,delete'))
  union all select '07 no policy exists on either table', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('wa_sales_sessions', 'wa_sales_processed'))
  union all select '08 the message id is claimed by a primary key (one reply per provider message)', '1', (select count(*)::text from pg_constraint where conrelid = 'public.wa_sales_processed'::regclass and contype = 'p')
  union all select '09 hand-off can be switched on by the bot but off only by the owner function', 'true',
         (select coalesce(bool_and(case when proname = 'wa_sales_save' then prosrc like '%handoff = s.handoff or p_handoff%' else true end), false)::text from fn)
  union all select '09b resume only touches a conversation that is in hand-off', 'true',
         (select coalesce(bool_and(prosrc like '%where s.conversation_id = v_cv.id and s.handoff;%'), false)::text from fn where proname = 'wa_sales_set_handoff')
  union all select '10 no function writes an inbox table', '0', (select count(*)::text from fn where prosrc ~* '(insert into|update|delete from)[[:space:]]+public[.]inbox_')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
