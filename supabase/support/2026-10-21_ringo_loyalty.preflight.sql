with problems as (
  select 'CONFLICT: relation already exists' as check_name, c.relname::text as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and (
      c.relname like 'loyalty\_%'
      or c.relname in ('customer_qr_codes', 'customer_loyalty_prefs')
      or c.relname like 'customer\_qr\_codes\_%'
      or c.relname like 'customer\_loyalty\_prefs\_%'
    )

  union all

  select 'CONFLICT: function already exists', p.oid::regprocedure::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'loyalty\_%'

  union all

  select 'MISSING: required table', 'public.' || v.t
  from (values ('users'), ('profiles'), ('ringo_customers'), ('customer_connections')) as v(t)
  where not exists (
    select 1 from information_schema.tables t
    where t.table_schema = 'public' and t.table_name = v.t and t.table_type = 'BASE TABLE'
  )

  union all

  select 'MISSING: required column or wrong type', 'public.' || v.t || '.' || v.c || ' (' || v.ty || ')'
  from (values
    ('users', 'id', 'uuid'),
    ('profiles', 'id', 'uuid'),
    ('ringo_customers', 'id', 'uuid'),
    ('customer_connections', 'customer_id', 'uuid'),
    ('customer_connections', 'profile_id', 'uuid'),
    ('customer_connections', 'status', 'text')
  ) as v(t, c, ty)
  where not exists (
    select 1 from information_schema.columns k
    where k.table_schema = 'public' and k.table_name = v.t
      and k.column_name = v.c and k.data_type = v.ty
  )

  union all

  select 'MISSING: primary key (needed as foreign key target)', 'public.' || v.t
  from (values ('users'), ('profiles'), ('ringo_customers')) as v(t)
  where not exists (
    select 1 from information_schema.table_constraints tc
    where tc.table_schema = 'public' and tc.table_name = v.t and tc.constraint_type = 'PRIMARY KEY'
  )

  union all

  select 'MISSING: required role', v.r
  from (values ('anon'), ('authenticated'), ('service_role')) as v(r)
  where not exists (select 1 from pg_roles r where r.rolname = v.r)

  union all

  select 'MISSING: required function', v.f
  from (values ('gen_random_uuid()'), ('hashtextextended(text,bigint)'), ('pg_advisory_xact_lock(bigint)')) as v(f)
  where to_regprocedure(v.f) is null
)
select check_name, detail
from problems
union all
select
  'RESULT',
  case
    when (select count(*) from problems) = 0 then 'PASS - no conflicts, all prerequisites present. Safe to run the migration.'
    else 'FAIL - ' || (select count(*) from problems) || ' problem(s) listed above. Do NOT run the migration.'
  end
order by 1;
