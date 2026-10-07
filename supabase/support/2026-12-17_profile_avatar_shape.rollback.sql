-- Rollback for 2026-12-17_profile_avatar_shape.sql. Every profile picture goes back to the (only) round display.
begin;
alter table public.profiles drop constraint if exists profiles_avatar_shape_check;
alter table public.profiles drop column if exists avatar_shape;
commit;
