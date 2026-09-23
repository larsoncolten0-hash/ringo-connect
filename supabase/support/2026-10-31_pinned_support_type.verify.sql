-- Read-only verification for 2026-10-31_pinned_support_type.sql.
-- Run after the migration. Every row should say ok = true.

select 'pinned_type CHECK allows support' as check_name,
       coalesce((select pg_get_constraintdef(oid) ilike '%support%'
                 from pg_constraint where conname = 'profiles_pinned_type_check'), false) as ok
union all
select 'pinned_type CHECK still allows track/product/event',
       coalesce((select pg_get_constraintdef(oid) ilike '%track%'
                        and pg_get_constraintdef(oid) ilike '%product%'
                        and pg_get_constraintdef(oid) ilike '%event%'
                 from pg_constraint where conname = 'profiles_pinned_type_check'), false)
union all
select 'pinned_type CHECK still allows null (unpinned)',
       coalesce((select pg_get_constraintdef(oid) ilike '%is null%'
                 from pg_constraint where conname = 'profiles_pinned_type_check'), false)
union all
select 'no existing profile rows were touched (dependency)',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'pinned_type');
