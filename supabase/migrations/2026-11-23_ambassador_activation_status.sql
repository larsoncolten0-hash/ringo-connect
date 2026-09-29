-- Ringo Ambassador Program — Phase D addition: a read-only activation
-- STATUS breakdown, for dashboard display only. NOT YET RUN.
--
-- Why this exists: the approved ambassador_is_activation_ready(p_user_id)
-- (2026-11-21_ambassador_commission_engine.sql) returns a single boolean —
-- correct and sufficient for milestone-2 eligibility, which is all it was
-- ever meant to decide. The Ambassador dashboard's follow-up list needs
-- to say WHICH part is still missing (e.g. "profile complete, PWA not
-- installed") — recreating that breakdown in application code would mean
-- duplicating eligibility logic in TypeScript, which this program's own
-- working rules forbid. This function exists so the SQL layer remains the
-- sole authority on activation logic, full stop — it is a strict,
-- side-effect-free, read-only SUPERSET of ambassador_is_activation_ready(),
-- never a second, competing definition of "activated." Every check below
-- is copied verbatim from that function; if one is ever changed, the
-- other must be changed identically.
--
-- Does not touch, redefine, or replace ambassador_is_activation_ready()
-- itself — both functions continue to exist side by side.
-- ambassador_evaluate_milestone_2() still calls only the original
-- boolean function; this one is never in the commission-evaluation path,
-- only the read/display path.
create or replace function public.ambassador_activation_status(p_user_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user record;
  v_profile record;
  v_profile_complete boolean;
  v_pwa_installed boolean;
begin
  select id, pwa_installed_at, last_active_standalone into v_user from public.users where id = p_user_id;
  if v_user.id is null then
    return jsonb_build_object('account_valid', false, 'profile_complete', false, 'pwa_installed', false, 'ready', false);
  end if;

  select * into v_profile from public.profiles where user_id = p_user_id;
  if v_profile.id is null or coalesce(v_profile.is_demo, false) then
    return jsonb_build_object('account_valid', v_profile.id is not null, 'profile_complete', false, 'pwa_installed', false, 'ready', false);
  end if;

  v_profile_complete := (
    v_profile.avatar_url is not null
    and v_profile.bio is not null and trim(v_profile.bio) <> ''
    and v_profile.category is not null
    and v_profile.username is not null and trim(v_profile.username) <> ''
    and (
      (v_profile.whatsapp_number is not null and trim(v_profile.whatsapp_number) <> '')
      or (v_profile.about_email is not null and trim(v_profile.about_email) <> '')
      or exists (select 1 from public.social_links sl where sl.profile_id = v_profile.id)
    )
    and exists (select 1 from public.links l where l.profile_id = v_profile.id)
    and (
      case
        when v_profile.category = 'restaurant_food' or (v_profile.categories is not null and v_profile.categories @> array['restaurant_food'])
          then exists (select 1 from public.menu_items mi where mi.profile_id = v_profile.id)
        when v_profile.category = 'music_entertainment' or (v_profile.categories is not null and v_profile.categories @> array['music_entertainment'])
          then exists (select 1 from public.tracks t where t.profile_id = v_profile.id) or exists (select 1 from public.music_releases mr where mr.profile_id = v_profile.id)
        else true
      end
    )
  );

  v_pwa_installed := (v_user.pwa_installed_at is not null or coalesce(v_user.last_active_standalone, false) = true);

  return jsonb_build_object(
    'account_valid', true,
    'profile_complete', v_profile_complete,
    'pwa_installed', v_pwa_installed,
    'ready', v_profile_complete and v_pwa_installed
  );
end;
$$;

revoke all on function public.ambassador_activation_status(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ambassador_activation_status(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ambassador_activation_status(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ambassador_activation_status(uuid) to service_role';
  end if;
end $$;
