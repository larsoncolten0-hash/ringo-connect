-- ROLLBACK for 2027-01-05_church_groups_pastors.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the four tables (public groups, group photos, pastors, about), the announcement group column, three functions and six triggers. It touches no other column, row,
-- policy, trigger or function.
--
-- DATA SAFETY: dropping the tables deletes every group description, leader name, photo address, pastor and vision/mission text, and dropping the announcement column deletes the group addressing of notices
-- (and the notices addressed to a group are deleted together with the group). The image files themselves stay in storage. This file REFUSES to run while any such row exists. To drop them anyway, confirm the
-- loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('church_phase3.allow_data_loss', 'yes', true);
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-05_church_groups_pastors.sql';
  v_rows bigint := 0;
  v_t text;
  v_n bigint;
  v_bad text;
begin
  foreach v_t in array array['church_public_groups', 'church_group_photos', 'church_pastors', 'church_about'] loop
    if to_regclass('public.' || v_t) is not null then
      if coalesce(obj_description(to_regclass('public.' || v_t), 'pg_class'), '') <> v_marker then raise exception 'rollback refused: public.% exists but is not managed by this migration', v_t; end if;
      execute format('select count(*) from public.%I', v_t) into v_n;
      v_rows := v_rows + v_n;
    end if;
  end loop;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ministry_announcements' and column_name = 'public_group_id') then
    select count(*) into v_n from public.ministry_announcements where public_group_id is not null;
    v_rows := v_rows + v_n;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('church_phase3_guard', 'church_group_photo_guard', 'ministry_announcement_group_guard') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  if v_rows > 0 and coalesce(current_setting('church_phase3.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: % row(s) exist. Confirm the loss with: select set_config(''church_phase3.allow_data_loss'', ''yes'', true);', v_rows;
  end if;
end $$;

drop trigger if exists ministry_announcements_group_trg on public.ministry_announcements;
drop function if exists public.ministry_announcement_group_guard();
drop index if exists public.ministry_announcements_group_idx;
alter table public.ministry_announcements drop column if exists public_group_id;

drop table if exists public.church_group_photos;
drop table if exists public.church_public_groups;
drop table if exists public.church_pastors;
drop table if exists public.church_about;
drop function if exists public.church_group_photo_guard();
drop function if exists public.church_phase3_guard();

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name in ('church_public_groups', 'church_group_photos', 'church_pastors', 'church_about')) then raise exception 'rollback postcondition failed: a table is still there'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ministry_announcements' and column_name = 'public_group_id') then raise exception 'rollback postcondition failed: the announcement column is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_phase3_guard', 'church_group_photo_guard', 'ministry_announcement_group_guard')) then raise exception 'rollback postcondition failed: a function is still there'; end if;
  if to_regclass('public.church_groups') is null or to_regclass('public.ministry_announcements') is null then raise exception 'rollback postcondition failed: an earlier table is gone'; end if;
end $$;

commit;
