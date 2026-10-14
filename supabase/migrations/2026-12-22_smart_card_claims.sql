-- Ringo Smart Cards (QR) — PRE-ISSUED cards that a customer claims later.   ADDITIVE; NOT APPLIED ANYWHERE; needs the owner's explicit approval.
--
-- What this is. A batch of physical Smart Cards is printed with a QR code BEFORE any customer exists. The QR opens  https://<domain>/c/<token> .
-- The token is opaque (160 bits from the platform CSPRNG, base64url); only its SHA-256 hash is ever stored here, so a database leak can not reveal
-- a scannable code. The printed serial (RINGO-0001 ... RINGO-0500) is a human label for matching a card to its QR image; it is NOT a credential.
--
-- Why a NEW table and not `ringo_cards`. `ringo_cards` is the NFC Card Writer's record: user_id NOT NULL (a card exists only once a creator
-- writes it), card_uid is the chip's hardware serial, and association membership cards live there too. Pre-issued, unowned cards do not fit that
-- model, and changing its constraints would risk the working NFC flow. This table is separate; nothing in ringo_cards, the NFC routes, /m-card
-- or /d is touched.
--
-- Lifecycle:  unclaimed -> claimed (once, by an authenticated owner of a profile)        disabled = staff switch-off (lost / misprinted)
--   * a claimed card is NEVER re-assigned through the public claim flow (the claim function only moves unclaimed -> claimed, under a row lock);
--   * scanning a claimed card redirects to the owner's CURRENT username (looked up at scan time; no username is ever printed).
--
-- Access:  every function below is SECURITY DEFINER, has a pinned search_path, and is executable by service_role ONLY (the trusted server routes).
-- The table has row level security with no client write policy; an owner may read ONLY their own claimed cards, and only non-secret columns.
-- Idempotent (create ... if not exists / create or replace / guarded policy). Re-running it changes nothing.

begin;

