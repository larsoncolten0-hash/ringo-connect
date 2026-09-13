-- Ringo Connect — centralized branding settings
-- Run this once in the Supabase SQL editor.
--
-- A singleton settings row (same shape as platform_settings — see
-- 2026-09-06_affiliate_system.sql for that precedent), read by
-- src/lib/branding.ts and used wherever the app currently hardcodes
-- "Ringo Connect" / "/logo.png" / the indigo brand color: the root
-- layout's <title>/favicon and --ringo-indigo CSS variable, AuthShell's
-- login/signup panel, DashboardShell's and AdminShell's sidebars, the
-- landing page header, and the dashboard/admin PWA manifests' icon/
-- theme_color/background_color fallbacks.
--
-- Unlike platform_settings, nothing here is secret — every column is
-- plain, publicly-displayable branding, so (in addition to admin writes)
-- this gets a public read policy: the landing page, login/signup, and a
-- freshly-uninstalled PWA's manifest all need to read it before anyone
-- is signed in.
--
-- Deliberately minimal for now (exactly the 7 fields asked for) rather
-- than pre-adding columns for ideas mentioned as "later" (a dark-mode
-- logo, email branding, notification branding) — add those as their own
-- `alter table add column if not exists` when actually built, the same
-- additive/idempotent way every migration since 2026-09-12 already
-- works. src/lib/branding.ts's BrandingSettings type is the one place
-- that would need to grow to expose a new column, so extending this
-- later is a small, contained change, not a rearchitecture.

create table if not exists branding_settings (
  id uuid primary key default gen_random_uuid()
);
alter table branding_settings add column if not exists app_name text not null default 'Ringo Connect';
alter table branding_settings add column if not exists short_name text not null default 'Ringo';
-- Null = use the app's own bundled default asset (see
-- src/lib/branding.ts's DEFAULT_BRANDING) rather than a broken image.
alter table branding_settings add column if not exists logo_url text;
alter table branding_settings add column if not exists favicon_url text;
alter table branding_settings add column if not exists primary_color text not null default '#4F46E5';
alter table branding_settings add column if not exists pwa_theme_color text not null default '#4F46E5';
alter table branding_settings add column if not exists pwa_background_color text not null default '#FAFAF8';
alter table branding_settings add column if not exists updated_at timestamptz not null default now();
alter table branding_settings add column if not exists updated_by uuid references public.users(id) on delete set null;

-- Seed the one row this table ever has, only if it's empty — every
-- reader does `select * from branding_settings limit 1`, same pattern
-- platform_settings uses.
insert into branding_settings (app_name)
select 'Ringo Connect'
where not exists (select 1 from branding_settings);

alter table branding_settings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'branding_settings' and policyname = 'branding_settings public read') then
    create policy "branding_settings public read" on branding_settings for select using (true);
  end if;

  if not exists (select 1 from pg_policies where tablename = 'branding_settings' and policyname = 'branding_settings admin write') then
    create policy "branding_settings admin write" on branding_settings for all using (is_admin()) with check (is_admin());
  end if;
end $$;
