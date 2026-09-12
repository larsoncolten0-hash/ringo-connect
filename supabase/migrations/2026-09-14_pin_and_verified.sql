-- Verified badge (admin-granted only — see UserTable.tsx / the admin
-- users list; there is no self-serve way for a creator to set this)
-- shown next to the creator's name on their public page. Lives on
-- profiles, not users: users has an RLS policy restricting reads to the
-- row's own owner or an admin, so an anonymous visitor to the public page
-- could never see it there — profiles already has a public-read policy.
alter table profiles add column if not exists verified boolean not null default false;

-- Pinned spotlight — one item (a track, a product/merch, or an event)
-- featured prominently at the top of the public page, replacing the
-- earlier "Artist Hub" nav grid. Polymorphic by design (three possible
-- source tables), so there's no FK here: validity is enforced at write
-- time in PinnedSpotlightCard (the picker only ever offers the profile's
-- own items) and at read time in PinnedSpotlight (a dangling reference —
-- e.g. the pinned track was later deleted — just quietly renders nothing).
alter table profiles add column if not exists pinned_type text;
alter table profiles add column if not exists pinned_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_pinned_type_check') then
    alter table profiles add constraint profiles_pinned_type_check check (
      pinned_type is null or pinned_type in ('track', 'product', 'event')
    );
  end if;
end $$;