create table if not exists ringo_smart_cards (
  id uuid primary key default gen_random_uuid(),
  serial text not null unique check (serial ~ '^RINGO-[0-9]{4}$'),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  batch text not null check (batch ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  status text not null default 'unclaimed' check (status in ('unclaimed', 'claimed', 'disabled')),
  claimed_by_user_id uuid references public.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  claimed_at timestamptz,
  scan_count integer not null default 0,
  last_scanned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- an unclaimed card has no owner; a claimed one has a claim time (user / profile may later become null if that account is deleted: the card then stays claimed and shows "unavailable")
  constraint ringo_smart_cards_claim_consistent check (
    (status = 'unclaimed' and claimed_by_user_id is null and profile_id is null and claimed_at is null)
    or (status = 'claimed' and claimed_at is not null)
    or status = 'disabled'
  )
);

create index if not exists ringo_smart_cards_owner_idx on ringo_smart_cards (claimed_by_user_id) where claimed_by_user_id is not null;
create index if not exists ringo_smart_cards_profile_idx on ringo_smart_cards (profile_id) where profile_id is not null;

-- serial, token and batch never change after import (the printed card depends on them)
create or replace function ringo_smart_cards_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.serial is distinct from old.serial or new.token_hash is distinct from old.token_hash or new.batch is distinct from old.batch or new.id is distinct from old.id then
    raise exception 'smart_card_identity_is_immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ringo_smart_cards_immutable_trg on ringo_smart_cards;
create trigger ringo_smart_cards_immutable_trg before update on ringo_smart_cards for each row execute function ringo_smart_cards_immutable();

create table if not exists ringo_smart_card_rate_events (
  id bigserial primary key,
  kind text not null,
  subject_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists ringo_smart_card_rate_events_idx on ringo_smart_card_rate_events (kind, subject_hash, created_at desc);

-- ---------------------------------------------------------------------------------------------------------------- functions
-- Same proven design as bk_doc_rate_limit_hit: keyed-hash subject (never a raw IP), advisory lock, self-pruning, whitelisted kinds.
create or replace function smartcard_rate_limit_hit(p_kind text, p_subject_hash text, p_window_seconds int, p_max int) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count int;
begin
  if p_kind is null or p_kind not in ('scan_ip', 'claim_ip', 'claim_user') or p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$'
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 172800 or p_max is null or p_max < 1 or p_max > 1000 then
    raise exception 'invalid_rate_limit_args';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('smartcard_rate:' || p_kind || ':' || p_subject_hash, 0));
  select count(*) into v_count from ringo_smart_card_rate_events where kind = p_kind and subject_hash = p_subject_hash
     and created_at > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_max then return false; end if;
  insert into ringo_smart_card_rate_events (kind, subject_hash) values (p_kind, p_subject_hash);
  if random() < 0.02 then
    delete from ringo_smart_card_rate_events where id in (select id from ringo_smart_card_rate_events where created_at < now() - interval '2 days' limit 500);
  end if;
  return true;
end $$;

-- Public scan. The token hash IS the capability. null = unknown OR disabled (one indistinguishable answer).
-- unclaimed -> {status, serial};   claimed -> {status, username} where username is the profile's CURRENT username (null if the profile is gone).
create or replace function smartcard_resolve(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_card ringo_smart_cards; v_username text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  update ringo_smart_cards set scan_count = scan_count + 1, last_scanned_at = now()
   where token_hash = p_token_hash and status in ('unclaimed', 'claimed') returning * into v_card;
  if not found then return null; end if;
  if v_card.status = 'unclaimed' then
    return jsonb_build_object('status', 'unclaimed', 'serial', v_card.serial);
  end if;
  select username into v_username from profiles where id = v_card.profile_id;
  return jsonb_build_object('status', 'claimed', 'username', v_username);
end $$;

-- Atomic claim. The row is locked FOR UPDATE, so two simultaneous claims serialise: exactly one sees 'unclaimed'. A claimed card is never moved.
-- The profile must belong to the claiming user (the same rule the NFC Card Writer applies). Results: claimed | already_claimed | unavailable | profile_not_allowed
create or replace function smartcard_claim(p_token_hash text, p_user_id uuid, p_profile_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_card ringo_smart_cards;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_user_id is null or p_profile_id is null then
    return jsonb_build_object('result', 'unavailable');
  end if;
  select * into v_card from ringo_smart_cards where token_hash = p_token_hash for update;
  if not found or v_card.status = 'disabled' then return jsonb_build_object('result', 'unavailable'); end if;
  if v_card.status = 'claimed' then
    -- the same person opening their own claim again is harmless; anyone else is refused, and nothing changes
    if v_card.claimed_by_user_id = p_user_id then return jsonb_build_object('result', 'claimed', 'already', true, 'serial', v_card.serial); end if;
    return jsonb_build_object('result', 'already_claimed');
  end if;
  if not exists (select 1 from profiles where id = p_profile_id and user_id = p_user_id) then
    return jsonb_build_object('result', 'profile_not_allowed');
  end if;
  update ringo_smart_cards set status = 'claimed', claimed_by_user_id = p_user_id, profile_id = p_profile_id, claimed_at = now()
   where id = v_card.id;
  return jsonb_build_object('result', 'claimed', 'already', false, 'serial', v_card.serial);
end $$;

-- Batch import (run by the owner, with the service role, from a private file of HASHES: raw tokens never reach the database).
-- All-or-nothing. A serial or hash that already exists with IDENTICAL data is skipped (re-running is safe); any difference raises and imports nothing.
create or replace function smartcard_import_batch(p_batch text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; v_inserted int := 0; v_skipped int := 0; v_serial text; v_hash text; v_existing ringo_smart_cards;
begin
  if p_batch is null or p_batch !~ '^[a-z0-9][a-z0-9-]{2,39}$' then raise exception 'smartcard_bad_batch'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 1000 then raise exception 'smartcard_bad_rows'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_serial := r ->> 'serial'; v_hash := r ->> 'token_hash';
    if v_serial is null or v_serial !~ '^RINGO-[0-9]{4}$' or v_hash is null or v_hash !~ '^[0-9a-f]{64}$' then raise exception 'smartcard_bad_row'; end if;
    select * into v_existing from ringo_smart_cards where serial = v_serial or token_hash = v_hash limit 1;
    if found then
      if v_existing.serial = v_serial and v_existing.token_hash = v_hash and v_existing.batch = p_batch then v_skipped := v_skipped + 1; continue; end if;
      raise exception 'smartcard_conflict';
    end if;
    insert into ringo_smart_cards (serial, token_hash, batch) values (v_serial, v_hash, p_batch);
    v_inserted := v_inserted + 1;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped, 'batch_total', (select count(*) from ringo_smart_cards where batch = p_batch));
end $$;

-- ---------------------------------------------------------------------------------------------------------------- privileges
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('smartcard_rate_limit_hit', 'smartcard_resolve', 'smartcard_claim', 'smartcard_import_batch', 'ringo_smart_cards_immutable')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('smartcard_rate_limit_hit', 'smartcard_resolve', 'smartcard_claim', 'smartcard_import_batch')
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

alter table ringo_smart_cards enable row level security;
alter table ringo_smart_card_rate_events enable row level security;
revoke all on table ringo_smart_cards from anon, authenticated, service_role;
revoke all on table ringo_smart_card_rate_events from anon, authenticated, service_role;
revoke all on sequence ringo_smart_card_rate_events_id_seq from anon, authenticated, service_role;
-- an owner may read their own claimed cards: non-secret columns only (never token_hash)
grant select (id, serial, status, profile_id, claimed_at, batch, created_at) on ringo_smart_cards to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ringo_smart_cards' and policyname = 'ringo_smart_cards owner read') then
    create policy "ringo_smart_cards owner read" on ringo_smart_cards for select to authenticated using (claimed_by_user_id = auth.uid() or is_admin());
  end if;
end $$;

commit;

-- ROLLBACK (manual; only if nothing has been claimed, or after exporting the claims):
--   drop function if exists smartcard_import_batch(text, jsonb);
--   drop function if exists smartcard_claim(text, uuid, uuid);
--   drop function if exists smartcard_resolve(text);
--   drop function if exists smartcard_rate_limit_hit(text, text, int, int);
--   drop table if exists ringo_smart_cards;
--   drop table if exists ringo_smart_card_rate_events;
--   drop function if exists ringo_smart_cards_immutable();
