-- Ringo AI Image Generation — full foundation (schema, plan gate, pricing,
-- atomic quota reservations). NOT YET RUN as of this migration's authoring.
--
-- Model note: the default image model below is gpt-image-2.5-flare, verified
-- against BOTH the installed `openai` SDK's type definitions
-- (node_modules/openai/resources/images.d.ts, which lists it as a current
-- ImageGenerateParams.model value) AND current OpenAI documentation, which
-- names gpt-image-2.5-flare and gpt-image-2.5-sunburst as the current
-- production-recommended image models. An earlier draft of this migration
-- defaulted to gpt-image-1, which OpenAI's current documentation flags for
-- shutdown — never actually run, so no live default needed correcting.
--
-- Purely additive: one new column on `plans`, nine new nullable/defaulted
-- columns on `ai_settings`, three new tables, three new functions. Touches
-- no existing column's meaning, no existing row, no existing RLS policy.

-- ============================================================================
-- 1. IMAGE PLAN GATE — mirrors 2026-11-15_ringo_ai_plan_gate.sql exactly,
--    same reasoning: an admin-editable column, never a hardcoded plan name.
-- ============================================================================
alter table plans add column if not exists ai_image_enabled boolean not null default false;

-- Seeds today's business rule: Pro and both Business tiers get image
-- generation; Free and Basic don't (Basic gets text Ringo AI only). Guarded
-- so this never clobbers an admin's own later choice if this migration is
-- ever re-applied; Free/Basic need no statement since the column default
-- (false) already matches the intended state.
update plans set ai_image_enabled = true where name in ('pro', 'business_basic', 'business_pro') and ai_image_enabled = false;

-- ============================================================================
-- 2. AI SETTINGS — image generation fields, additive to the existing single
--    ai_settings row.
-- ============================================================================
-- Default size/quality: 'auto' (the model picks a sensible value itself);
-- both admin-editable afterwards, restricted by app-layer validation
-- (src/lib/ai/settings.ts parseAiSettingsPatch) to the values gpt-image-2.5
-- models document as supported without opting into the priciest xhigh/max
-- quality tiers or arbitrary custom resolutions — a deliberate cost-safety
-- choice, not an API limitation.
alter table ai_settings add column if not exists image_model text not null default 'gpt-image-2.5-flare' check (char_length(image_model) between 1 and 100);
alter table ai_settings add column if not exists image_default_size text not null default 'auto' check (image_default_size in ('auto', '1024x1024', '1536x1024', '1024x1536'));
alter table ai_settings add column if not exists image_default_quality text not null default 'auto' check (image_default_quality in ('auto', 'low', 'medium', 'high'));
alter table ai_settings add column if not exists daily_image_limit int not null default 5 check (daily_image_limit between 0 and 1000);
alter table ai_settings add column if not exists monthly_image_limit int not null default 50 check (monthly_image_limit between 0 and 100000);
alter table ai_settings add column if not exists monthly_global_image_budget_usd numeric(10,2) not null default 25 check (monthly_global_image_budget_usd >= 0);
-- Token-based image pricing (USD per 1M tokens) — GPT image models bill by
-- token, not a flat per-image rate, confirmed against current OpenAI
-- pricing documentation for the gpt-image-2.5 family: text tokens in the
-- prompt, image tokens in the input, and output image tokens each have
-- their own rate. Admin-editable because provider pricing changes; when any
-- of these is null, image cost is not estimated and the image budget can
-- only be enforced once pricing is filled in (see src/lib/ai/imageUsage.ts)
-- — the exact same rule the existing text pricing already follows.
alter table ai_settings add column if not exists image_price_input_text_per_mtok_usd numeric(10,4) check (image_price_input_text_per_mtok_usd is null or image_price_input_text_per_mtok_usd >= 0);
alter table ai_settings add column if not exists image_price_input_image_per_mtok_usd numeric(10,4) check (image_price_input_image_per_mtok_usd is null or image_price_input_image_per_mtok_usd >= 0);
alter table ai_settings add column if not exists image_price_output_per_mtok_usd numeric(10,4) check (image_price_output_per_mtok_usd is null or image_price_output_per_mtok_usd >= 0);

