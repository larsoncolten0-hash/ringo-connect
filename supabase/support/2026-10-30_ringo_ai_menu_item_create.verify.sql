-- Read-only verification for 2026-10-30_ringo_ai_menu_item_create.sql.
-- Run after the migration. Every row should say ok = true.

select 'draft_type CHECK allows menu_item.create' as check_name,
       coalesce((select pg_get_constraintdef(con.oid) ilike '%menu_item.create%'
                 from pg_constraint con
                 join pg_class rel on rel.oid = con.conrelid
                 join pg_namespace nsp on nsp.oid = rel.relnamespace
                 where nsp.nspname = 'public' and rel.relname = 'ai_drafts' and con.contype = 'c'
                   and pg_get_constraintdef(con.oid) ilike '%draft_type%'), false) as ok
union all
select 'draft_type CHECK still allows the 7 prior types',
       coalesce((select pg_get_constraintdef(con.oid) ilike '%profile.update%'
                        and pg_get_constraintdef(con.oid) ilike '%product.create%'
                        and pg_get_constraintdef(con.oid) ilike '%event.create%'
                        and pg_get_constraintdef(con.oid) ilike '%product.update%'
                        and pg_get_constraintdef(con.oid) ilike '%event.update%'
                        and pg_get_constraintdef(con.oid) ilike '%track.update%'
                        and pg_get_constraintdef(con.oid) ilike '%menu_item.update%'
                 from pg_constraint con
                 join pg_class rel on rel.oid = con.conrelid
                 join pg_namespace nsp on nsp.oid = rel.relnamespace
                 where nsp.nspname = 'public' and rel.relname = 'ai_drafts' and con.contype = 'c'
                   and pg_get_constraintdef(con.oid) ilike '%draft_type%'), false)
union all
select 'ai_create_menu_item exists and is SECURITY INVOKER',
       coalesce((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ai_create_menu_item'), false)
union all
select 'ai_create_menu_item callable by authenticated, not anon',
       has_function_privilege('authenticated', 'public.ai_create_menu_item(uuid, uuid, uuid, text, text, numeric, boolean, boolean, int)', 'execute')
       and not has_function_privilege('anon', 'public.ai_create_menu_item(uuid, uuid, uuid, text, text, numeric, boolean, boolean, int)', 'execute')
union all
select 'menu_items/menu_categories tables untouched (dependency)',
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'menu_items')
       and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'menu_categories');
