-- VERIFY for 2026-12-25_card_orders.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
fn as (select p.oid, p.proname, p.prosecdef, p.proconfig, p.prosrc, p.proacl, p.proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in ('card_order_record_paid', 'card_order_locate', 'card_order_set_status', 'card_order_record_notify')),
checks(label, expect, actual) as (
  select '01 the four functions exist exactly once each', '4', (select count(*)::text from fn)
  union all select '02 all are SECURITY DEFINER with a pinned search_path', '4', (select count(*)::text from fn where prosecdef and proconfig::text like '%search_path=public, pg_temp%')
  union all select '03 service_role can execute all four', '4', (select count(*)::text from fn where has_function_privilege('service_role', oid, 'execute'))
  union all select '04 anon and authenticated can execute none', '0', (select count(*)::text from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
  union all select '05 both tables exist with row level security on', '2', (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('card_orders', 'card_order_events') and c.relrowsecurity)
  union all select '06 no API role can write either table (insert, update or delete)', '0',
         (select count(*)::text from (values ('anon'), ('authenticated'), ('service_role')) r(role) cross join (values ('public.card_orders'), ('public.card_order_events')) t(tbl)
           cross join (values ('insert'), ('update'), ('delete')) p(priv) where has_table_privilege(r.role, t.tbl, p.priv))
  union all select '07 only authenticated can read, and only through the policies (anon and service_role cannot select)', '0',
         (select count(*)::text from (values ('anon'), ('service_role')) r(role) cross join (values ('public.card_orders'), ('public.card_order_events')) t(tbl) where has_table_privilege(r.role, t.tbl, 'select'))
  union all select '08 exactly four SELECT policies exist (owner read + staff read on each table) and no other policy', '4',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('card_orders', 'card_order_events') and cmd = 'SELECT')
  union all select '08b no policy of any other kind exists on either table', '0',
         (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('card_orders', 'card_order_events') and cmd <> 'SELECT')
  union all select '09 exactly one order per signup request (unique index)', '1',
         (select count(*)::text from pg_indexes where schemaname = 'public' and tablename = 'card_orders' and indexname = 'card_orders_signup_idx' and indexdef like '%UNIQUE%')
  union all select '10 the status is limited to paid and completed', '1',
         (select count(*)::text from pg_constraint where conrelid = 'public.card_orders'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%paid%' and pg_get_constraintdef(oid) like '%completed%')
  union all select '11 the organization key is composite, so an order always belongs to its conversation''s organization', '1',
         (select count(*)::text from pg_constraint where conrelid = 'public.card_orders'::regclass and contype = 'f' and confrelid = 'public.inbox_conversations'::regclass and array_length(conkey, 1) = 2)
  union all select '12 changing a status re-checks the actor with inbox.reply inside the database', 'true',
         (select coalesce(bool_and(prosrc like '%inbox_actor_access(p_actor_user_id, v.conversation_id, ''inbox.reply'')%'), false)::text from fn where proname = 'card_order_set_status')
  union all select '13 the recorded order takes its conversation, organization, number, card and language from the linked sales-bot session', 'true',
         (select coalesce(bool_and(prosrc like '%from public.wa_sales_sessions s where s.signup_request_id = p_signup_request_id%'), false)::text from fn where proname = 'card_order_record_paid')
  union all select '14 no function writes a signup request, payment, plan, add-on or subscription', '0',
         (select count(*)::text from fn where prosrc ~* '(update\s+public\.signup_requests|insert\s+into\s+public\.signup_requests|payment_transactions|subscriptions|customer_paid)')
  union all select '15 the four functions are owned by the same role as the two tables (the migration role)', '4',
         (select count(*)::text from fn where proowner = (select relowner from pg_class where oid = 'public.card_orders'::regclass) and proowner = (select relowner from pg_class where oid = 'public.card_order_events'::regclass))
  union all select '16 that owner is not an API role (anon, authenticated, service_role)', '0',
         (select count(*)::text from fn where pg_get_userbyid(proowner) in ('anon', 'authenticated', 'service_role'))
  union all select '17 EXECUTE is an explicit grant list that does not include PUBLIC (so only the roles named in it can run them)', '4',
         (select count(*)::text from fn where proacl is not null and not exists (select 1 from aclexplode(proacl) a where a.grantee = 0))
  union all select '17b the only role (other than the owner) with EXECUTE is service_role', '0',
         (select count(*)::text from fn cross join lateral aclexplode(proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> proowner and pg_get_userbyid(a.grantee) <> 'service_role')
  union all select '18 a real status change clears the stored notification outcome in the same statement', 'true',
         (select coalesce(bool_and(prosrc like '%customer_notify_status = null, customer_notified_at = null%'), false)::text from fn where proname = 'card_order_set_status')
  union all select '19 completed can only come from paid', 'true',
         (select coalesce(bool_and(prosrc like '%v.status = ''paid'' and p_to = ''completed''%'), false)::text from fn where proname = 'card_order_set_status')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
