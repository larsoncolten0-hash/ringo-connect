-- Music & Entertainment category features (see src/lib/categories.ts for
-- the MUSIC_ROLES id list and the recommended theme — this migration only
-- stores data, the meaning lives in application code).
--
-- Additive/idempotent throughout, for the same reason as
-- 2026-09-12_business_categories.sql: this repo's migration history is
-- incomplete relative to the live schema, so IF NOT EXISTS is the safe
-- default rather than assuming a matching baseline.

-- Sub-type within Music & Entertainment (artist, DJ, producer/beatmaker,
-- band, comedian, actor, other) — purely cosmetic, retitles the music
-- section ("Latest Music" vs "Latest Beats"). Null = generic wording.
alter table profiles add column if not exists music_role text;

-- The only manual on/off switch the Artist Hub needs — every other hub
-- card (Music, Merch, Tickets) already hides itself automatically when
-- there's no content (no tracks / no products / no events), the same way
-- the existing Catalog section already does. Support has no "content" to
-- be empty, so it needs an explicit switch. Defaults to true so it shows
-- up the moment a profile has both a category and a WhatsApp number.
alter table profiles add column if not exists hub_support_enabled boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_music_role_check') then
    alter table profiles add constraint profiles_music_role_check check (
      music_role is null or music_role in ('artist', 'dj', 'producer', 'band', 'comedian', 'actor', 'other')
    );
  end if;
end $$;

-- TRACKS ----------------------------------------------------------------
-- "Latest Music" / "Latest Beats" — a handful of featured tracks, not a
-- streaming catalog. Playback is either the uploaded audio file (native
-- <audio>, see AudioUploadField) or, when no file is uploaded, a link out
-- to wherever the track actually lives (Spotify, YouTube, Audiomack…).
-- `duration` is free text the creator types in (e.g. "3:24") — there's no
-- audio-metadata extraction pipeline, and a self-reported duration next to
-- a self-reported price is no less honest than the rest of the product
-- catalog already is.
create table if not exists tracks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  artist_name text,
  cover_image_url text,
  audio_url text,
  external_url text,
  duration text,
  price numeric(10,2),
  buy_url text,
  whatsapp_message text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table tracks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'tracks' and policyname = 'tracks public read') then
    create policy "tracks public read" on tracks for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'tracks' and policyname = 'tracks owner write') then
    create policy "tracks owner write" on tracks for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;
end $$;

-- EVENTS ------------------------------------------------------------------
-- "Upcoming" — ticket_url is an external link (whatever ticketing page the
-- artist already uses); when it's not set, "Get Ticket" falls back to a
-- WhatsApp message, same pattern as products without a landing_url. There
-- is no in-house ticket purchasing/QR system yet — this table only stores
-- what's shown on the page, not a sale.
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  location text,
  event_date date,
  event_time text,
  cover_image_url text,
  ticket_url text,
  whatsapp_message text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'events' and policyname = 'events public read') then
    create policy "events public read" on events for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'events' and policyname = 'events owner write') then
    create policy "events owner write" on events for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;
end $$;
