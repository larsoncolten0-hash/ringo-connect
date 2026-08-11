-- Ringo Connect — database schema
-- Run this in the Supabase SQL editor on a fresh project.

-- 1. PLANS ----------------------------------------------------------------
create table plans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,               -- 'free' | 'pro' | 'business'
  max_links int,                           -- null = unlimited
  max_products int,                        -- null = unlimited, 0 = catalog locked
  pixels_enabled boolean not null default false,
  custom_theme_enabled boolean not null default false,
  full_analytics_enabled boolean not null default false,
  badge_removed boolean not null default false,
  created_at timestamptz not null default now()
);

insert into plans (name, max_links, max_products, pixels_enabled, custom_theme_enabled, full_analytics_enabled, badge_removed)
values
  ('free', 5, 0, false, false, false, false),
  ('pro', null, 20, true, true, true, false),
  ('business', null, null, true, true, true, true);

-- 2. USERS (extends Supabase auth.users) -----------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'creator' check (role in ('creator', 'admin')),
  plan_id uuid references plans(id) default (select id from plans where name = 'free'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

-- 3. PROFILES ---------------------------------------------------------------
create table profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  username text not null unique,           -- used in the public URL /:username
  name text,
  bio text,
  avatar_url text,
  theme_color text default '#4F46E5',
  whatsapp_number text,
  default_whatsapp_message text default 'Hi! I found you on Ringo Connect.',
  facebook_pixel_id text,
  tiktok_pixel_id text,
  about_long_bio text,
  about_email text,
  about_location text,
  about_hours text,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. SOCIAL LINKS -------------------------------------------------------------
create table social_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  platform text not null,                  -- 'instagram' | 'tiktok' | 'x' | 'youtube' | ...
  url text not null,
  sort_order int not null default 0
);

-- 5. LINKS --------------------------------------------------------------------
create table links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  url text not null,
  image_url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 6. PRODUCTS -------------------------------------------------------------------
create table products (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  price numeric(10,2),
  description text,
  image_url text,
  landing_url text,
  whatsapp_message text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- 7. CLICK EVENTS (for analytics) ------------------------------------------------
create table click_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  target_type text not null check (target_type in ('page', 'link', 'product', 'whatsapp')),
  target_id uuid,                          -- null when target_type = 'page'
  created_at timestamptz not null default now()
);
create index click_events_profile_id_idx on click_events (profile_id, created_at);

-- 8. AUDIT LOG (admin actions, e.g. impersonation) -------------------------------
create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.users(id),
  action text not null,                    -- 'impersonate' | 'suspend' | 'change_plan' | ...
  target_user_id uuid references public.users(id),
  details jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.users enable row level security;
alter table profiles enable row level security;
alter table social_links enable row level security;
alter table links enable row level security;
alter table products enable row level security;
alter table click_events enable row level security;
alter table admin_audit_log enable row level security;
alter table plans enable row level security;

-- helper: is the current auth user an admin?
create or replace function is_admin() returns boolean as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer;

-- plans: everyone can read (needed to show pricing/upgrade prompts)
create policy "plans are publicly readable" on plans for select using (true);

-- users: a creator can read/update only their own row; admins can read/update all
create policy "users read own row" on public.users for select using (auth.uid() = id or is_admin());
create policy "users update own row" on public.users for update using (auth.uid() = id or is_admin());

-- profiles: public read (for the public profile page); owner or admin can write
create policy "profiles are publicly readable" on profiles for select using (published = true or auth.uid() = user_id or is_admin());
create policy "profiles insert by owner" on profiles for insert with check (auth.uid() = user_id);
create policy "profiles update by owner or admin" on profiles for update using (auth.uid() = user_id or is_admin());
create policy "profiles delete by owner or admin" on profiles for delete using (auth.uid() = user_id or is_admin());

-- child tables (social_links, links, products): same pattern, scoped via profile_id -> profiles.user_id
create policy "social_links public read" on social_links for select using (true);
create policy "social_links owner write" on social_links for all using (
  exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
);

create policy "links public read" on links for select using (true);
create policy "links owner write" on links for all using (
  exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
);

create policy "products public read" on products for select using (true);
create policy "products owner write" on products for all using (
  exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
);

-- click_events: anyone (including anonymous visitors) can insert; only owner/admin can read
create policy "click_events insert by anyone" on click_events for insert with check (true);
create policy "click_events read by owner or admin" on click_events for select using (
  exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
);

-- admin_audit_log: admins only
create policy "audit log admin only" on admin_audit_log for all using (is_admin());
