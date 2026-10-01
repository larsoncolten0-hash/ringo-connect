-- Business Toolkit — Phase 1 (Simple Bookkeeping) — PROPOSED, NOT APPLIED. Revision 3 (see docs/business-toolkit-phase1-preflight.md for the history).
--
-- Applied manually in the Supabase SQL editor like every other file in this folder (there is no
-- supabase/config.toml and no CLI-managed history). The date prefix is this repo's own running sequence
-- (latest existing file: 2026-11-30_customer_followups.sql), not a calendar date, so 2026-12-01 is the
-- correct next slot. Run supabase/support/2026-12-01_bookkeeping_foundation.preflight.sql first.
--
-- What it changes
--   NEW   plans.business_toolkit_enabled (boolean, default false) — one new column on an existing table,
--         added only if absent; the seed below runs ONLY in the run that adds the column.
--   NEW   bk_currency_digits(), bk_entries, bk_entry_events, bk_entries_guard(), bk_entry_events_guard(),
--         bk_truncate_guard(), bk_record_entry(), bk_void_entry(), two RLS policies, four triggers.
--   NOTHING else. No existing row, column meaning, trigger, function, policy, price or entitlement is
--   modified. The only existing table touched is `plans` (the column above). Nothing reads or writes the
--   new objects until the application code that uses them is deployed.
--
-- Depends on (all confirmed present in the live database by a read-only probe): tables profiles, users,
-- plans, product_orders, orders, music_orders; functions none (owner-only policy uses auth.uid() directly).
-- No extensions beyond pgcrypto-style gen_random_uuid(), which product_orders already uses.
--
-- Design notes
--   * bk_entries holds ONLY what a merchant records by hand. Sales that already exist as server-verified
--     product_orders are read through at report time, never copied (no trigger on an existing table, no
--     second record to drift). A manual SALE may therefore not point at a product_order (table CHECK +
--     RPC); an expense may.
--   * Money: numeric(14,3) holds 0-, 2- and 3-decimal currencies exactly. A CHECK requires the stored amount
--     to have no more decimals than its currency (bk_currency_digits: XAF/XOF/JPY… 0, KWD/BHD… 3, else 2).
--     The no-silent-rounding guarantee applies to the supported write path, bk_record_entry(), which rejects
--     any input with more than 3 decimals (amount_too_precise) BEFORE the column can round it, and the
--     application route additionally rejects over-precise input for the profile's own currency. A direct
--     INSERT by a privileged role (service_role/owner) that bypasses the function is NOT protected against
--     numeric(14,3) rounding an input with more than 3 decimals; no application code does that. The currency
--     list is kept identical to src/lib/bookkeeping/money.ts by a test. Currency is taken from
--     profiles.currency inside the RPC, never from the client.
--   * Entries are immutable. A correction voids the old entry and inserts a replacement in ONE transaction
--     (replaces_entry_id); every create/replace/void writes an append-only bk_entry_events row. Nothing is
--     deleted (ON DELETE RESTRICT and a DELETE trigger).
--   * Access is OWNER-ONLY for now: RLS read policy = the profile's owner; the RPCs additionally require
--     the actor to be that owner and the owner's plan to have business_toolkit_enabled. Staff permissions
--     ('bookkeeping.view'/'bookkeeping.manage') are deliberately NOT honoured yet; adding them later is a
--     new migration that replaces the policy/RPC checks. Existing sales.view/payments.view/reports.view
--     confer nothing here. A downgrade stops new writes but never deletes or hides-by-deletion history.
--   * Every foreign key is ON DELETE RESTRICT (never SET NULL): SET NULL is an UPDATE, which the immutability and
--     append-only guards would (correctly) reject, so it could only ever fail confusingly.
--   * Demo profiles are refused (the demo cleanup cron deletes auth users; RESTRICT must never block it).
--   * Idempotent to re-run: IF NOT EXISTS / CREATE OR REPLACE / guarded policies; triggers are dropped and
--     recreated only on the new bk_* tables.

