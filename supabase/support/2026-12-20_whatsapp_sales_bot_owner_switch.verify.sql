-- VERIFY for 2026-12-20_whatsapp_sales_bot_owner_switch.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('wa_sales_enabled', 'wa_sales_settings_get', 'wa_sales_settings_set')),
checks(label, expect, actual) as (
  select '01 the three functions exist exactly once each', '3', (select count(*)::text from fn)
  union all select '02 all are SECURITY DEFINER with a pinned search_path', '3', (select count(*)::text from fn where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '03 service_role can execute all three', '3', (select count(*)::text from fn where has_function_privilege('service_role', oid, 'execute'))
  union all select '04 anon, authenticated and public can execute none', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('public', oid, 'execute'))
  union all select '05 both tables exist with row level security on', '2', (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('wa_sales_settings', 'wa_sales_settings_log') and c.relrowsecurity)
  union all select '06 no API role can read or write either table', '0', (select count(*)::text from (values ('anon'), ('authenticated'), ('service_role')) r(role) cross join (values ('public.wa_sales_settings'), ('public.wa_sales_settings_log')) t(tbl) where has_table_privilege(r.role, t.tbl, 'select,insert,update,delete'))
  union all select '07 no policy exists on either table', '0', (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('wa_sales_settings', 'wa_sales_settings_log'))
  union all select '08 the switch defaults to OFF', 'false', (select (column_default)::text from information_schema.columns where table_schema = 'public' and table_name = 'wa_sales_settings' and column_name = 'enabled')
  union all select '09 the gate fails closed (coalesce to false, active accounts only)', 'true',
         (select coalesce(bool_and(prosrc like '%coalesce(%false)%' and prosrc like '%a.status = ''active''%'), false)::text from fn where proname = 'wa_sales_enabled')
  union all select '10 only the owner of a profile with a WhatsApp account can read or change the switch', 'true',
         (select coalesce(bool_and(prosrc like '%p.user_id = p_actor_user_id%' and prosrc like '%public.wa_accounts a where a.profile_id = p.id%'), false)::text from fn where proname in ('wa_sales_settings_get', 'wa_sales_settings_set'))
  union all select '11 a change is logged', 'true',
         (select coalesce(bool_and(prosrc like '%insert into public.wa_sales_settings_log%'), false)::text from fn where proname = 'wa_sales_settings_set')
  union all select '12 no function writes an inbox, payment, order or sales-session table', '0', (select count(*)::text from fn where prosrc ~* '(insert into|update|delete from)[[:space:]]+public[.](inbox_|wa_sales_sessions|wa_sales_processed|signup_requests|orders)')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
