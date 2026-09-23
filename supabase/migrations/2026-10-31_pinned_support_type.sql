-- Pin to Top — add "support" as a 4th pinnable option, alongside the
-- existing track/product/event. Purely additive: widens the existing
-- profiles_pinned_type_check CHECK constraint (added in
-- 2026-09-14_pin_and_verified.sql) to also allow 'support'. Touches no
-- existing row — every profile currently pinned to track/product/event, or
-- with no pin at all, is completely unaffected. "support" is a flag only
-- (no pinned_id is ever set for it — Support the Artist isn't a specific
-- row the way a track/product/event is), consistent with the column's
-- existing "polymorphic, no FK, validity enforced in app code" design.
--
-- Rollback: supabase/support/2026-10-31_pinned_support_type.rollback.sql.
-- IMPORTANT: only run the rollback after no profile has pinned_type =
-- 'support' anymore (it would otherwise leave a row violating the
-- narrowed constraint) — the rollback script checks this first.

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'profiles_pinned_type_check') then
    alter table public.profiles drop constraint profiles_pinned_type_check;
  end if;
  alter table public.profiles add constraint profiles_pinned_type_check check (
    pinned_type is null or pinned_type in ('track', 'product', 'event', 'support')
  );
end $$;