begin;

-- ============================================================================
-- 1. PLAN FLAG (same pattern as team_enabled / ai_enabled / commerce_enabled)
-- ============================================================================
-- Seeded ONCE, in the run that creates the column: the two Business plans get it (mirrors team_enabled);
-- Free, Basic, Pro and the Association plans stay false. Admin can change any plan from /admin/plans.
-- Re-running this migration never re-seeds, so it cannot override an admin's later choice.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'plans' and column_name = 'business_toolkit_enabled') then
    alter table plans add column business_toolkit_enabled boolean not null default false;
    update plans set business_toolkit_enabled = true where name in ('business_basic', 'business_pro');
  end if;
end $$;

-- ============================================================================
-- 2. CURRENCY PRECISION
-- ============================================================================
create or replace function bk_currency_digits(p_currency text) returns int
language sql immutable as $$
  select case
    when upper(p_currency) in ('BIF','CLP','DJF','GNF','ISK','JPY','KMF','KRW','PYG','RWF','UGX','UYI','VND','VUV','XAF','XOF','XPF') then 0
    when upper(p_currency) in ('BHD','IQD','JOD','KWD','LYD','OMR','TND') then 3
    else 2 end;
$$;

-- ============================================================================
-- 3. ENTRIES
-- ============================================================================
create table if not exists bk_entries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  kind text not null check (kind in ('sale','other_income','expense','cash_in','cash_out')),
  amount numeric(14,3) not null check (amount > 0 and amount <= 9999999999.999),
  currency text not null check (currency = upper(currency) and char_length(currency) = 3),
  entry_date date not null,
  category text check (category is null or char_length(btrim(category)) between 1 and 60),
  description text check (description is null or char_length(description) <= 500),
  -- false = recorded but money not yet received/paid (credit sale, unpaid bill). Never counted as cash.
  cash_settled boolean not null default true,
  linked_order_type text check (linked_order_type is null or linked_order_type in ('product_order','restaurant_order','music_order')),
  linked_order_id uuid,                       -- polymorphic on purpose; ownership verified in bk_record_entry
  replaces_entry_id uuid references bk_entries(id) on delete restrict,
  client_request_id uuid,
  created_by uuid references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.users(id) on delete restrict,
  void_reason text check (void_reason is null or char_length(btrim(void_reason)) between 1 and 300),
  check (amount = round(amount, bk_currency_digits(currency))),                          -- no silent rounding
  check ((linked_order_type is null) = (linked_order_id is null)),
  check (kind in ('sale','other_income','expense') or cash_settled),
  check ((voided_at is null) = (void_reason is null)),
  check (kind <> 'sale' or linked_order_type is distinct from 'product_order')           -- already auto-counted
);
create index if not exists bk_entries_profile_date_idx on bk_entries (profile_id, entry_date desc, created_at desc);
create unique index if not exists bk_entries_request_idx on bk_entries (profile_id, client_request_id) where client_request_id is not null;
create unique index if not exists bk_entries_one_live_sale_link_idx on bk_entries (profile_id, linked_order_type, linked_order_id)
  where kind = 'sale' and linked_order_id is not null and voided_at is null;

