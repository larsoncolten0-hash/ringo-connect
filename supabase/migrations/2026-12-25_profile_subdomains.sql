-- Custom profile addresses (david.<profile domain>) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Purely additive: TWO new tables and ONE new function. No existing table, column, index, constraint, trigger, policy or function is created, altered or dropped, and no row is
-- touched when this file is applied. Deleting the three objects later leaves no trace on anything that existed before it.
--
--   NEW TABLE  profile_subdomains          one row per profile that chose a custom address: the profile and the subdomain label it owns.
--       profile_id   PRIMARY KEY, so a profile has at most one address; deleted with its profile (ON DELETE CASCADE).
--       subdomain    UNIQUE, so two profiles can never hold the same address, even when two requests race.
--                    CHECK: lowercase letters, digits and single hyphens, 3-30 characters, not starting/ending with a hyphen, no "--" (also blocks punycode "xn--").
--                    Reserved names (www, admin, api ...) are enforced by the application (src/lib/profileSubdomain.ts), which owns that list.
--   NEW TABLE  profile_subdomain_retired   an address a profile used to have, kept (never silently dropped) so it can be (a) reserved for that profile for a while and (b) forwarded to its
--                                          new address. Reserved = nobody else can claim it until retired_until (90 days); the previous owner may take it back at any time.
--   NEW FUNCTION claim_profile_subdomain(profile, name, reserve_days)   the ONLY way the application claims or changes an address. One transaction: advisory locks on the name and on the
--                                          profile (so two requests for one name, or two changes by one profile, are serialized), then the rules, then the write. Returns one of
--                                          'ok' | 'unchanged' | 'taken' | 'recently_released' | 'invalid' | 'no_profile'. SECURITY DEFINER, search_path pinned, EXECUTE for service_role only.
--
--   RULES it enforces: a name equal to ANOTHER profile's username is refused ('taken', so nobody can impersonate a business before its owner claims the name); a name held by another profile is
--          'taken'; a name another profile released less than reserve_days ago is 'recently_released'; changing releases the old name into profile_subdomain_retired in the same transaction.
--
--   ACCESS: row level security is ON with NO policy and no grant to anon / authenticated on either table, so the browser can neither read nor write them. The dashboard API
--           (/api/profile/subdomain) and the middleware reach them with the service role only, after checking who the caller is and that the account is on a paid plan.
--
-- Depends on: public.profiles (id, username). Nothing else.
-- Rollback: supabase/support/2026-12-25_profile_subdomains.rollback.sql.  Verify: supabase/support/2026-12-25_profile_subdomains.verify.sql.

begin;

create table if not exists public.profile_subdomains (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  subdomain text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_subdomains_subdomain_key unique (subdomain),
  constraint profile_subdomains_subdomain_format check (
    subdomain ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' and subdomain !~ '--'
  )
);

create table if not exists public.profile_subdomain_retired (
  subdomain text primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  retired_until timestamptz not null,
  created_at timestamptz not null default now(),
  constraint profile_subdomain_retired_format check (
    subdomain ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' and subdomain !~ '--'
  )
);

alter table public.profile_subdomains enable row level security;
alter table public.profile_subdomain_retired enable row level security;
revoke all on public.profile_subdomains from anon, authenticated;
revoke all on public.profile_subdomain_retired from anon, authenticated;
grant select, insert, update, delete on public.profile_subdomains to service_role;
grant select, insert, update, delete on public.profile_subdomain_retired to service_role;

create or replace function public.claim_profile_subdomain(p_profile_id uuid, p_subdomain text, p_reserve_days integer default 90)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current text;
  v_retired public.profile_subdomain_retired%rowtype;
begin
  if p_subdomain is null or p_subdomain !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' or p_subdomain ~ '--' then
    return 'invalid';
  end if;
  if p_profile_id is null or not exists (select 1 from public.profiles where id = p_profile_id) then
    return 'no_profile';
  end if;

  -- Serialize: first everyone asking for this NAME, then this PROFILE's own changes. (Always in this order, and nothing waits for a name lock while holding a profile lock.)
  perform pg_advisory_xact_lock(hashtextextended('profile_subdomain:' || p_subdomain, 0));
  perform pg_advisory_xact_lock(hashtextextended('profile_subdomain_owner:' || p_profile_id::text, 0));

  if exists (select 1 from public.profiles where username = p_subdomain and id <> p_profile_id) then
    return 'taken';
  end if;
  if exists (select 1 from public.profile_subdomains where subdomain = p_subdomain and profile_id <> p_profile_id) then
    return 'taken';
  end if;

  select * into v_retired from public.profile_subdomain_retired where subdomain = p_subdomain;
  if found then
    if v_retired.profile_id <> p_profile_id and v_retired.retired_until > now() then
      return 'recently_released';
    end if;
    -- Either the reservation has run out, or its previous owner is taking the name back: the reservation row has done its job.
    delete from public.profile_subdomain_retired where subdomain = p_subdomain;
  end if;

  select subdomain into v_current from public.profile_subdomains where profile_id = p_profile_id;
  if v_current = p_subdomain then
    return 'unchanged';
  end if;

  if v_current is not null then
    insert into public.profile_subdomain_retired (subdomain, profile_id, retired_until)
    values (v_current, p_profile_id, now() + make_interval(days => greatest(coalesce(p_reserve_days, 90), 0)))
    on conflict (subdomain) do update set profile_id = excluded.profile_id, retired_until = excluded.retired_until;
    update public.profile_subdomains set subdomain = p_subdomain, updated_at = now() where profile_id = p_profile_id;
  else
    insert into public.profile_subdomains (profile_id, subdomain) values (p_profile_id, p_subdomain);
  end if;
  return 'ok';
exception
  when unique_violation then
    -- Belt and braces: the unique constraint is the last word. The whole attempt (including the retire step) is rolled back.
    return 'taken';
end;
$$;

revoke all on function public.claim_profile_subdomain(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.claim_profile_subdomain(uuid, text, integer) to service_role;

commit;
