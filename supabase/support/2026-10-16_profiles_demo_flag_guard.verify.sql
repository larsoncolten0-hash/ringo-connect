-- ============================================================================
-- VERIFICATION for supabase/migrations/2026-10-16_profiles_demo_flag_guard.sql
--
-- Part 1: is the guard installed and correctly configured? ONE read-only SELECT over pg_catalog. No INSERT /
--         UPDATE / DELETE / DDL, no transaction, no test writes. The last row (ZZ) is the overall verdict:
--         NOT INSTALLED, INSTALLED BUT MISCONFIGURED, or INSTALLED AND CORRECT.
-- Part 2: an ADVERSARIAL test that attempts real writes as an ordinary authenticated user. It always ends with an
--         intentional error, which aborts its transaction, so nothing can persist even if the guard were missing.
-- Run PART 1 first, then PART 2 on its own (only after the migration has been applied).
-- ============================================================================

-- PART 1 (read-only)
with
t as (
  select tg.* from pg_trigger tg
  where tg.tgrelid = 'public.profiles'::regclass and tg.tgname = 'trg_protect_demo_flags' and not tg.tgisinternal
),
f as (
  select p.* from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'protect_demo_flags'
),
tbl as (
  select pg_get_userbyid(c.relowner) as owner, c.relrowsecurity as rls from pg_class c where c.oid = 'public.profiles'::regclass
),
rows_ as (
  select 'G1' as grp, 'trigger trg_protect_demo_flags exists on public.profiles' as item,
         case when exists (select 1 from t) then 'yes' else 'NO' end as value,
         case when exists (select 1 from t) then 'PASS' else 'MISSING' end as status
  union all
  select 'G1', 'trigger is enabled (tgenabled: O = enabled, D = disabled, R = replica only, A = always)',
         coalesce((select tgenabled::text from t), '-'),
         case when (select tgenabled from t) = 'O' then 'PASS' when exists (select 1 from t) then 'FAIL' else 'MISSING' end
  union all
  select 'G1', 'trigger definition', coalesce((select pg_get_triggerdef(t.oid) from t), '-'),
         case when exists (select 1 from t) then 'INFO' else 'MISSING' end
  union all
  select 'G1', 'trigger timing / events / level',
         coalesce((select (case when (tgtype & 2) <> 0 then 'BEFORE' when (tgtype & 64) <> 0 then 'INSTEAD OF' else 'AFTER' end)
                          || ' ' || concat_ws(' OR ', case when (tgtype & 4) <> 0 then 'INSERT' end, case when (tgtype & 8) <> 0 then 'DELETE' end,
                                                     case when (tgtype & 16) <> 0 then 'UPDATE' end, case when (tgtype & 32) <> 0 then 'TRUNCATE' end)
                          || ' ' || case when (tgtype & 1) <> 0 then 'FOR EACH ROW' else 'FOR EACH STATEMENT' end from t), '-'),
         case when (select (tgtype & 2) <> 0 and (tgtype & 4) <> 0 and (tgtype & 16) <> 0 and (tgtype & 8) = 0 and (tgtype & 1) <> 0 from t) then 'PASS'
              when exists (select 1 from t) then 'FAIL' else 'MISSING' end
  union all
  select 'G1', 'trigger UPDATE OF columns (must be exactly demo_expires_at, is_demo)',
         coalesce((select string_agg(a.attname::text, ', ' order by a.attname) from pg_attribute a, t where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])), '-'),
         case when (select string_agg(a.attname::text, ', ' order by a.attname) from pg_attribute a, t where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])) = 'demo_expires_at, is_demo' then 'PASS'
              when exists (select 1 from t) then 'FAIL' else 'MISSING' end
  union all
  select 'G1', 'trigger calls public.protect_demo_flags()',
         coalesce((select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') in ' || n.nspname from t join pg_proc p on p.oid = t.tgfoid join pg_namespace n on n.oid = p.pronamespace), '-'),
         case when (select p.proname from t join pg_proc p on p.oid = t.tgfoid) = 'protect_demo_flags' then 'PASS' when exists (select 1 from t) then 'FAIL' else 'MISSING' end
  union all
  select 'G2', 'function public.protect_demo_flags exists (count)', (select count(*) from f)::text,
         case when (select count(*) from f) = 1 then 'PASS' when (select count(*) from f) = 0 then 'MISSING' else 'FAIL' end
  union all
  select 'G2', 'function is SECURITY INVOKER (prosecdef must be false)', coalesce((select 'prosecdef=' || prosecdef::text from f), '-'),
         case when (select not prosecdef from f) then 'PASS' when exists (select 1 from f) then 'FAIL' else 'MISSING' end
  union all
  select 'G2', 'function search_path is pinned', coalesce((select coalesce(proconfig::text, 'NONE') from f), '-'),
         case when (select proconfig::text like '%search_path=pg_catalog, public, pg_temp%' from f) then 'PASS' when exists (select 1 from f) then 'FAIL' else 'MISSING' end
  union all
  select 'G2', 'function language / return type', coalesce((select l.lanname || ' / ' || format_type(f.prorettype, null) from f join pg_language l on l.oid = f.prolang), '-'),
         case when (select l.lanname = 'plpgsql' and format_type(f.prorettype, null) = 'trigger' from f join pg_language l on l.oid = f.prolang) then 'PASS' when exists (select 1 from f) then 'FAIL' else 'MISSING' end
  union all
  select 'G2', 'function owner (must equal the profiles table owner)', coalesce((select pg_get_userbyid(proowner) from f), '-') || ' / table owner: ' || (select owner from tbl),
         case when (select pg_get_userbyid(proowner) from f) = (select owner from tbl) then 'PASS' when exists (select 1 from f) then 'FAIL' else 'MISSING' end
  union all
  select 'G2', 'function ACL as stored (NULL = default: PUBLIC can execute)', coalesce((select coalesce(proacl::text, 'NULL (default grants)') from f), '-'), 'INFO'
  union all
  select 'G2', 'EXECUTE for anon / authenticated / service_role / PUBLIC (all must be false)',
         coalesce((select 'anon=' || has_function_privilege('anon', f.oid, 'EXECUTE')::text || ' authenticated=' || has_function_privilege('authenticated', f.oid, 'EXECUTE')::text
                          || ' service_role=' || has_function_privilege('service_role', f.oid, 'EXECUTE')::text
                          || ' PUBLIC=' || exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')::text from f), '-'),
         case when (select not has_function_privilege('anon', f.oid, 'EXECUTE') and not has_function_privilege('authenticated', f.oid, 'EXECUTE')
                           and not has_function_privilege('service_role', f.oid, 'EXECUTE')
                           and not exists (select 1 from aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') from f) then 'PASS'
              when exists (select 1 from f) then 'FAIL' else 'MISSING' end
  union all
  select 'G2', 'function trusts the derived table owner + service_role only (source references pg_class owner lookup and service_role)',
         coalesce((select 'owner_lookup=' || (prosrc like '%relowner%')::text || ' service_role=' || (prosrc like '%''service_role''%')::text || ' hardcoded_postgres=' || (prosrc like '%''postgres''%')::text
                          || ' hardcoded_supabase_admin=' || (prosrc like '%supabase_admin%')::text from f), '-'),
         case when (select prosrc like '%relowner%' and prosrc like '%''service_role''%' and prosrc not like '%''postgres''%' and prosrc not like '%supabase_admin%' from f) then 'PASS'
              when exists (select 1 from f) then 'FAIL' else 'MISSING' end
  union all
  select 'G3', 'profiles columns: is_demo boolean, demo_expires_at timestamptz',
         coalesce((select string_agg(column_name || ' ' || data_type, ', ' order by column_name) from information_schema.columns
                    where table_schema = 'public' and table_name = 'profiles' and column_name in ('is_demo', 'demo_expires_at')), 'MISSING'),
         case when (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
                       and ((column_name = 'is_demo' and data_type = 'boolean') or (column_name = 'demo_expires_at' and data_type = 'timestamp with time zone'))) = 2 then 'PASS' else 'FAIL' end
  union all
  select 'G3', 'profiles table owner / RLS enabled', (select owner || ' / rls=' || rls::text from tbl), 'INFO'
  union all
  select 'G3', 'all non-internal triggers on profiles', coalesce((select string_agg(tgname::text || ' [' || tgenabled::text || ']', ', ' order by tgname) from pg_trigger where tgrelid = 'public.profiles'::regclass and not tgisinternal), '(none)'), 'INFO'
  union all
  select 'G3', 'API roles that are, or can become, the table owner (must be none)',
         coalesce((select string_agg(r.rolname::text, ', ') from pg_roles r where r.rolname in ('anon', 'authenticated', 'authenticator')
                     and (r.rolname::text = (select owner from tbl) or pg_has_role(r.rolname::text, (select owner from tbl), 'MEMBER'))), 'none'),
         case when not exists (select 1 from pg_roles r where r.rolname in ('anon', 'authenticated', 'authenticator')
                                 and (r.rolname::text = (select owner from tbl) or pg_has_role(r.rolname::text, (select owner from tbl), 'MEMBER'))) then 'PASS' else 'FAIL' end
  union all
  select 'G3', 'anon / authenticated that can become service_role (must be none)',
         coalesce((select string_agg(r.rolname::text, ', ') from pg_roles r where r.rolname in ('anon', 'authenticated')
                     and exists (select 1 from pg_roles x where x.rolname = 'service_role') and pg_has_role(r.rolname::text, 'service_role', 'MEMBER')), 'none'),
         case when not exists (select 1 from pg_roles r where r.rolname in ('anon', 'authenticated')
                                 and exists (select 1 from pg_roles x where x.rolname = 'service_role') and pg_has_role(r.rolname::text, 'service_role', 'MEMBER')) then 'PASS' else 'FAIL' end
  union all
  select 'G3', 'table-level UPDATE / INSERT still granted to authenticated (unchanged by the guard: the trigger, not privileges, protects the columns)',
         'UPDATE=' || has_table_privilege('authenticated', 'public.profiles', 'UPDATE')::text || ' INSERT=' || has_table_privilege('authenticated', 'public.profiles', 'INSERT')::text, 'INFO'
)
select grp, item, value, status from rows_
union all
select 'ZZ', 'OVERALL: is the guard currently installed and correctly configured?',
       case when (select count(*) from rows_ where status = 'MISSING') > 0 then 'NOT INSTALLED (' || (select count(*) from rows_ where status = 'MISSING') || ' item(s) missing)'
            when (select count(*) from rows_ where status = 'FAIL') > 0 then 'INSTALLED BUT MISCONFIGURED (' || (select count(*) from rows_ where status = 'FAIL') || ' failing check(s))'
            else 'INSTALLED AND CORRECT (' || (select count(*) from rows_ where status = 'PASS') || ' checks pass)' end,
       case when (select count(*) from rows_ where status in ('MISSING', 'FAIL')) = 0 then 'PASS' else 'FAIL' end
order by 1, 2;

-- PART 2 (adversarial). ONE DO block. It ends by raising an INTENTIONAL error whose message is the report, so the
-- whole transaction is aborted and NOTHING can persist, even if the guard were missing. Expect: ERROR: ADVERSARIAL
-- RESULT (intentional; nothing was changed) followed by ADV1..ADV5 and CTL1..CTL2 lines, all PASS. Any line that
-- says FAIL means the guard is not doing its job (or, for ADV3, that the attack never reached the guard).
do $$
declare
  v_pid uuid; v_uid uuid; v_dpid uuid; v_duid uuid;
  v_res text;
  v_out text := E'\n';
begin
  select id, user_id into v_pid, v_uid from public.profiles where is_demo is false and user_id is not null limit 1;
  select id, user_id into v_dpid, v_duid from public.profiles where is_demo is true and user_id is not null limit 1;
  if v_pid is null then raise exception 'ADVERSARIAL test needs at least one non-demo profile with an owner'; end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  begin
    set local role authenticated;
    update public.profiles set is_demo = true where id = v_pid;
    reset role; v_res := 'FAIL - an ordinary owner could set is_demo';
  exception when others then reset role; v_res := case when sqlerrm = 'demo_flag_protected' then 'PASS - refused (demo_flag_protected)' else 'FAIL - unexpected: ' || sqlerrm end;
  end;
  v_out := v_out || 'ADV1 ordinary owner sets is_demo=true : ' || v_res || E'\n';

  begin
    set local role authenticated;
    update public.profiles set demo_expires_at = now() + interval '3650 days' where id = v_pid;
    reset role; v_res := 'FAIL - an ordinary owner could set demo_expires_at';
  exception when others then reset role; v_res := case when sqlerrm = 'demo_flag_protected' then 'PASS - refused' else 'FAIL - unexpected: ' || sqlerrm end;
  end;
  v_out := v_out || 'ADV2 ordinary owner sets demo_expires_at : ' || v_res || E'\n';

  begin
    set local role authenticated;
    -- a COMPLETE row copied from the existing profile (so no NOT NULL column can stop the statement before the guard
    -- is reached), with is_demo forced to true, upserted over itself
    insert into public.profiles
      select * from jsonb_populate_record(null::public.profiles, (select to_jsonb(p) || jsonb_build_object('is_demo', true) from public.profiles p where p.id = v_pid))
    on conflict (id) do update set is_demo = excluded.is_demo;
    reset role; v_res := 'FAIL - upsert changed is_demo';
  exception when others then reset role; v_res := case when sqlerrm = 'demo_flag_protected' then 'PASS - refused' else 'FAIL - refused by an UNRELATED rule, so the guard was not tested: ' || sqlerrm end;
  end;
  v_out := v_out || 'ADV3 upsert ... do update set is_demo=true : ' || v_res || E'\n';

  if v_dpid is not null then
    perform set_config('request.jwt.claim.sub', v_duid::text, true);
    begin
      set local role authenticated;
      update public.profiles set is_demo = false where id = v_dpid;
      reset role; v_res := 'FAIL - a demo user cleared is_demo';
    exception when others then reset role; v_res := case when sqlerrm = 'demo_flag_protected' then 'PASS - refused' else 'FAIL - unexpected: ' || sqlerrm end;
    end;
    v_out := v_out || 'ADV4 demo user clears is_demo : ' || v_res || E'\n';
    begin
      set local role authenticated;
      update public.profiles set demo_expires_at = null where id = v_dpid;
      reset role; v_res := 'FAIL - a demo user cleared demo_expires_at';
    exception when others then reset role; v_res := case when sqlerrm = 'demo_flag_protected' then 'PASS - refused' else 'FAIL - unexpected: ' || sqlerrm end;
    end;
    v_out := v_out || 'ADV5 demo user clears demo_expires_at : ' || v_res || E'\n';
  else
    v_out := v_out || E'ADV4/ADV5 skipped: no demo profile exists\n';
  end if;

  perform set_config('request.jwt.claim.sub', v_uid::text, true);
  begin
    set local role authenticated;
    update public.profiles set name = name, is_demo = is_demo where id = v_pid;
    reset role; v_res := 'PASS - ordinary/unchanged write allowed';
  exception when others then reset role; v_res := 'FAIL - ' || sqlerrm;
  end;
  v_out := v_out || 'CTL1 owner unchanged write : ' || v_res || E'\n';
  begin
    set local role service_role;
    update public.profiles set is_demo = is_demo where id = v_pid;
    reset role; v_res := 'PASS - service_role allowed';
  exception when others then reset role; v_res := 'FAIL - ' || sqlerrm;
  end;
  v_out := v_out || 'CTL2 service_role write : ' || v_res || E'\n';

  raise exception 'ADVERSARIAL RESULT (intentional; nothing was changed):%', v_out;
end $$;
