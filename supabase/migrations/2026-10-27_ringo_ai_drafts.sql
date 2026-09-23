-- Ringo AI — Phase 2: controlled drafts (Setup Assistant).
-- Run this once in the Supabase SQL editor, AFTER
-- 2026-10-25_ringo_ai_foundation.sql and 2026-10-26_ringo_ai_quota_reservations.sql.
--
-- Ringo AI may PREPARE a change (a draft); it never applies one. A draft is
-- applied only when the owner clicks "Confirm & Apply" in the Ringo AI panel,
-- which calls POST /api/ai/drafts/[id]/apply. That endpoint re-checks
-- everything and then writes through the owner's OWN Supabase session, so the
-- existing RLS policies and triggers on profiles/products/events stay the
-- authorization boundary exactly as they are for the Dashboard editor.
--
-- Purely additive: two NEW tables, three NEW functions (the claim gate and
-- two owner-invoked apply writes, see section 4), one NEW trigger function
-- (on the new table only). Touches no existing table, column, constraint,
-- trigger, policy or function. Rollback:
-- supabase/support/2026-10-27_ringo_ai_drafts.rollback.sql.
--
-- Access posture (same as the foundation): every write goes through the
-- server (service role) after the server resolved the caller from their own
-- session; there are no insert/update/delete policies for `authenticated`.
-- Owners can read their own drafts and audit rows; admins can read all.
-- Drafts never hold secrets; contact details only when the owner typed them
-- in the conversation (enforced server-side).

