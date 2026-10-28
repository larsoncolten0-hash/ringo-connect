-- ROLLBACK for 2027-01-15_church_inventory.sql — puts the original category line back (Business & E-commerce only). Touches no data. Safe to re-run.
-- Churches that already started tracking keep their stock records and movements; they simply cannot start tracking NEW products until the migration is applied again.
begin;

do $rb$
declare
  v_oid regprocedure := to_regprocedure('public.inv_start_tracking(uuid,uuid,uuid,integer,integer,uuid)');
  v_def text;
  v_new text;
  v_old constant text := $a$select (p.category in ('business_ecommerce', 'church_ministries') or coalesce(p.categories, '{}'::text[]) && array['business_ecommerce', 'church_ministries']) into v_cat$a$;
  v_orig constant text := $b$select (p.category = 'business_ecommerce' or 'business_ecommerce' = any (coalesce(p.categories, '{}'::text[]))) into v_cat$b$;
begin
  if v_oid is null then raise exception 'rollback refused: inv_start_tracking is missing'; end if;
  v_def := pg_get_functiondef(v_oid);
  if position('church_ministries' in v_def) = 0 then return; end if; -- already original
  v_new := replace(v_def, v_old, v_orig);
  if v_new = v_def then raise exception 'rollback refused: the widened line was not found; nothing was changed'; end if;
  execute v_new;
end $rb$;

commit;
