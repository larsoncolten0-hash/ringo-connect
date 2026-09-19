with problems as (
  select 'CONFLICT: relation already exists' as check_name, c.relname::text as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and (c.relname like 'loyalty\_expiry\_log%')

  union all

  select 'CONFLICT: function already exists', p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'loyalty_sweep_expired'

  union all

  select 'MISSING: approved loyalty table', 'public.' || v.t
  from (values
    ('loyalty_rewards'), ('loyalty_packages'), ('loyalty_package_credits'),
    ('loyalty_memberships'), ('loyalty_programs'), ('loyalty_notification_log'),
    ('customer_connections'), ('ringo_customers'), ('profiles')
  ) as v(t)
  where not exists (
    select 1 from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = v.t and t.table_type = 'BASE TABLE'
  )

  union all

  select 'MISSING: approved loyalty function', v.f
  from (values ('loyalty_expire_due_reward(uuid)'), ('loyalty_claim_expiring_packages(integer)'), ('loyalty_record_activity(uuid,uuid,uuid,integer,uuid,text,text,text,uuid)')) as v(f)
  where to_regprocedure('public.' || v.f) is null

  union all

  select 'MISSING: required role', v.r
  from (values ('anon'), ('authenticated'), ('service_role')) as v(r)
  where not exists (select 1 from pg_roles r where r.rolname = v.r)

  union all

  select 'MISSING: required function', v.f
  from (values ('gen_random_uuid()'), ('make_interval(integer,integer,integer,integer,integer,integer,double precision)')) as v(f)
  where to_regprocedure(v.f) is null
)
select check_name, detail
from problems
union all
select
  'RESULT',
  case
    when (select count(*) from problems) = 0 then 'PASS - the approved loyalty migration is in place and nothing conflicts. Safe to run the expiry migration.'
    else 'FAIL - ' || (select count(*) from problems) || ' problem(s) listed above. Do NOT run the expiry migration.'
  end
order by 1;