-- ============================================================================
-- 4. AUDIT TRAIL (append-only)
-- ============================================================================
create table if not exists bk_entry_events (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references bk_entries(id) on delete restrict,
  profile_id uuid not null references profiles(id) on delete restrict,
  event_type text not null check (event_type in ('created','voided','replaced')),
  actor_user_id uuid references public.users(id) on delete restrict,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists bk_entry_events_entry_idx on bk_entry_events (entry_id, created_at);
create index if not exists bk_entry_events_profile_idx on bk_entry_events (profile_id, created_at desc);

-- ============================================================================
-- 5. INTEGRITY GUARDS (fire for every writer, including the service role)
-- ============================================================================
create or replace function bk_entries_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'bk_entries: financial records are never deleted; void the entry instead';
  end if;
  if new.id <> old.id or new.profile_id <> old.profile_id or new.kind <> old.kind or new.amount <> old.amount
     or new.currency <> old.currency or new.entry_date <> old.entry_date
     or new.category is distinct from old.category or new.description is distinct from old.description
     or new.cash_settled <> old.cash_settled
     or new.linked_order_type is distinct from old.linked_order_type or new.linked_order_id is distinct from old.linked_order_id
     or new.replaces_entry_id is distinct from old.replaces_entry_id
     or new.client_request_id is distinct from old.client_request_id
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'bk_entries: entries are immutable; only voiding is allowed';
  end if;
  if old.voided_at is not null then
    raise exception 'bk_entries: entry already voided';
  end if;
  return new;
end $$;
drop trigger if exists bk_entries_guard_trg on bk_entries;
create trigger bk_entries_guard_trg before update or delete on bk_entries
  for each row execute function bk_entries_guard();

create or replace function bk_entry_events_guard() returns trigger language plpgsql as $$
begin
  raise exception 'bk_entry_events is append-only';
end $$;
drop trigger if exists bk_entry_events_guard_trg on bk_entry_events;
create trigger bk_entry_events_guard_trg before update or delete on bk_entry_events
  for each row execute function bk_entry_events_guard();

-- TRUNCATE does not fire row triggers, so it gets its own statement-level guard (fires for every role, including
-- the table owner and for TRUNCATE ... CASCADE reaching these tables from elsewhere).
create or replace function bk_truncate_guard() returns trigger language plpgsql as $$
begin
  raise exception '% : financial records are never truncated', tg_table_name;
end $$;
drop trigger if exists bk_entries_truncate_guard_trg on bk_entries;
create trigger bk_entries_truncate_guard_trg before truncate on bk_entries
  for each statement execute function bk_truncate_guard();
drop trigger if exists bk_entry_events_truncate_guard_trg on bk_entry_events;
create trigger bk_entry_events_truncate_guard_trg before truncate on bk_entry_events
  for each statement execute function bk_truncate_guard();

-- ============================================================================
-- 6. RPC: record an entry (optionally replacing one) — single transaction, idempotent
-- ============================================================================
create or replace function bk_record_entry(
  p_profile_id uuid, p_actor_user_id uuid, p_kind text, p_amount numeric, p_entry_date date,
  p_category text, p_description text, p_cash_settled boolean,
  p_linked_order_type text, p_linked_order_id uuid, p_replaces_entry_id uuid, p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile record; v_enabled boolean; v_existing bk_entries; v_old bk_entries; v_new bk_entries; v_owns boolean;
  v_currency text;
begin
  select p.user_id, p.is_demo, upper(coalesce(nullif(btrim(p.currency), ''), 'XAF')) as currency
    into v_profile from profiles p where p.id = p_profile_id;
  if not found then raise exception 'profile_unavailable'; end if;
  if v_profile.is_demo is true then raise exception 'demo_profile_not_supported'; end if;
  -- OWNER-ONLY (first increment): the actor must be the profile's owner. Staff are not honoured yet.
  if p_actor_user_id is null or v_profile.user_id is distinct from p_actor_user_id then raise exception 'not_owner'; end if;
  -- Plan gate (defence in depth behind the route): the owner's plan must have the toolkit.
  select coalesce(pl.business_toolkit_enabled, false) into v_enabled
    from users u left join plans pl on pl.id = u.plan_id where u.id = v_profile.user_id;
  if v_enabled is not true then raise exception 'toolkit_not_enabled'; end if;
  -- exact-decimal guard: numeric(14,3) would otherwise ROUND a longer input (10.5004 -> 10.500) before the
  -- per-currency scale CHECK runs, so a direct caller could record a value the merchant never entered.
  if p_amount is null then raise exception 'invalid_amount'; end if;
  if p_amount <> round(p_amount, 3) then raise exception 'amount_too_precise'; end if;
  v_currency := v_profile.currency;

  -- idempotent retry: same request id for the same business returns the original entry unchanged. The
  -- advisory lock serialises concurrent submissions of the SAME request, so the loser waits, then finds the
  -- winner's row here instead of failing on the unique index.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_profile_id::text || ':' || p_client_request_id::text, 0));
    select * into v_existing from bk_entries where profile_id = p_profile_id and client_request_id = p_client_request_id;
    if found then return jsonb_build_object('entry', to_jsonb(v_existing), 'duplicate', true); end if;
  end if;

  if p_entry_date > (now() at time zone 'Africa/Douala')::date then raise exception 'date_in_future'; end if;

  if p_linked_order_id is not null then
    if p_kind = 'sale' and p_linked_order_type = 'product_order' then raise exception 'order_already_counted'; end if;
    -- ownership of the linked order is verified here, never trusted from the client
    v_owns := case p_linked_order_type
      when 'product_order'    then exists (select 1 from product_orders where id = p_linked_order_id and profile_id = p_profile_id)
      when 'restaurant_order' then exists (select 1 from orders where id = p_linked_order_id and profile_id = p_profile_id)
      when 'music_order'      then exists (select 1 from music_orders where id = p_linked_order_id and profile_id = p_profile_id)
      else false end;
    if not v_owns then raise exception 'linked_order_not_found'; end if;
    -- a second live manual sale for the same order is refused cleanly (the unique index is the backstop)
    if p_kind = 'sale' and exists (select 1 from bk_entries where profile_id = p_profile_id and kind = 'sale'
        and linked_order_type = p_linked_order_type and linked_order_id = p_linked_order_id and voided_at is null
        and id is distinct from p_replaces_entry_id) then
      raise exception 'order_already_counted';
    end if;
  end if;

  if p_replaces_entry_id is not null then
    select * into v_old from bk_entries where id = p_replaces_entry_id for update;
    if not found or v_old.profile_id <> p_profile_id then raise exception 'entry_not_found'; end if;
    if v_old.voided_at is not null then raise exception 'entry_already_voided'; end if;
    update bk_entries set voided_at = now(), voided_by = p_actor_user_id, void_reason = 'Replaced by a correction'
     where id = v_old.id;
  end if;

  insert into bk_entries (profile_id, kind, amount, currency, entry_date, category, description, cash_settled,
                          linked_order_type, linked_order_id, replaces_entry_id, client_request_id, created_by)
  values (p_profile_id, p_kind, p_amount, v_currency, p_entry_date, nullif(btrim(coalesce(p_category, '')), ''),
          nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_cash_settled, true),
          p_linked_order_type, p_linked_order_id, p_replaces_entry_id, p_client_request_id, p_actor_user_id)
  returning * into v_new;

  insert into bk_entry_events (entry_id, profile_id, event_type, actor_user_id, details)
  values (v_new.id, p_profile_id, 'created', p_actor_user_id,
          jsonb_build_object('kind', v_new.kind, 'amount', v_new.amount, 'currency', v_new.currency, 'entry_date', v_new.entry_date));
  if v_old.id is not null then
    insert into bk_entry_events (entry_id, profile_id, event_type, actor_user_id, details)
    values (v_old.id, p_profile_id, 'replaced', p_actor_user_id,
            jsonb_build_object('replaced_by', v_new.id, 'old_amount', v_old.amount, 'new_amount', v_new.amount));
  end if;
  return jsonb_build_object('entry', to_jsonb(v_new), 'duplicate', false);
end $$;

-- ============================================================================
-- 7. RPC: void an entry (idempotent — a second call reports already_voided, changes nothing)
-- ============================================================================
create or replace function bk_void_entry(p_profile_id uuid, p_actor_user_id uuid, p_entry_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_entry bk_entries; v_owner uuid; v_enabled boolean;
begin
  if p_reason is null or char_length(btrim(p_reason)) = 0 then raise exception 'reason_required'; end if;
  select user_id into v_owner from profiles where id = p_profile_id;
  if v_owner is null or p_actor_user_id is null or v_owner <> p_actor_user_id then raise exception 'not_owner'; end if;
  select coalesce(pl.business_toolkit_enabled, false) into v_enabled
    from users u left join plans pl on pl.id = u.plan_id where u.id = v_owner;
  if v_enabled is not true then raise exception 'toolkit_not_enabled'; end if;
  select * into v_entry from bk_entries where id = p_entry_id for update;
  if not found or v_entry.profile_id <> p_profile_id then raise exception 'entry_not_found'; end if;
  if v_entry.voided_at is not null then
    return jsonb_build_object('entry', to_jsonb(v_entry), 'already_voided', true);
  end if;
  update bk_entries set voided_at = now(), voided_by = p_actor_user_id, void_reason = left(btrim(p_reason), 300)
   where id = p_entry_id returning * into v_entry;
  insert into bk_entry_events (entry_id, profile_id, event_type, actor_user_id, details)
  values (v_entry.id, p_profile_id, 'voided', p_actor_user_id, jsonb_build_object('reason', v_entry.void_reason));
  return jsonb_build_object('entry', to_jsonb(v_entry), 'already_voided', false);
end $$;

-- Server-only: the trusted route (service role) calls these after authorising the caller.
revoke all on function bk_record_entry(uuid, uuid, text, numeric, date, text, text, boolean, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function bk_void_entry(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function bk_record_entry(uuid, uuid, text, numeric, date, text, text, boolean, text, uuid, uuid, uuid) to service_role;
grant execute on function bk_void_entry(uuid, uuid, uuid, text) to service_role;

-- ============================================================================
-- 8. ROW LEVEL SECURITY — OWNER read-only; all writes via the RPCs above
-- ============================================================================
alter table bk_entries enable row level security;
alter table bk_entry_events enable row level security;

-- Supabase's default privileges grant ALL (including TRUNCATE) on every new public table to anon, authenticated
-- and service_role, so service_role is revoked too and then given back only what the RPCs need.
revoke all on bk_entries, bk_entry_events from anon, authenticated, service_role;
grant select, insert, update, delete on bk_entries, bk_entry_events to service_role;
grant select on bk_entries, bk_entry_events to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'bk_entries' and policyname = 'bk_entries owner read') then
    create policy "bk_entries owner read" on bk_entries for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'bk_entry_events' and policyname = 'bk_entry_events owner read') then
    create policy "bk_entry_events owner read" on bk_entry_events for select to authenticated
      using (exists (select 1 from profiles p where p.id = profile_id and p.user_id = auth.uid()));
  end if;
end $$;

commit;

-- ============================================================================
-- ROLLBACK (documented only; NOT part of the migration). Touches ONLY objects this migration created.
-- Every statement is name-exact; none uses CASCADE, so it cannot drop anything that depends on an object
-- it does not name. Safe only while bk_entries / bk_entry_events hold no real data, because dropping them
-- deletes the merchant's bookkeeping history — export first if they do. Dropping the plans column is the
-- only statement that touches an existing table; run it only if no code deployed after this migration
-- still selects business_toolkit_enabled.
-- ============================================================================
--   begin;
--   drop function if exists bk_void_entry(uuid, uuid, uuid, text);
--   drop function if exists bk_record_entry(uuid, uuid, text, numeric, date, text, text, boolean, text, uuid, uuid, uuid);
--   drop table if exists bk_entry_events;       -- also drops its own trigger and policy
--   drop table if exists bk_entries;            -- also drops its own trigger, policy and indexes
--   drop function if exists bk_entry_events_guard();
--   drop function if exists bk_entries_guard();
--   drop function if exists bk_truncate_guard();
--   drop function if exists bk_currency_digits(text);   -- after bk_entries (its CHECK uses it)
--   alter table plans drop column if exists business_toolkit_enabled;
--   commit;
