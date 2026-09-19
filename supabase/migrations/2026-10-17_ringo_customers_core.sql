-- Ringo customer identity core — purely additive. Touches no existing table,
-- column, constraint, policy, trigger or function. Service-role access only.

create table if not exists public.ringo_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  email text not null check (email = lower(email) and char_length(email) between 3 and 200),
  -- A customer row is created ONLY after the emailed code is confirmed.
  email_verified_at timestamptz not null default now(),
  phone text check (phone is null or char_length(phone) <= 40),
  -- Reserved for a future SMS/WhatsApp provider. Nothing writes it today.
  phone_verified_at timestamptz,
  avatar_url text,
  preferred_language text check (preferred_language in ('en', 'fr')),
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ringo_customers_email_key on public.ringo_customers (email);

create table if not exists public.customer_login_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  code_hash text not null,
  attempts smallint not null default 0 check (attempts >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip_hash text,
  language text check (language in ('en', 'fr')),
  -- What the visitor typed on the Stay Connected form; applied only after verification.
  pending_name text check (pending_name is null or char_length(pending_name) <= 120),
  pending_phone text check (pending_phone is null or char_length(pending_phone) <= 40),
  pending_profile_id uuid references public.profiles(id) on delete cascade,
  pending_marketing_consent boolean not null default false,
  pending_source text check (pending_source is null or char_length(pending_source) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists customer_login_codes_email_idx on public.customer_login_codes (email, created_at desc);
create index if not exists customer_login_codes_ip_idx on public.customer_login_codes (ip_hash, created_at desc) where ip_hash is not null;
-- At most ONE live code per email: issuing a new code must retire the old one first.
create unique index if not exists customer_login_codes_one_live_per_email
  on public.customer_login_codes (email) where consumed_at is null;

create table if not exists public.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  -- SHA-256 of the random cookie token; the raw token is never stored.
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists customer_sessions_customer_idx on public.customer_sessions (customer_id, created_at);
create index if not exists customer_sessions_expires_idx on public.customer_sessions (expires_at);

create table if not exists public.customer_connections (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'disconnected')),
  source text not null default 'ringo_profile' check (char_length(source) <= 40),
  is_favorite boolean not null default false,
  -- Separate from connecting: default OFF, set only by an explicit tick.
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  -- Set only when Connect itself CREATED the community_subscribers row.
  -- A pre-existing legacy row is never linked, merged or modified.
  community_subscriber_id uuid references public.community_subscribers(id) on delete set null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (customer_id, profile_id),
  constraint customer_connections_consent_has_timestamp
    check (marketing_consent = false or marketing_consent_at is not null),
  constraint customer_connections_disconnect_consistent
    check ((status = 'disconnected') = (disconnected_at is not null))
);
create index if not exists customer_connections_profile_idx on public.customer_connections (profile_id, status);
create index if not exists customer_connections_customer_idx on public.customer_connections (customer_id, status);

-- Atomic, brute-force-safe code check. Locks the live code, counts the attempt,
-- compares the hash and consumes the code in one step. Returns 0 rows on any failure.
create or replace function public.customer_verify_login_code(p_email text, p_code_hash text)
returns table (
  out_id uuid,
  out_pending_name text,
  out_pending_phone text,
  out_pending_profile_id uuid,
  out_pending_marketing_consent boolean,
  out_pending_source text,
  out_language text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v public.customer_login_codes%rowtype;
  v_recent_attempts int;
begin
  select c.* into v
  from public.customer_login_codes c
  where c.email = lower(p_email) and c.consumed_at is null and c.expires_at > now()
  order by c.created_at desc
  limit 1
  for update;

  if not found then
    return;
  end if;

  -- Ceiling across ALL codes for this email in the last hour (defeats request-new-code-and-retry).
  select coalesce(sum(c.attempts), 0) into v_recent_attempts
  from public.customer_login_codes c
  where c.email = v.email and c.created_at > now() - interval '1 hour';

  if v.attempts >= 5 or v_recent_attempts >= 10 then
    update public.customer_login_codes u set consumed_at = now() where u.id = v.id;
    return;
  end if;

  if v.code_hash = p_code_hash then
    update public.customer_login_codes u set consumed_at = now() where u.id = v.id;
    return query select v.id, v.pending_name, v.pending_phone, v.pending_profile_id,
                        v.pending_marketing_consent, v.pending_source, v.language;
  else
    update public.customer_login_codes u
       set attempts = u.attempts + 1,
           consumed_at = case when u.attempts + 1 >= 5 then now() else null end
     where u.id = v.id;
  end if;
end;
$$;

revoke all on function public.customer_verify_login_code(text, text) from public, anon, authenticated;
grant execute on function public.customer_verify_login_code(text, text) to service_role;

alter table public.ringo_customers enable row level security;
alter table public.customer_login_codes enable row level security;
alter table public.customer_sessions enable row level security;
alter table public.customer_connections enable row level security;

revoke all on public.ringo_customers, public.customer_login_codes,
  public.customer_sessions, public.customer_connections from anon, authenticated;
grant select, insert, update, delete on public.ringo_customers, public.customer_login_codes,
  public.customer_sessions, public.customer_connections to service_role;
