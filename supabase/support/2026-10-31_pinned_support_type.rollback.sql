-- Rollback for 2026-10-31_pinned_support_type.sql.
-- Refuses to run if any profile currently has pinned_type = 'support' —
-- narrowing the constraint first would either fail outright or (if you
-- clear those rows yourself first) silently unpin those creators' choice.
-- Unpin them deliberately first if you really want to roll this back.

do $$
begin
  if exists (select 1 from public.profiles where pinned_type = 'support') then
    raise exception 'pinned_support_type rollback: % profile(s) still have pinned_type = support — unpin them first',
      (select count(*) from public.profiles where pinned_type = 'support');
  end if;

  if exists (select 1 from pg_constraint where conname = 'profiles_pinned_type_check') then
    alter table public.profiles drop constraint profiles_pinned_type_check;
  end if;
  alter table public.profiles add constraint profiles_pinned_type_check check (
    pinned_type is null or pinned_type in ('track', 'product', 'event')
  );
end $$;
