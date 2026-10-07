-- READ-ONLY check for 2026-10-07b_private_file_path_ownership_guard.sql. One SELECT; changes nothing. Every row should say PASS (INFO rows are for you to read).
-- P1/P2/P3: the guard is installed and no API role can execute it.
-- D1/D2 (INFO): EXISTING rows whose file path points outside the row's own business owner's folder. The guard does not touch existing rows. A row listed here is
--               either a staff member's own upload (legitimate) or a path that was pointed at someone else's file: look at each one.
with g as (
  select 'tracks' tbl, 'protected_audio_path' col, 'tracks_protected_audio_path_guard_trg' trg, 'public.tracks'::regclass rel
  union all select 'products', 'digital_file_path', 'products_digital_file_path_guard_trg', 'public.products'::regclass
)
select 'P1' grp, g.trg item, case when exists (select 1 from pg_trigger t where t.tgrelid = g.rel and t.tgname = g.trg and t.tgenabled = 'O' and not t.tgisinternal) then 'present+enabled' else 'MISSING' end value,
       case when exists (select 1 from pg_trigger t where t.tgrelid = g.rel and t.tgname = g.trg and t.tgenabled = 'O' and not t.tgisinternal) then 'PASS' else 'FAIL' end status
  from g
union all
select 'P2', 'private_file_path_guard() has a pinned search_path',
       coalesce((select (p.proconfig::text like '%search_path%')::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'private_file_path_guard'), 'missing'),
       case when coalesce((select p.proconfig::text like '%search_path%' from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'private_file_path_guard'), false) then 'PASS' else 'FAIL' end
union all
select 'P3', 'no API role can EXECUTE private_file_path_guard()',
       coalesce((select string_agg(distinct coalesce(nullif(pg_get_userbyid(a.grantee), ''), 'PUBLIC'), ',')
                   from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.pronamespace = 'public'::regnamespace and p.proname = 'private_file_path_guard' and a.privilege_type = 'EXECUTE'
                    and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))), 'none'),
       case when exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                          where p.pronamespace = 'public'::regnamespace and p.proname = 'private_file_path_guard' and a.privilege_type = 'EXECUTE'
                            and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then 'FAIL' else 'PASS' end
union all
select 'D1', 'tracks whose protected_audio_path is outside the owner''s folder (count)',
       (select count(*)::text from public.tracks t join public.profiles p on p.id = t.profile_id
         where coalesce(t.protected_audio_path, '') <> '' and split_part(t.protected_audio_path, '/', 1) <> p.user_id::text), 'INFO'
union all
select 'D2', 'products whose digital_file_path is outside the owner''s folder (count)',
       (select count(*)::text from public.products t join public.profiles p on p.id = t.profile_id
         where coalesce(t.digital_file_path, '') <> '' and split_part(t.digital_file_path, '/', 1) <> p.user_id::text), 'INFO'
union all
select 'ZZ', 'OVERALL', 'see above', 'INFO'
order by 1, 2;
