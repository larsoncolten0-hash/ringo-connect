-- Churches & Ministries: stock tracking (Inventory) for church stores — PROPOSED, NOT APPLIED. FOR OWNER APPROVAL.
--
-- WHY: the Inventory screens are offered by the application for the categories in INVENTORY_CATEGORIES (src/lib/bookkeeping/decision.ts), and the database repeats the rule inside inv_start_tracking(), which
-- raises category_not_enabled for any profile that is not Business & E-commerce. Now that church stores can track stock, the application list includes church_ministries; this file widens the ONE database check to match.
--
-- WHAT IT CHANGES: exactly one line inside inv_start_tracking(): the category test now also accepts church_ministries. Nothing else about the function (its checks, locks, idempotency, stock movements) changes, and no
-- other inventory function is touched (they never checked the category; they only act on products that already have tracking started). It edits the LIVE definition with a guarded text replace instead of
-- copying the function body, so it cannot drift from what is deployed: if the expected line is not found it raises and changes nothing.
--
-- APPLY THIS BEFORE (or together with) deploying the application change, otherwise a church that presses "Start tracking" gets category_not_enabled.
-- Re-runnable. Verify (read-only, AFTER): supabase/support/2027-01-15_church_inventory.verify.sql   Rollback: supabase/support/2027-01-15_church_inventory.rollback.sql

begin;

set local lock_timeout = '5s';

do $mig$
declare
  v_oid regprocedure := to_regprocedure('public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)');
  v_def text;
  v_new text;
  v_old constant text := $a$select (p.category = 'business_ecommerce' or 'business_ecommerce' = any (coalesce(p.categories, '{}'::text[]))) into v_cat$a$;
  v_repl constant text := $b$select (p.category in ('business_ecommerce', 'church_ministries') or coalesce(p.categories, '{}'::text[]) && array['business_ecommerce', 'church_ministries']) into v_cat$b$;
begin
  if v_oid is null then raise exception 'precondition failed: inv_start_tracking is missing (apply 2026-12-04_inventory_stock_control.sql first)'; end if;
  v_def := pg_get_functiondef(v_oid);
  if position('church_ministries' in v_def) > 0 then return; end if; -- already widened
  v_new := replace(v_def, v_old, v_repl);
  if v_new = v_def then raise exception 'precondition failed: the expected category line was not found in inv_start_tracking; nothing was changed'; end if;
  execute v_new;
end $mig$;

do $$
begin
  if position('church_ministries' in pg_get_functiondef('public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)'::regprocedure)) = 0 then raise exception 'postcondition failed: the function was not widened'; end if;
  if has_function_privilege('anon', 'public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)', 'execute') or has_function_privilege('authenticated', 'public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)', 'execute') then
    raise exception 'postcondition failed: the function is callable by an API role';
  end if;
end $$;

commit;
