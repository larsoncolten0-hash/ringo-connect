-- Read-only verification for 2026-10-29_ringo_ai_content_actions.sql.
-- Run after the migration. Every row should say ok = true.

select 'events.description column exists' as check_name,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'events' and column_name = 'description') as ok
union all
select 'tracks.description column exists',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tracks' and column_name = 'description')
union all
select 'draft_type CHECK allows the 3 new types',
       coalesce((select pg_get_constraintdef(con.oid) ilike '%event.update%'
                        and pg_get_constraintdef(con.oid) ilike '%track.update%'
                        and pg_get_constraintdef(con.oid) ilike '%menu_item.update%'
                 from pg_constraint con
                 join pg_class rel on rel.oid = con.conrelid
                 join pg_namespace nsp on nsp.oid = rel.relnamespace
                 where nsp.nspname = 'public' and rel.relname = 'ai_drafts' and con.contype = 'c'
                   and pg_get_constraintdef(con.oid) ilike '%draft_type%'), false) as ok
union all
select 'draft_type CHECK still allows the 4 prior types',
       coalesce((select pg_get_constraintdef(con.oid) ilike '%profile.update%'
                        and pg_get_constraintdef(con.oid) ilike '%product.create%'
                        and pg_get_constraintdef(con.oid) ilike '%event.create%'
                        and pg_get_constraintdef(con.oid) ilike '%product.update%'
                 from pg_constraint con
                 join pg_class rel on rel.oid = con.conrelid
                 join pg_namespace nsp on nsp.oid = rel.relnamespace
                 where nsp.nspname = 'public' and rel.relname = 'ai_drafts' and con.contype = 'c'
                   and pg_get_constraintdef(con.oid) ilike '%draft_type%'), false)
union all
select 'ai_apply_event_update exists and is SECURITY INVOKER',
       coalesce((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ai_apply_event_update'), false)
union all
select 'ai_apply_track_update exists and is SECURITY INVOKER',
       coalesce((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ai_apply_track_update'), false)
union all
select 'ai_apply_menu_item_update exists and is SECURITY INVOKER',
       coalesce((select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'ai_apply_menu_item_update'), false)
union all
select 'all 3 apply functions callable by authenticated, not anon',
       has_function_privilege('authenticated', 'public.ai_apply_event_update(uuid, uuid, jsonb, jsonb)', 'execute')
       and has_function_privilege('authenticated', 'public.ai_apply_track_update(uuid, uuid, jsonb, jsonb)', 'execute')
       and has_function_privilege('authenticated', 'public.ai_apply_menu_item_update(uuid, uuid, jsonb, jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.ai_apply_event_update(uuid, uuid, jsonb, jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.ai_apply_track_update(uuid, uuid, jsonb, jsonb)', 'execute')
       and not has_function_privilege('anon', 'public.ai_apply_menu_item_update(uuid, uuid, jsonb, jsonb)', 'execute')
union all
select 'events/tracks/menu_items tables untouched (dependency)',
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'events')
       and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'tracks')
       and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'menu_items');