-- Seeds today's published rate for the gpt-image-2.5 family ($5 text-in /
-- $8 image-in / $30 out per 1M tokens, current OpenAI pricing at the time
-- this migration was authored) — admin-editable afterwards from /admin/ai,
-- same as every other price field. Guarded so this never overwrites an
-- admin's own later choice if this migration is ever re-applied.
update ai_settings set
  image_price_input_text_per_mtok_usd = 5.0,
  image_price_input_image_per_mtok_usd = 8.0,
  image_price_output_per_mtok_usd = 30.0
where id = 1
  and image_price_input_text_per_mtok_usd is null
  and image_price_input_image_per_mtok_usd is null
  and image_price_output_per_mtok_usd is null;

-- ============================================================================
-- 3. IMAGE USAGE EVENTS — one row per attempted image-generation call,
--    mirroring ai_usage_events' identity columns and admin-read-only RLS
--    posture exactly (see 2026-10-25_ringo_ai_foundation.sql, section 4)
--    rather than inventing a parallel identity system. Counts
--    image-generation events, never text tokens — entirely independent of
--    ai_usage_events and ai_quota_snapshot().
-- ============================================================================
create table if not exists public.ai_image_usage_events (
  id uuid primary key default gen_random_uuid(),
  -- set null (not cascade), same reasoning as ai_usage_events: the global
  -- monthly budget still counts spend after an account/conversation is deleted.
  user_id uuid references public.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  model text not null check (char_length(model) <= 100),
  size text not null check (char_length(size) <= 20),
  quality text not null check (char_length(quality) <= 20),
  status text not null check (status in ('ok', 'error')),
  error_code text check (error_code is null or char_length(error_code) <= 60),
  -- Token usage, when the provider returned it (see imageUsage.ts) —
  -- retained alongside cost_usd so a later admin pricing correction could
  -- recompute historical cost without re-generating anything.
  input_text_tokens int not null default 0 check (input_text_tokens >= 0),
  input_image_tokens int not null default 0 check (input_image_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  -- null until pricing is configured (see section 2's comment) or the
  -- provider didn't return usage for this call.
  cost_usd numeric(12,6) check (cost_usd is null or cost_usd >= 0),
  -- Path of the stored file in the `uploads` bucket (ai-generated/ prefix).
  storage_path text check (storage_path is null or char_length(storage_path) <= 300),
  -- The OpenAI-reported id for this generation call, when available —
  -- support/debugging only, never displayed to the user.
  provider_request_id text check (provider_request_id is null or char_length(provider_request_id) <= 100),
  created_at timestamptz not null default now()
);
create index if not exists ai_image_usage_events_user_idx on public.ai_image_usage_events (user_id, created_at desc);
create index if not exists ai_image_usage_events_created_idx on public.ai_image_usage_events (created_at desc);

alter table public.ai_image_usage_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_image_usage_events' and policyname = 'ai_image_usage_events admin read') then
    create policy "ai_image_usage_events admin read" on public.ai_image_usage_events for select using (is_admin());
  end if;
end $$;

-- ============================================================================
-- 4. IMAGE QUOTA SNAPSHOT — read-only counterpart to ai_quota_snapshot(),
--    same service-role-only security posture, but counting image-generation
--    ROWS (24h count, month count, month cost), never summed tokens.
-- ============================================================================
create or replace function public.ai_image_quota_snapshot(p_user_id uuid)
returns table (user_images_24h int, user_images_month int, global_image_cost_month numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*)::int from public.ai_image_usage_events e
      where e.user_id = p_user_id and e.created_at > now() - interval '24 hours'),
    (select count(*)::int from public.ai_image_usage_events e
      where e.user_id = p_user_id and e.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
    (select coalesce(sum(e.cost_usd), 0)::numeric from public.ai_image_usage_events e
      where e.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc');
$$;

revoke all on function public.ai_image_quota_snapshot(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_image_quota_snapshot(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ai_image_quota_snapshot(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_image_quota_snapshot(uuid) to service_role';
  end if;
end $$;

-- ============================================================================
-- 5. ATOMIC IMAGE QUOTA RESERVATIONS — mirrors
--    2026-10-26_ringo_ai_quota_reservations.sql exactly (same problem, same
--    fix): the image route checks limits at the start of a request but
--    ai_image_usage_events is only written at the end, so simultaneous
--    requests could all see the same remaining quota. A reservation is
--    counted as "1 image" for the daily/monthly counters (exact — no
--    estimation needed, unlike text's token counts) and an ESTIMATED cost
--    (computed server-side from recent actual usage for the same
--    model/size/quality — never invented; null when no history exists yet,
--    in which case the budget simply isn't enforced for that one
--    reservation, same as when pricing isn't configured at all).
-- ============================================================================
create table if not exists public.ai_image_quota_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  reserved_cost_usd numeric(12,6) check (reserved_cost_usd is null or reserved_cost_usd >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index if not exists ai_image_quota_reservations_user_idx on public.ai_image_quota_reservations (user_id, expires_at);
create index if not exists ai_image_quota_reservations_expires_idx on public.ai_image_quota_reservations (expires_at);

alter table public.ai_image_quota_reservations enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_image_quota_reservations' and policyname = 'ai_image_quota_reservations admin read') then
    create policy "ai_image_quota_reservations admin read" on public.ai_image_quota_reservations for select using (is_admin());
  end if;
end $$;

create or replace function public.ai_reserve_image_quota(
  p_user_id uuid,
  p_daily_limit int,
  p_monthly_limit int,
  p_global_budget_usd numeric,
  p_reserve_cost_usd numeric,
  p_ttl_seconds int
)
returns table (reservation_id uuid, deny_reason text, remaining_today int)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_snap record;
  v_live_requests int;
  v_live_cost numeric;
  v_used_today int;
  v_used_month int;
  v_id uuid;
begin
  if p_user_id is null
     or p_daily_limit is null or p_daily_limit < 0
     or p_monthly_limit is null or p_monthly_limit < 0
     or (p_global_budget_usd is not null and p_global_budget_usd < 0)
     or (p_reserve_cost_usd is not null and p_reserve_cost_usd < 0)
     or p_ttl_seconds is null or p_ttl_seconds not between 1 and 600 then
    raise exception 'ai_reserve_image_quota: invalid arguments' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ringo_ai_image_quota', 0));

  -- Reservations of requests that died without releasing stop counting.
  delete from public.ai_image_quota_reservations where expires_at <= now();

  select * into v_snap from public.ai_image_quota_snapshot(p_user_id);

  select count(*)::int
    into v_live_requests
    from public.ai_image_quota_reservations r
   where r.user_id = p_user_id;

  -- Global cost reservation sum spans every user, matching the global
  -- budget's own scope (not just this caller's).
  select coalesce(sum(r.reserved_cost_usd), 0)::numeric
    into v_live_cost
    from public.ai_image_quota_reservations r;

  v_used_today := coalesce(v_snap.user_images_24h, 0) + v_live_requests;
  v_used_month := coalesce(v_snap.user_images_month, 0) + v_live_requests;

  if v_used_today >= p_daily_limit then
    return query select null::uuid, 'daily_limit'::text, 0;
    return;
  end if;

  if v_used_month >= p_monthly_limit then
    return query select null::uuid, 'monthly_limit'::text, greatest(0, p_daily_limit - v_used_today);
    return;
  end if;

  if p_global_budget_usd is not null and coalesce(v_snap.global_image_cost_month, 0) + v_live_cost >= p_global_budget_usd then
    return query select null::uuid, 'budget_reached'::text, greatest(0, p_daily_limit - v_used_today);
    return;
  end if;

  insert into public.ai_image_quota_reservations (user_id, reserved_cost_usd, expires_at)
  values (p_user_id, p_reserve_cost_usd, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;

  return query select v_id, null::text, greatest(0, p_daily_limit - v_used_today - 1);
end;
$$;

-- Service-role only, like ai_reserve_quota: a signed-in user must not be
-- able to reserve (or probe) quota for an arbitrary user id.
revoke all on function public.ai_reserve_image_quota(uuid, int, int, numeric, numeric, int) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_reserve_image_quota(uuid, int, int, numeric, numeric, int) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ai_reserve_image_quota(uuid, int, int, numeric, numeric, int) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_reserve_image_quota(uuid, int, int, numeric, numeric, int) to service_role';
  end if;
end $$;
