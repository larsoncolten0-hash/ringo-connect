-- Ringo AI — Phase 1 foundation (owner-only beta, read-only assistant).
-- Run this once in the Supabase SQL editor.
--
-- Purely additive: six NEW tables and one NEW function. Touches no existing
-- table, column, constraint, trigger, policy or function. Deleting every
-- object created here (see supabase/support/2026-10-25_ringo_ai_foundation.rollback.sql)
-- leaves no trace on anything that existed before Ringo AI.
--
-- Access posture:
--   * Every WRITE goes through the server (src/lib/ai/**) with the
--     service-role client, after src/lib/ai/guard.ts has resolved the caller
--     from their own Supabase session. There are deliberately no
--     insert/update policies for `authenticated`.
--   * A creator can SELECT (and DELETE) only their own conversations,
--     messages and feedback. Admins can read everything for support/usage.
--   * ai_settings / ai_beta_access / ai_usage_events are admin-read only.
--
-- Nothing here stores secrets. ai_messages stores only the user's own typed
-- text and Ringo AI's final reply text — never tool results, raw account
-- rows, system prompts or provider payloads.

-- ============================================================================
-- 1. SETTINGS (single row) — kill switch, access mode, model, limits, pricing
-- ============================================================================
create table if not exists public.ai_settings (
  id smallint primary key default 1 check (id = 1),
  -- Global kill switch. Starts OFF: nobody can use Ringo AI until an admin
  -- turns it on from /admin/ai.
  enabled boolean not null default false,
  -- 'allowlist' = only users in ai_beta_access; 'all_owners' = every owner.
  access_mode text not null default 'allowlist' check (access_mode in ('allowlist', 'all_owners')),
  provider text not null default 'anthropic' check (char_length(provider) between 1 and 40),
  model_chat text not null default 'claude-sonnet-5' check (char_length(model_chat) between 1 and 100),
  effort text not null default 'medium' check (effort in ('low', 'medium', 'high')),
  daily_message_limit int not null default 30 check (daily_message_limit between 0 and 1000),
  monthly_user_token_limit bigint not null default 3000000 check (monthly_user_token_limit >= 0),
  monthly_global_budget_usd numeric(10,2) not null default 50 check (monthly_global_budget_usd >= 0),
  max_tool_rounds int not null default 4 check (max_tool_rounds between 0 and 8),
  max_output_tokens int not null default 4096 check (max_output_tokens between 512 and 16000),
  history_message_limit int not null default 12 check (history_message_limit between 2 and 40),
  -- USD per 1M tokens. Admin-editable because provider pricing changes; when
  -- any of these is null, cost is not estimated and the global budget can
  -- only be enforced once pricing is filled in (see src/lib/ai/usage.ts).
  price_input_per_mtok_usd numeric(10,4) check (price_input_per_mtok_usd is null or price_input_per_mtok_usd >= 0),
  price_output_per_mtok_usd numeric(10,4) check (price_output_per_mtok_usd is null or price_output_per_mtok_usd >= 0),
  price_cache_read_per_mtok_usd numeric(10,4) check (price_cache_read_per_mtok_usd is null or price_cache_read_per_mtok_usd >= 0),
  price_cache_write_per_mtok_usd numeric(10,4) check (price_cache_write_per_mtok_usd is null or price_cache_write_per_mtok_usd >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

-- Seeded with Claude Sonnet 5 list pricing as of 2026-09 ($2 in / $10 out,
-- cache reads 0.1x, 5-minute cache writes 1.25x). Editable from /admin/ai.
insert into public.ai_settings (id, price_input_per_mtok_usd, price_output_per_mtok_usd, price_cache_read_per_mtok_usd, price_cache_write_per_mtok_usd)
values (1, 2.0, 10.0, 0.2, 2.5)
on conflict (id) do nothing;

-- ============================================================================
-- 2. BETA ACCESS (allowlist)
-- ============================================================================
create table if not exists public.ai_beta_access (
  user_id uuid primary key references public.users(id) on delete cascade,
  granted_by uuid references public.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  -- Optional per-user override of ai_settings.daily_message_limit.
  daily_message_limit_override int check (daily_message_limit_override is null or daily_message_limit_override between 0 and 1000),
  note text check (note is null or char_length(note) <= 200)
);

-- ============================================================================
-- 3. CONVERSATIONS + MESSAGES
-- ============================================================================
create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  -- The workspace (profile) the conversation was about — always resolved
  -- server-side from the session, never supplied by the client or model.
  profile_id uuid references public.profiles(id) on delete cascade,
  title text check (title is null or char_length(title) <= 120),
  locale text not null default 'fr' check (locale in ('en', 'fr')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 16000),
  -- Names of the read-only tools used to produce an assistant reply (for
  -- admin debugging) — names only, never their results.
  tools_used text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_idx on public.ai_messages (conversation_id, created_at);

-- ============================================================================
-- 4. USAGE EVENTS — one row per chat request (all tool rounds aggregated)
-- ============================================================================
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  -- set null (not cascade) so the global monthly budget still counts spend
  -- after an account or conversation is deleted.
  user_id uuid references public.users(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 100),
  status text not null check (status in ('ok', 'error')),
  error_code text check (error_code is null or char_length(error_code) <= 60),
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cache_read_tokens int not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens int not null default 0 check (cache_write_tokens >= 0),
  tool_rounds smallint not null default 0 check (tool_rounds >= 0),
  tool_calls smallint not null default 0 check (tool_calls >= 0),
  latency_ms int not null default 0 check (latency_ms >= 0),
  -- null when ai_settings pricing isn't configured.
  cost_usd numeric(12,6) check (cost_usd is null or cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_events_user_idx on public.ai_usage_events (user_id, created_at desc);
create index if not exists ai_usage_events_created_idx on public.ai_usage_events (created_at desc);

-- ============================================================================
-- 5. FEEDBACK (thumbs up / down on an assistant reply)
-- ============================================================================
create table if not exists public.ai_feedback (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.ai_messages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rating smallint not null check (rating in (-1, 1)),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (message_id, user_id)
);

-- ============================================================================
-- 6. QUOTA SNAPSHOT — one round trip for the guard's limit checks
-- ============================================================================
-- Service-role only (execute revoked from everyone else below). Counts are
-- deliberately approximate under concurrency (count-then-proceed), the same
-- posture as the existing table-count rate limits (customer_login_codes).
create or replace function public.ai_quota_snapshot(p_user_id uuid)
returns table (user_requests_24h int, user_tokens_month bigint, global_cost_month numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (select count(*)::int from public.ai_usage_events e
      where e.user_id = p_user_id and e.created_at > now() - interval '24 hours'),
    (select coalesce(sum(e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens), 0)::bigint
      from public.ai_usage_events e
      where e.user_id = p_user_id and e.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
    (select coalesce(sum(e.cost_usd), 0)::numeric from public.ai_usage_events e
      where e.created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc');
$$;

revoke all on function public.ai_quota_snapshot(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.ai_quota_snapshot(uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.ai_quota_snapshot(uuid) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.ai_quota_snapshot(uuid) to service_role';
  end if;
end $$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.ai_settings enable row level security;
alter table public.ai_beta_access enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_feedback enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ai_settings' and policyname = 'ai_settings admin read') then
    create policy "ai_settings admin read" on public.ai_settings for select using (is_admin());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'ai_beta_access' and policyname = 'ai_beta_access own or admin read') then
    create policy "ai_beta_access own or admin read" on public.ai_beta_access for select using (user_id = auth.uid() or is_admin());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'ai_conversations' and policyname = 'ai_conversations own or admin read') then
    create policy "ai_conversations own or admin read" on public.ai_conversations for select using (user_id = auth.uid() or is_admin());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ai_conversations' and policyname = 'ai_conversations own delete') then
    create policy "ai_conversations own delete" on public.ai_conversations for delete using (user_id = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'ai_messages' and policyname = 'ai_messages own or admin read') then
    create policy "ai_messages own or admin read" on public.ai_messages for select using (
      is_admin()
      or exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
    );
  end if;

  if not exists (select 1 from pg_policies where tablename = 'ai_usage_events' and policyname = 'ai_usage_events admin read') then
    create policy "ai_usage_events admin read" on public.ai_usage_events for select using (is_admin());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'ai_feedback' and policyname = 'ai_feedback own or admin read') then
    create policy "ai_feedback own or admin read" on public.ai_feedback for select using (user_id = auth.uid() or is_admin());
  end if;
end $$;
