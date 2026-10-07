-- ============================================================================
-- VERIFICATION for the Phase 1 security migrations (2026-10-06a ... 2026-10-06e). READ-ONLY: ONE select over pg_catalog and
-- information_schema. No INSERT / UPDATE / DELETE / DDL, no transaction, no test writes. Safe to run on production, before AND
-- after applying the migrations (before: it shows what is exposed today; after: every row should say PASS).
--
-- Columns: grp (which migration), item, value (what was found), status (PASS / FAIL / INFO).
-- INFO rows are facts the repository cannot know (they need the live database) - read them, they are not failures.
-- ============================================================================
with
users_exposure as (
  select 'A0' as grp,
         'INFO: policies on public.users (cmd / using / with check)' as item,
         coalesce((select string_agg(policyname || ' [' || cmd || '] using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-'), ' ; ')
                     from pg_policies where schemaname = 'public' and tablename = 'users'), 'none') as value,
         'INFO' as status
  union all
  select 'A0', 'INFO: can the API role "authenticated" UPDATE ' || c || ' on public.users? (table or column privilege)',
         case when has_column_privilege('authenticated', 'public.users', c, 'UPDATE') then 'yes' else 'no' end, 'INFO'
    from unnest(array['role', 'plan_id', 'status', 'can_approve_requests']) c
),
rows_ as (
  -- 2026-10-06a: users guard
  select 'A1' as grp, 'users guard trigger trg_a_protect_users_privileged exists, enabled' as item,
         coalesce((select tgenabled::text from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'trg_a_protect_users_privileged' and not tgisinternal), 'MISSING') as value,
         case when exists (select 1 from pg_trigger where tgrelid = 'public.users'::regclass and tgname = 'trg_a_protect_users_privileged' and tgenabled = 'O' and not tgisinternal) then 'PASS' else 'FAIL' end as status
  union all
  select 'A1', 'guard function is SECURITY INVOKER with a pinned search_path',
         coalesce((select (not prosecdef)::text || ' / ' || coalesce(proconfig::text, 'no search_path') from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_users_privileged_columns'), 'MISSING'),
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_users_privileged_columns' and not prosecdef and proconfig::text like '%search_path%') then 'PASS' else 'FAIL' end
  union all
  select 'A1', 'no API role can EXECUTE the guard function',
         coalesce((select string_agg(distinct pg_get_userbyid(a.grantee), ', ') from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where p.pronamespace = 'public'::regnamespace and p.proname = 'protect_users_privileged_columns' and a.privilege_type = 'EXECUTE'
                      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))), 'none'),
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_users_privileged_columns')
                   and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                    where p.pronamespace = 'public'::regnamespace and p.proname = 'protect_users_privileged_columns' and a.privilege_type = 'EXECUTE'
                                      and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then 'PASS' else 'FAIL' end
  union all
  -- 2026-10-06b: profiles guard
  select 'B1', 'profiles guard trigger trg_a_protect_profile_privileged exists, enabled',
         coalesce((select tgenabled::text from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_a_protect_profile_privileged' and not tgisinternal), 'MISSING'),
         case when exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_a_protect_profile_privileged' and tgenabled = 'O' and not tgisinternal) then 'PASS' else 'FAIL' end
  union all
  select 'B1', 'the older demo-flag guard trg_protect_demo_flags is still in place',
         coalesce((select tgenabled::text from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_protect_demo_flags' and not tgisinternal), 'MISSING'),
         case when exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'trg_protect_demo_flags' and tgenabled = 'O' and not tgisinternal) then 'PASS' else 'FAIL' end
  union all
  select 'B1', 'INFO: policies on public.profiles', coalesce((select string_agg(policyname || ' [' || cmd || ']', ' ; ') from pg_policies where schemaname = 'public' and tablename = 'profiles'), 'none'), 'INFO'
  union all
  -- 2026-10-06c: SECURITY DEFINER search_path
  select 'C1', 'SECURITY DEFINER functions in public WITHOUT a pinned search_path (target: none of the 16 named in the migration)',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.prosecdef
                      and p.proname in ('attribute_referral','checkin_ticket','handle_payment_transaction_commission','has_org_permission','is_admin','is_org_member',
                                        'org_team_enabled','protect_affiliate_fields','release_event_ticket_type','request_affiliate_payout','request_commerce_payout',
                                        'request_music_payout','reserve_event_ticket_type','set_affiliate_code','set_digital_ticket_code','set_scanner_session_token','set_table_public_code')
                      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')), 'none'),
         case when not exists (select 1 from pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.prosecdef
                      and p.proname in ('attribute_referral','checkin_ticket','handle_payment_transaction_commission','has_org_permission','is_admin','is_org_member',
                                        'org_team_enabled','protect_affiliate_fields','release_event_ticket_type','request_affiliate_payout','request_commerce_payout',
                                        'request_music_payout','reserve_event_ticket_type','set_affiliate_code','set_digital_ticket_code','set_scanner_session_token','set_table_public_code')
                      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')) then 'PASS' else 'FAIL' end
  union all
  select 'C1', 'protect_affiliate_fields no longer swallows exceptions (fail closed)',
         coalesce((select case when pg_get_functiondef(oid) ilike '%exception when others%' then 'still has the handler' else 'no handler' end from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_affiliate_fields'), 'MISSING'),
         case when exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'protect_affiliate_fields' and pg_get_functiondef(oid) not ilike '%exception when others%') then 'PASS' else 'FAIL' end
  union all
  select 'C1', 'INFO: other SECURITY DEFINER functions still without a pinned search_path (outside this migration)',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.prosecdef
                      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')), 'none'), 'INFO'
  union all
  -- 2026-10-06d: payment idempotency
  select 'D1', 'unique index on payment_transactions (provider, provider_transaction_id)',
         coalesce((select indexdef from pg_indexes where schemaname = 'public' and tablename = 'payment_transactions' and indexdef ilike '%unique%' and indexdef ilike '%provider_transaction_id%' limit 1), 'MISSING'),
         case when exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'payment_transactions' and indexdef ilike '%unique%' and indexdef ilike '%provider_transaction_id%') then 'PASS' else 'FAIL' end
  union all
  -- 2026-10-06e: URL scheme guard
  select 'E1', 'unsafe-URL triggers present: ' || t.tbl,
         coalesce((select tgenabled::text from pg_trigger g where g.tgrelid = to_regclass('public.' || t.tbl) and g.tgname = 'trg_a_unsafe_url_' || t.tbl and not g.tgisinternal), 'MISSING'),
         case when to_regclass('public.' || t.tbl) is null then 'INFO'
              when exists (select 1 from pg_trigger g where g.tgrelid = to_regclass('public.' || t.tbl) and g.tgname = 'trg_a_unsafe_url_' || t.tbl and g.tgenabled = 'O' and not g.tgisinternal) then 'PASS' else 'FAIL' end
    from (values ('products'), ('tracks'), ('events'), ('links'), ('social_links'), ('community_announcements')) t(tbl)
  union all
  -- facts the repository cannot know
  select 'Z1', 'INFO: storage bucket "uploads" (public? size limit? allowed MIME types?)',
         coalesce((select 'public=' || public::text || ' file_size_limit=' || coalesce(file_size_limit::text, 'none') || ' allowed_mime_types=' || coalesce(allowed_mime_types::text, 'any') from storage.buckets where id = 'uploads'), 'bucket not found'), 'INFO'
  union all
  select 'Z1', 'INFO: storage policies on storage.objects (names only)',
         coalesce((select string_agg(policyname || ' [' || cmd || ']', ' ; ') from pg_policies where schemaname = 'storage' and tablename = 'objects'), 'none'), 'INFO'
)
select grp, item, value, status from users_exposure
union all select grp, item, value, status from rows_
union all
select 'ZZ', 'OVERALL (A1, B1, C1, D1, E1 rows)',
       case when exists (select 1 from rows_ where status = 'FAIL') then (select count(*)::text || ' check(s) FAILING' from rows_ where status = 'FAIL') else 'all checks pass' end,
       case when exists (select 1 from rows_ where status = 'FAIL') then 'FAIL' else 'PASS' end
order by 1, 2;
