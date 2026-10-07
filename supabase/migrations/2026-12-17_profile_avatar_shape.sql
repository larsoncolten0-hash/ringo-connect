-- Profile picture shape - PROPOSED, NOT APPLIED. REQUIRES OWNER APPROVAL. Run once in the Supabase SQL editor.
-- Rollback: supabase/support/2026-12-17_profile_avatar_shape.rollback.sql. Check: supabase/support/2026-12-17_profile_avatar_shape.verify.sql.
--
-- What it does (and nothing else)
--   Adds ONE column to public.profiles: avatar_shape text NOT NULL DEFAULT 'round', limited by a check to 'round' or 'square'.
--   Every existing profile (and every new one) is 'round', which is exactly how profile pictures already display. No row is otherwise changed. No policy, trigger, function, grant,
--   index or other table is touched. The existing RLS on profiles already decides who may read or update the row, so the owner (and a team member allowed to edit the profile)
--   change it like any other profile field.
--   It is a DISPLAY preference only: the stored picture, its upload, crop, storage and PWA icons are untouched.
--   Idempotent: safe to run twice. The app works before it is applied (every profile is simply round; the editor only sends the field when someone changes it).

begin;

alter table public.profiles
  add column if not exists avatar_shape text not null default 'round';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_shape_check') then
    alter table public.profiles
      add constraint profiles_avatar_shape_check check (avatar_shape in ('round', 'square'));
  end if;
end $$;

commit;
