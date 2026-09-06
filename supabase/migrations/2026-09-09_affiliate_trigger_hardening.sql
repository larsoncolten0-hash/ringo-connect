-- Ringo Connect — harden affiliate triggers so they can never block signup
-- or payment processing
--
-- WHAT HAPPENED: new.users signup was failing with GoTrue's generic
-- "Database error saving new user" — that message means a trigger on
-- auth.users/public.users threw during account creation. The most likely
-- cause here is set_affiliate_code() calling gen_random_bytes(), which
-- comes from the pgcrypto extension — if `create extension pgcrypto`
-- from 2026-09-06_affiliate_system.sql didn't actually take (a
-- permissions hiccup, or that file only partially ran), every single
-- signup breaks, because that trigger fires on every insert into
-- public.users with no fallback.
--
-- THE FIX: re-defines the same four trigger functions (same names, same
-- signatures — the triggers that call them don't need to change at all)
-- so that nothing in the affiliate system can EVER abort account
-- creation or payment recording again, no matter what goes wrong inside
-- them. Run this in the Supabase SQL editor now — it takes effect
-- immediately, no redeploy needed, and undoing a partially-run earlier
-- migration isn't necessary first.
--
-- Also worth doing right after this: Supabase Dashboard → Logs →
-- Postgres Logs, look at the timestamp of a failed signup attempt, and
-- read the actual underlying error. If it says something like
-- "function gen_random_bytes(...) does not exist", the fix below already
-- covers it (falls back to a guaranteed-unique id-derived code instead),
-- but you may still want to run `create extension if not exists pgcrypto;`
-- yourself to get the shorter random-looking codes back.

-- --- BEFORE INSERT: assign a code to every new row -------------------------
create or replace function set_affiliate_code() returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.affiliate_code is not null then
    return new;
  end if;

  begin
    loop
      candidate := upper(encode(gen_random_bytes(5), 'hex'));
      attempts := attempts + 1;
      exit when not exists (select 1 from public.users where affiliate_code = candidate);
      if attempts > 20 then
        exit; -- fall through to the guaranteed-unique fallback below
      end if;
    end loop;
  exception when others then
    -- pgcrypto missing/misconfigured, or anything else unexpected —
    -- never let affiliate-code generation block account creation.
    candidate := null;
  end;

  -- Either the random loop never found a free code in 20 tries
  -- (astronomically unlikely) or it errored out above — either way,
  -- fall back to the id itself, which is already globally unique by
  -- construction, so this can never collide and never needs a retry.
  if candidate is null or exists (select 1 from public.users where affiliate_code = candidate) then
    candidate := upper(replace(new.id::text, '-', ''));
  end if;

  new.affiliate_code := candidate;
  return new;
end;
$$ language plpgsql security definer;

-- --- AFTER INSERT: attribute the referral, if any ---------------------------
create or replace function attribute_referral() returns trigger as $$
declare
  ref_code text;
  referrer_id uuid;
begin
  if new.referred_by is not null then
    return new;
  end if;

  begin
    select raw_user_meta_data->>'ref' into ref_code from auth.users where id = new.id;
    if ref_code is null or length(trim(ref_code)) = 0 then
      return new;
    end if;

    select id into referrer_id
    from public.users
    where affiliate_code = upper(trim(ref_code)) and id <> new.id;

    if referrer_id is not null then
      update public.users set referred_by = referrer_id where id = new.id;
    end if;
  exception when others then
    -- Referral attribution is a nice-to-have — a missed referral is a
    -- minor loss; blocking someone's signup over it is not acceptable.
    null;
  end;

  return new;
end;
$$ language plpgsql security definer;

-- --- BEFORE UPDATE: lock down the affiliate-identity columns ----------------
create or replace function protect_affiliate_fields() returns trigger as $$
begin
  begin
    if auth.uid() is not null and not is_admin() then
      new.affiliate_code := old.affiliate_code;
      new.referred_by := old.referred_by;
      new.affiliate_suspended := old.affiliate_suspended;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$ language plpgsql security definer;

-- --- AFTER INSERT OR UPDATE OF status ON payment_transactions ---------------
create or replace function handle_payment_transaction_commission() returns trigger as $$
declare
  referrer_id uuid;
  referrer_suspended boolean;
  settings record;
begin
  if new.status is distinct from 'success' then
    return new;
  end if;

  begin
    select referred_by, affiliate_suspended into referrer_id, referrer_suspended
    from public.users where id = new.user_id;

    if referrer_id is null or referrer_suspended then
      return new;
    end if;

    select affiliate_enabled, affiliate_commission_rate, affiliate_hold_days
    into settings
    from platform_settings limit 1;

    if settings is null or not settings.affiliate_enabled then
      return new;
    end if;

    insert into affiliate_commissions (
      affiliate_user_id, referred_user_id, payment_transaction_id,
      amount, currency, commission_rate, available_at
    )
    values (
      referrer_id, new.user_id, new.id,
      round(new.amount * settings.affiliate_commission_rate, 2), new.currency, settings.affiliate_commission_rate,
      now() + (settings.affiliate_hold_days || ' days')::interval
    )
    on conflict (payment_transaction_id) do nothing;
  exception when others then
    -- A bug in commission math must never be able to stop a real
    -- payment from being recorded as successful.
    null;
  end;

  return new;
end;
$$ language plpgsql security definer;
