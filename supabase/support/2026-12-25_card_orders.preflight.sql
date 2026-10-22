-- PREFLIGHT for 2026-12-25_card_orders.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run BEFORE applying the migration.
-- Every row must show ok = true. It proves the migration's prerequisites exist and that none of its objects exist yet.

with
fn(f) as (values ('inbox_staff_can_read'), ('inbox_actor_access'), ('inbox_actor_relation'), ('inbox_member_can'), ('org_team_enabled')),
tb(t) as (values ('inbox_conversations'), ('inbox_contacts'), ('profiles'), ('users'), ('wa_sales_sessions')),
checks(label, expect, actual) as (
  select '01 every prerequisite function exists (' || (select count(*)::text from fn) || ')', (select count(*)::text from fn),
         (select count(distinct p.proname)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in (select f from fn))
  union all select '02 every prerequisite table exists (' || (select count(*)::text from tb) || ')', (select count(*)::text from tb),
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename in (select t from tb))
  union all select '03 inbox_conversations has the (profile_id, id) key the new foreign key points at (1 expected)', '1',
         (select count(*)::text from pg_constraint c where c.conrelid = 'public.inbox_conversations'::regclass and c.contype in ('u', 'p')
            and (select array_agg(a.attname::text order by a.attname::text) from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['id', 'profile_id'])
  union all select '04 the new tables are not there yet (0 expected)', '0',
         (select count(*)::text from pg_tables where schemaname = 'public' and tablename in ('card_orders', 'card_order_events'))
  union all select '05 the new functions are not there yet (0 expected)', '0',
         (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'card\_order\_%')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
