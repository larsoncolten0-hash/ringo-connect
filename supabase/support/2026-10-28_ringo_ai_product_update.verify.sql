-- Read-only verification for 2026-10-28_ringo_ai_product_update.sql.
-- Run after the migration. Every row should say ok = true.

select 'draft_type CHECK allows product.update' as check_name,
       coalesce((select pg_get_constraintdef(con.oid) ilike '%product.update%'
                 from pg_constraint con
                 join pg_class rel on rel.oid = con.conrelid
                 join pg_namespace nsp on nsp.oid = rel.relnamespace
                 where nsp.nspname = 'public' and rel.relname = 'ai_drafts' and con.contype = 'c'
                   and pg_get_constraintdef(con.oid) ilike '%draft_type%'), false) as ok
union all
select 'draft_type CHECK still allows the 3 existing types',
       coalesce((select pg_get_constraintdef(con.oid) ilike '%profile.update%'
                        and pg_get_constraintdef(con.oid) ilike '%product.create%'
                        and pg_get_constraintdef(con.oid) ilike '%event.create%'
                 from pg_constraint con
                 join pg_class rel on rel.oid = con.conrelid
                 join pg_namespace nsp on nsp.oid = rel.relnamespace
                 where nsp.nspname = 'public' and rel.relname = 'ai_drafts' and con.contype = 'c'
                   and pg_get_constraintdef(con.oid) ilike '%draft_type%'), false)
union all
select 'ai_apply_product_update exists',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'ai_apply_product_update')
union all
select 'ai_apply_product_update is SECURITY INVOKER (RLS applies)',
       coalesce((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ai_apply_product_update'), false)
union all
select 'ai_apply_product_update callable by authenticated, not anon',
       has_function_privilege('authenticated', 'public.ai_apply_product_update(uuid, uuid, jsonb, jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.ai_apply_product_update(uuid, uuid, jsonb, jsonb)', 'execute')
union all
select 'products table untouched (dependency)',
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'products');
