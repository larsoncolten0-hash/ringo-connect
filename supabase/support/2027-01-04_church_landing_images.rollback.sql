-- ROLLBACK for 2027-01-04_church_landing_images.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the picture columns of events, announcements and care cases (with their constraints), the care picture confirmation, the care picture trigger and function, and the
-- ministry_testimonies_public_week function. It touches no other column, row, policy, trigger or function of any table.
--
-- DATA SAFETY: dropping a picture column deletes the picture ADDRESSES stored in it (the image files themselves stay in storage). This file REFUSES to run while any picture address exists. To drop them anyway,
-- confirm the loss explicitly by adding this line as the FIRST statement inside the transaction (same script, same transaction):
--     select set_config('church_landing.allow_data_loss', 'yes', true);
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-04_church_landing_images.sql';
  v_rows bigint := 0;
  v_t text;
  v_bad text;
begin
  foreach v_t in array array['ministry_events', 'ministry_announcements', 'ministry_care_cases'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = v_t and column_name = 'image_url') then
      if coalesce(col_description(to_regclass('public.' || v_t), (select attnum from pg_attribute where attrelid = to_regclass('public.' || v_t) and attname = 'image_url')), '') <> v_marker then
        raise exception 'rollback refused: public.%.image_url exists but is not managed by this migration', v_t;
      end if;
      execute format('select count(*) from public.%I where image_url is not null', v_t) into v_bad;
      v_rows := v_rows + v_bad::bigint;
    end if;
  end loop;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('ministry_testimonies_public_week', 'ministry_care_image_guard') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  if v_rows > 0 and coalesce(current_setting('church_landing.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: % picture address(es) are stored. Confirm the loss with: select set_config(''church_landing.allow_data_loss'', ''yes'', true);', v_rows;
  end if;
end $$;

drop trigger if exists ministry_care_cases_image_trg on public.ministry_care_cases;
drop function if exists public.ministry_care_image_guard();
drop function if exists public.ministry_testimonies_public_week(uuid, timestamptz, integer);

alter table public.ministry_care_cases drop constraint if exists ministry_care_cases_image_consent_check;
alter table public.ministry_care_cases drop constraint if exists ministry_care_cases_image_url_check;
alter table public.ministry_announcements drop constraint if exists ministry_announcements_image_url_check;
alter table public.ministry_events drop constraint if exists ministry_events_image_url_check;
alter table public.ministry_care_cases drop column if exists image_consent;
alter table public.ministry_care_cases drop column if exists image_url;
alter table public.ministry_announcements drop column if exists image_url;
alter table public.ministry_events drop column if exists image_url;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and column_name in ('image_url', 'image_consent') and table_name in ('ministry_events', 'ministry_announcements', 'ministry_care_cases')) then
    raise exception 'rollback postcondition failed: a column is still there';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ministry_testimonies_public_week', 'ministry_care_image_guard')) then
    raise exception 'rollback postcondition failed: a function is still there';
  end if;
  if to_regprocedure('public.ministry_testimonies_public(uuid)') is null then raise exception 'rollback postcondition failed: the original testimonies function is gone'; end if;
end $$;

commit;