-- ============================================================================
-- 1. DRAFTS
-- ============================================================================
create table if not exists public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  -- Always the server-resolved owner and their own profile (the profile IS
  -- the organization in Ringo — organization_members.profile_id).
  user_id uuid not null references public.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Deleting a conversation deletes its drafts (they may hold what the owner
  -- typed); the audit trail below survives.
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  draft_type text not null check (draft_type in ('profile.update', 'product.create', 'event.create')),
  status text not null default 'awaiting_confirmation'
    check (status in ('awaiting_confirmation', 'applying', 'applied', 'failed', 'rejected', 'expired', 'stale')),
  -- Only ever the output of the draft type's server-side validator.
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  -- profile.update: the current values of the fields being changed, captured
  -- when the draft was made; apply refuses (status 'stale') if the profile was
  -- edited since, so an old draft can't overwrite newer manual changes.
  base jsonb check (base is null or (jsonb_typeof(base) = 'object' and pg_column_size(base) <= 16384)),
  -- Built by the server from the payload, never free model text.
  summary text not null check (char_length(summary) between 1 and 300),
  -- Bumped on every update; confirmation must name the revision the owner saw.
  revision int not null default 1 check (revision between 1 and 1000),
  -- The id the created product/event will get. Inserting with this id makes
  -- a retried apply hit the primary key instead of creating a duplicate.
  target_id uuid not null default gen_random_uuid() unique,
  result_id uuid,
  error_code text check (error_code is null or char_length(error_code) <= 60),
  locale text not null default 'fr' check (locale in ('en', 'fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  applied_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index if not exists ai_drafts_conversation_idx on public.ai_drafts (conversation_id, created_at);
create index if not exists ai_drafts_user_idx on public.ai_drafts (user_id, created_at desc);

-- Terminal states are final: an applied, rejected or expired draft can never
-- be changed again (defense in depth against replay, on top of the server's
-- atomic claim). Only guards the NEW table.
create or replace function public.ai_drafts_guard_terminal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('applied', 'rejected', 'expired') then
    raise exception 'ai_drafts: draft % is %, it cannot change', old.id, old.status using errcode = '55000';
  end if;
  if new.user_id <> old.user_id or new.profile_id <> old.profile_id or new.conversation_id <> old.conversation_id
     or new.draft_type <> old.draft_type or new.target_id <> old.target_id then
    raise exception 'ai_drafts: ownership and identity columns are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_ai_drafts_guard_terminal') then
    create trigger trg_ai_drafts_guard_terminal
      before update on public.ai_drafts
      for each row execute function public.ai_drafts_guard_terminal();
  end if;
end $$;

-- ============================================================================
-- 2. AUDIT TRAIL (append-only; survives draft/conversation deletion)
-- ============================================================================
create table if not exists public.ai_draft_events (
  id uuid primary key default gen_random_uuid(),
  -- No FK: the audit row must outlive the draft.
  draft_id uuid not null,
  user_id uuid references public.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  draft_type text not null check (char_length(draft_type) <= 40),
  action text not null check (action in ('created', 'updated', 'discarded', 'apply_started', 'applied', 'apply_failed', 'stale', 'expired')),
  revision int,
  result_id uuid,
  error_code text check (error_code is null or char_length(error_code) <= 60),
  -- Safe metadata only (e.g. the NAMES of changed fields) — never values.
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  created_at timestamptz not null default now()
);
create index if not exists ai_draft_events_draft_idx on public.ai_draft_events (draft_id, created_at);
create index if not exists ai_draft_events_user_idx on public.ai_draft_events (user_id, created_at desc);

-- ============================================================================
-- 3. ATOMIC CLAIM — the single gate every apply goes through
-- ============================================================================
-- Locks the draft row (FOR UPDATE), so concurrent "Confirm & Apply" clicks
-- queue here and exactly one can move it to 'applying'. Scoped by the
-- server-resolved user AND profile, and by the revision the owner confirmed.
-- A draft stuck in 'applying' (server died mid-apply) can be re-claimed after
-- p_stale_after_seconds; that retry is safe because creates reuse target_id.
--
-- outcome: 'claimed' | 'not_found' | 'applied' | 'rejected' | 'expired' |
--          'stale' | 'in_progress' | 'revision_mismatch'
create or replace function public.ai_claim_draft(
  p_draft_id uuid,
  p_user_id uuid,
  p_profile_id uuid,
  p_revision int,
  p_stale_after_seconds int default 120
)
returns table (
  outcome text,
  draft_type text,
  payload jsonb,
  base jsonb,
  target_id uuid,
  result_id uuid,
  revision int
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  d public.ai_drafts%rowtype;
begin
  if p_draft_id is null or p_user_id is null or p_profile_id is null or p_revision is null
     or p_stale_after_seconds is null or p_stale_after_seconds not between 10 and 3600 then
    raise exception 'ai_claim_draft: invalid arguments' using errcode = '22023';
  end if;

  select * into d from public.ai_drafts
   where id = p_draft_id and user_id = p_user_id and profile_id = p_profile_id
   for update;

  if not found then
    return query select 'not_found'::text, null::text, null::jsonb, null::jsonb, null::uuid, null::uuid, null::int;
    return;
  end if;

  if d.status in ('applied', 'rejected', 'expired') then
    return query select d.status, d.draft_type, null::jsonb, null::jsonb, null::uuid, d.result_id, d.revision;
    return;
  end if;

  if d.expires_at <= now() then
    update public.ai_drafts set status = 'expired', updated_at = now() where id = d.id;
    return query select 'expired'::text, d.draft_type, null::jsonb, null::jsonb, null::uuid, null::uuid, d.revision;
    return;
  end if;

  if d.revision <> p_revision then
    return query select 'revision_mismatch'::text, d.draft_type, null::jsonb, null::jsonb, null::uuid, null::uuid, d.revision;
    return;
  end if;

  if d.status = 'stale' then
    return query select 'stale'::text, d.draft_type, null::jsonb, null::jsonb, null::uuid, null::uuid, d.revision;
    return;
  end if;

  if d.status = 'applying' and d.confirmed_at > now() - make_interval(secs => p_stale_after_seconds) then
    return query select 'in_progress'::text, d.draft_type, null::jsonb, null::jsonb, null::uuid, null::uuid, d.revision;
    return;
  end if;

  -- awaiting_confirmation, failed (retry) or an abandoned 'applying'.
  update public.ai_drafts
     set status = 'applying', confirmed_at = now(), error_code = null, updated_at = now()
   where id = d.id;

  return query select 'claimed'::text, d.draft_type, d.payload, d.base, d.target_id, null::uuid, d.revision;
end;
$$;

-- Service-role only: a signed-in user must not be able to claim drafts
-- directly, even their own — only the apply endpoint may.
revoke all on function public.ai_claim_draft(uuid, uuid, uuid, int, int) from public;
revoke all on function public.ai_drafts_guard_terminal() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_claim_draft(uuid, uuid, uuid, int, int) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ai_claim_draft(uuid, uuid, uuid, int, int) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_claim_draft(uuid, uuid, uuid, int, int) to service_role';
  end if;
end $$;

-- ============================================================================
-- 4. APPLY WRITES — atomic, run AS THE OWNER (SECURITY INVOKER)
-- ============================================================================
-- The two writes below are called by the apply endpoint through the owner's
-- OWN session client (role `authenticated`), never the service role. Because
-- they are SECURITY INVOKER, Ringo's existing RLS policies ("products owner
-- write", "profiles update by owner or admin") and triggers (e.g. the
-- demo-flag guard, which keys on current_user) apply exactly as they do for
-- the Dashboard editor. Each additionally requires auth.uid() to be the
-- profile's OWNER (no admin override), so it can only ever do something the
-- caller could already do to their own page with a plain UPDATE/INSERT —
-- narrower, never broader. Neither touches the existing tables' definitions,
-- policies or triggers, and the Dashboard editor doesn't use them.

-- 4a. Product create within the plan's max_products — atomically.
-- The plan limit exists only in the Dashboard UI (Editor.tsx / CatalogCard);
-- a check-then-insert in application code lets two simultaneous AI applies
-- both pass on the last free slot. Here the count and the insert happen in
-- one transaction under a per-profile advisory lock, so concurrent AI product
-- applies for the same page queue and each sees the ones before it:
--   products already on the page + AI creates <= plans.max_products.
-- The lock is transaction-scoped and keyed only to this function + profile;
-- editor inserts don't take it (and aren't slowed by it).
-- outcome: 'inserted' | 'already_exists' (retry: this id is already this
--          page's product) | 'limit_reached' | 'catalog_locked' | 'not_owner'
create or replace function public.ai_create_product_within_limit(
  p_id uuid,
  p_profile_id uuid,
  p_name text,
  p_description text,
  p_price numeric
)
returns table (outcome text, product_id uuid)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owned boolean;
  v_max int;
  v_count int;
begin
  if v_uid is null or p_id is null or p_profile_id is null or p_name is null or btrim(p_name) = '' then
    raise exception 'ai_create_product_within_limit: invalid arguments' using errcode = '22023';
  end if;

  -- Owner only (RLS also applies to every statement below).
  select true, pl.max_products into v_owned, v_max
    from public.profiles p
    join public.users u on u.id = p.user_id
    left join public.plans pl on pl.id = u.plan_id
   where p.id = p_profile_id and p.user_id = v_uid;
  if v_owned is null then
    return query select 'not_owner'::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ringo_ai_product_limit:' || p_profile_id::text, 0));

  -- Idempotent retry: the draft's pre-assigned id already exists on this page.
  if exists (select 1 from public.products where id = p_id and profile_id = p_profile_id) then
    return query select 'already_exists'::text, p_id;
    return;
  end if;

  if v_max = 0 then
    return query select 'catalog_locked'::text, null::uuid;
    return;
  end if;

  -- Counted AFTER taking the lock: includes every product committed so far.
  select count(*)::int into v_count from public.products where profile_id = p_profile_id;
  if v_max is not null and v_count >= v_max then
    return query select 'limit_reached'::text, null::uuid;
    return;
  end if;

  insert into public.products (id, profile_id, name, description, price, available, sort_order)
  values (p_id, p_profile_id, p_name, p_description, p_price, true, v_count);

  return query select 'inserted'::text, p_id;
end;
$$;

-- 4b. Profile update from a draft — compare-and-set, atomically.
-- The draft stored `base` = the values of exactly the columns it changes, as
-- they were when it was prepared. This locks the owner's profile row, then:
--   * every patched column already equals the patch → 'already_applied'
--     (a retry after a successful write);
--   * any base column differs from the row now → 'stale' (someone — e.g.
--     the owner in the Dashboard — changed it since): NOTHING is written;
--   * otherwise updates only the whitelisted columns → 'updated'.
-- The row lock means a concurrent Dashboard save either commits first (then
-- this sees it and refuses) or waits until this commits (then the owner's
-- newer save wins, as it should). Comparison is on jsonb values, so NULLs,
-- empty strings and the categories array compare exactly.
-- Only these columns — the ones the editor cards write — can be changed:
-- name, bio, about_long_bio, about_location, category, categories,
-- music_role, restaurant_subcategory, whatsapp_number, about_phone, about_email.
create or replace function public.ai_apply_profile_update(
  p_profile_id uuid,
  p_patch jsonb,
  p_base jsonb
)
returns text
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_allowed constant text[] := array['name', 'bio', 'about_long_bio', 'about_location', 'category', 'categories',
    'music_role', 'restaurant_subcategory', 'whatsapp_number', 'about_phone', 'about_email'];
  v_row public.profiles%rowtype;
  v_now jsonb;
  k text;
begin
  if v_uid is null or p_profile_id is null
     or p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
     or p_base is null or jsonb_typeof(p_base) <> 'object' then
    raise exception 'ai_apply_profile_update: invalid arguments' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) key where key <> all (v_allowed))
     or exists (select 1 from jsonb_object_keys(p_base) key where key <> all (v_allowed)) then
    raise exception 'ai_apply_profile_update: column not allowed' using errcode = '42501';
  end if;

  select * into v_row from public.profiles where id = p_profile_id and user_id = v_uid for update;
  if not found then
    return 'not_found';
  end if;
  v_now := to_jsonb(v_row);

  if not exists (select 1 from jsonb_object_keys(p_patch) key where (v_now -> key) is distinct from (p_patch -> key)) then
    return 'already_applied';
  end if;

  for k in select jsonb_object_keys(p_base) loop
    if (v_now -> k) is distinct from (p_base -> k) then
      return 'stale';
    end if;
  end loop;

  update public.profiles p
     set name = x.name,
         bio = x.bio,
         about_long_bio = x.about_long_bio,
         about_location = x.about_location,
         category = x.category,
         categories = x.categories,
         music_role = x.music_role,
         restaurant_subcategory = x.restaurant_subcategory,
         whatsapp_number = x.whatsapp_number,
         about_phone = x.about_phone,
         about_email = x.about_email
    from jsonb_populate_record(v_row, p_patch) x
   where p.id = v_row.id and p.user_id = v_uid;
  if not found then
    return 'not_found';
  end if;
  return 'updated';
end;
$$;

-- Callable by the signed-in owner's session (that's the point: RLS applies),
-- never anonymously.
revoke all on function public.ai_create_product_within_limit(uuid, uuid, text, text, numeric) from public;
revoke all on function public.ai_apply_profile_update(uuid, jsonb, jsonb) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_create_product_within_limit(uuid, uuid, text, text, numeric) from anon';
    execute 'revoke all on function public.ai_apply_profile_update(uuid, jsonb, jsonb) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function public.ai_create_product_within_limit(uuid, uuid, text, text, numeric) to authenticated';
    execute 'grant execute on function public.ai_apply_profile_update(uuid, jsonb, jsonb) to authenticated';
  end if;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.ai_drafts enable row level security;
alter table public.ai_draft_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_drafts' and policyname = 'ai_drafts own or admin read') then
    create policy "ai_drafts own or admin read" on public.ai_drafts for select using (user_id = auth.uid() or is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ai_draft_events' and policyname = 'ai_draft_events own or admin read') then
    create policy "ai_draft_events own or admin read" on public.ai_draft_events for select using (user_id = auth.uid() or is_admin());
  end if;
end $$;
