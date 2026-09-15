-- Drops "Smart" and the "(1 Month)"/"(1 Year)" duration suffix from the
-- Ringo Card bundle's display name, per the user's request that the
-- title shown on the landing page, get-started form, and admin dashboard
-- just read "Ringo Physical Card". Matched by the current name string
-- (set by 2026-10-10_card_bundle_restructure.sql) rather than by
-- grants_plan_duration_days, so this is a no-op if an admin already
-- renamed either row by hand since that migration ran.
--
-- The (1 Year) row is currently inactive (see that same migration) and
-- has no active twin to collide with, but keeps its own duration suffix
-- here anyway — if it's ever reactivated alongside the (1 Month) row,
-- both rows still need distinct names in admin/addons and anywhere else
-- that lists them together.
update addons
set name = 'Ringo Physical Card'
where name = 'Ringo Smart Physical Card (1 Month)';

update addons
set name = 'Ringo Physical Card (1 Year)'
where name = 'Ringo Smart Physical Card (1 Year)';
