-- Public "current role" badge (e.g. "Chef at Mama's Kitchen") on a staff
-- member's own public profile — see src/app/[username]/page.tsx and
-- ProfileView.tsx. The badge itself is never stored: it's derived live from
-- active organization_members rows every time the public page renders (so
-- removing someone from a team makes their badge disappear with no manual
-- cleanup). This migration only adds the one thing that DOES need to
-- persist — the person's own global opt-out.
--
-- One flag, not per-organization: confirmed in the product spec this was
-- built from — if someone is staff at multiple businesses, the toggle
-- controls whether ANY of those badges show, not each individually.
--
-- Additive/idempotent, same convention as every migration since 2026-09-12.
alter table profiles add column if not exists team_badges_enabled boolean not null default true;

-- No RLS changes needed: the existing "profiles update by owner or admin"
-- policy already covers writing this column (it's just another field on a
-- row the owner can already update), and "profiles are publicly readable"
-- already covers reading it back for the public page's own profile fetch.
