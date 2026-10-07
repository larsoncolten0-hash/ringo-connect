-- Read-only check for 2026-12-17_profile_avatar_shape.sql. Expect: the column exists (text, not null, default 'round'), the check exists, and every profile is 'round' or 'square'.
select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_shape';
select conname from pg_constraint where conname = 'profiles_avatar_shape_check';
select avatar_shape, count(*) from public.profiles group by avatar_shape order by 1;
