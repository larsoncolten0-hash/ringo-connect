-- Fix affiliate_code sometimes exceeding 8 characters.
--
-- WHAT HAPPENED: set_affiliate_code()'s fallback (from
-- 2026-09-09_affiliate_trigger_hardening.sql, used whenever
-- gen_random_bytes() — from the pgcrypto extension — is unavailable, or
-- after 20 failed uniqueness attempts) assigned the row's ENTIRE id with
-- hyphens stripped: `upper(replace(new.id::text, '-', ''))`, a 32-character
-- string, not 8. Every user whose row was created while that fallback was
-- in play — including anyone who signed up through someone else's
-- referral link, since attribute_referral() runs independently of
-- set_affiliate_code() and doesn't care how long the referrer's own code
-- is — ended up with a 32-char affiliate_code instead of the intended
-- short one.
--
-- THE FIX:
--   1. Redefine set_affiliate_code() to never produce more than 8
--      characters, and to never depend on pgcrypto at all — it uses
--      md5(), which is built into core Postgres. Each retry salts the
--      hash input with an attempt counter, so a collision (checked for
--      real against the table, not assumed) tries a genuinely different
--      candidate rather than looping on the same value.
--   2. Backfill every existing row whose code is longer than 8 chars
--      with a freshly generated, collision-checked 8-char one.
create or replace function set_affiliate_code() returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.affiliate_code is not null then
    return new;
  end if;

  loop
    candidate := upper(substr(md5(new.id::text || ':' || attempts::text), 1, 8));
    attempts := attempts + 1;
    exit when not exists (select 1 from public.users where affiliate_code = candidate);
    -- 8 hex chars = 16^8 (~4.3 billion) possibilities, checked for a real
    -- collision every time — this cap only exists so a corrupted table
    -- state can never hang the trigger, not because collisions are
    -- expected. Never reached in practice.
    exit when attempts > 200;
  end loop;

  new.affiliate_code := candidate;
  return new;
end;
$$ language plpgsql security definer;

-- Same collision-checked scheme, applied to rows the old fallback already
-- left too long. Excludes itself from the uniqueness check so re-running
-- this migration is a no-op the second time.
do $$
declare
  r record;
  candidate text;
  attempts int;
begin
  for r in select id from public.users where length(affiliate_code) > 8 loop
    attempts := 0;
    loop
      candidate := upper(substr(md5(r.id::text || ':' || attempts::text), 1, 8));
      attempts := attempts + 1;
      exit when not exists (select 1 from public.users where affiliate_code = candidate and id <> r.id);
      exit when attempts > 200;
    end loop;
    update public.users set affiliate_code = candidate where id = r.id;
  end loop;
end $$;
