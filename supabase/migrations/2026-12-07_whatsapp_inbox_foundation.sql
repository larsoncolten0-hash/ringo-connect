-- WhatsApp Inbox foundation (Phase 4) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- SCHEMA ONLY. Purely additive: six NEW tables, their guard triggers, one helper and two server-side RPCs.
--   NEW   wa_accounts, inbox_contacts, inbox_conversations, inbox_messages, inbox_message_media, inbox_status_events,
--         inbox_status_rank(), six *_guard() trigger functions, inbox_ingest_whatsapp_message(), inbox_ingest_whatsapp_status(),
--         one owner-read RLS policy per table.
--   NO    existing table, column, constraint, trigger, function, policy or row is modified. profiles, users, bk_customers and
--         plans are only REFERENCED (foreign keys); dropping every object below leaves no trace on anything that existed before.
--   NO    data. In particular NO wa_accounts row is inserted: the production WhatsApp number (its Meta phone number id and
--         WABA id) belongs to the Ringo-owned platform profile, whose id must be supplied in a separate, explicitly approved
--         production data step (a plain INSERT run as the database owner in the SQL editor). No production identifier
--         appears anywhere in this file.
--
-- OWNERSHIP:  Meta phone number -> wa_accounts -> profiles (owner) -> inbox_conversations -> inbox_contacts -> inbox_messages.
-- Every table carries profile_id, and tenant integrity between tables is enforced with COMPOSITE foreign keys
-- (profile_id, x_id) -> parent (profile_id, id), so a row can never point at another profile's parent.
--
-- ACCESS:  Owner-read only (profiles.user_id = auth.uid()), exactly the bk_customers "owner read" policy shape. Each policy reads
-- ONLY `profiles` (publicly selectable), never an inbox table, so no policy can recurse. No INSERT/UPDATE/DELETE policy and no
-- write grant exists for anon, authenticated or service_role: every write goes through the two SECURITY DEFINER RPCs below,
-- executable by service_role only. Same posture as 2026-12-03_debtors_reminders.sql. Staff/team access and plan gating are
-- deliberately NOT part of this phase.
--
-- IDEMPOTENCY (database-level, the final protection against duplicate webhook delivery):
--   inbound message  msg:<wamid>               -> UNIQUE (channel, provider_message_id) WHERE provider_message_id IS NOT NULL
--   status event     status:<wamid>:<status>   -> UNIQUE (channel, provider_message_id, status)
--   one thread       account + contact         -> UNIQUE (account_id, contact_id)
--   one contact      profile + channel + wa_id -> UNIQUE (profile_id, channel, external_id)
--   outbound client retry (future)             -> UNIQUE (profile_id, client_request_id) WHERE client_request_id IS NOT NULL
-- The RPCs use INSERT ... ON CONFLICT, never check-then-insert, and run in one transaction: any failure rolls back everything,
-- so the webhook can answer 5xx and Meta's retry is safe.
--
-- STATUS RULE (inbox_messages.status is the CURRENT status; inbox_status_events is the append-only HISTORY):
--   rank  queued 0 < sent 1 < failed 2 < delivered 3 < read 4.
--   An event moves the current status only to a HIGHER rank, and only for an outbound message. So: failed never overwrites
--   delivered/read; sent never overwrites failed/delivered/read; delivered/read DO overwrite failed (a later success wins);
--   duplicates and out-of-order arrivals change nothing. 'deleted' and 'unknown' are recorded in history only.
--   Every event is stored independently regardless of order.
--
-- DELETE BEHAVIOUR: everything cascades from the owning profile. inbox_contacts -> bk_customers is a one-way optional link
-- (ON DELETE RESTRICT on the bk side): deleting inbox data never deletes or modifies a bookkeeping customer. Nothing here
-- creates, merges or edits bk_customers rows.
--
-- Depends on: profiles(id, user_id), public.users(id), bk_customers UNIQUE (profile_id, id), gen_random_uuid().
-- Rollback: supabase/support/2026-12-07_whatsapp_inbox_foundation.rollback.sql (DESTROYS all Phase 4 inbox data).

begin;

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- Which Meta phone number belongs to which Ringo profile. No tokens, no secrets (those stay in environment variables).
create table if not exists public.wa_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  phone_number_id text not null check (phone_number_id ~ '^[0-9]{5,32}$'),
  waba_id text not null check (waba_id ~ '^[0-9]{5,32}$'),
  display_phone text check (display_phone is null or char_length(display_phone) <= 40),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (phone_number_id),
  unique (profile_id, id)                      -- composite-FK target; its leading profile_id column also serves "accounts of a profile"
);

-- An external messaging identity (for WhatsApp: the Meta wa_id) inside one profile.
create table if not exists public.inbox_contacts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('whatsapp')),
  external_id text not null check (char_length(external_id) between 1 and 64),
  display_name text check (display_name is null or char_length(display_name) <= 120),
  -- Optional, manual, one-way link to the business's own customer book. Never created or merged automatically.
  bk_customer_id uuid,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, channel, external_id),   -- identity lookup for the webhook
  unique (profile_id, id),                     -- composite-FK target
  foreign key (profile_id, bk_customer_id) references public.bk_customers (profile_id, id) on delete restrict
);

-- One rolling thread per business number + contact (closing/reopening toggles status; a new thread is never created).
create table if not exists public.inbox_conversations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('whatsapp')),
  account_id uuid not null,
  contact_id uuid not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,                 -- basis for the future 24-hour customer-service-window check
  last_outbound_at timestamptz,
  assigned_to_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, contact_id),             -- one thread; also the lookup index for "conversation of this contact"
  unique (profile_id, id),                     -- composite-FK target
  foreign key (profile_id, account_id) references public.wa_accounts (profile_id, id) on delete cascade,
  foreign key (profile_id, contact_id) references public.inbox_contacts (profile_id, id) on delete cascade
);
-- Inbox list: a profile's open/closed conversations, newest activity first.
create index if not exists inbox_conversations_list_idx on public.inbox_conversations (profile_id, status, last_message_at desc, id);

create table if not exists public.inbox_messages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  conversation_id uuid not null,
  channel text not null check (channel in ('whatsapp')),
  direction text not null check (direction in ('inbound', 'outbound')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) between 1 and 256),   -- the wamid; null only for a queued outbound
  type text not null default 'text' check (type ~ '^[a-z_]{1,32}$'),
  body text check (body is null or char_length(body) <= 4096),
  reply_to_provider_message_id text check (reply_to_provider_message_id is null or char_length(reply_to_provider_message_id) <= 256),
  provider_timestamp timestamptz,              -- as reported by Meta; may be absent
  received_at timestamptz not null default now(),
  -- CURRENT status only. History lives in inbox_status_events.
  status text not null check (status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed')),
  status_updated_at timestamptz not null default now(),
  error_codes integer[] not null default '{}' check (cardinality(error_codes) <= 20),
  sent_by_user_id uuid references public.users(id) on delete set null,
  client_request_id uuid,                      -- future outbound idempotency
  created_at timestamptz not null default now(),
  unique (profile_id, id),                     -- composite-FK target (media, status events)
  foreign key (profile_id, conversation_id) references public.inbox_conversations (profile_id, id) on delete cascade,
  -- Inbound rows are always 'received', always carry the wamid, and never carry outbound-only fields; outbound rows never say 'received'.
  check (direction = 'outbound' or (status = 'received' and provider_message_id is not null and client_request_id is null and sent_by_user_id is null)),
  check (direction = 'inbound' or status <> 'received')
);
-- Duplicate protection for provider messages (partial: an outbound message has no wamid until Meta accepts it). Also the wamid lookup index.
create unique index if not exists inbox_messages_provider_idx on public.inbox_messages (channel, provider_message_id) where provider_message_id is not null;
-- Duplicate protection for outbound client retries (future).
create unique index if not exists inbox_messages_request_idx on public.inbox_messages (profile_id, client_request_id) where client_request_id is not null;
-- A conversation's thread, in provider-time order (falls back to arrival time when Meta sent no timestamp).
create index if not exists inbox_messages_thread_idx on public.inbox_messages (conversation_id, (coalesce(provider_timestamp, received_at)) desc, id desc);

-- One media reference per message. Metadata only: no download, no storage bucket, no media URL.
create table if not exists public.inbox_message_media (
  message_id uuid primary key,
  profile_id uuid not null,
  kind text not null check (kind in ('image', 'audio', 'video', 'document', 'sticker')),
  media_id text not null check (char_length(media_id) between 1 and 256),
  mime_type text check (mime_type is null or char_length(mime_type) <= 128),
  sha256 text check (sha256 is null or char_length(sha256) <= 128),
  filename text check (filename is null or char_length(filename) <= 255),
  caption text check (caption is null or char_length(caption) <= 1024),
  storage_status text not null default 'not_downloaded' check (storage_status in ('not_downloaded', 'stored', 'failed')),
  storage_ref text check (storage_ref is null or char_length(storage_ref) <= 512),     -- future Ringo storage reference
  created_at timestamptz not null default now(),
  check (storage_ref is null or storage_status = 'stored'),
  foreign key (profile_id, message_id) references public.inbox_messages (profile_id, id) on delete cascade
);

-- Append-only provider status history. message_id is nullable: a status may arrive before (or without) its message row.
create table if not exists public.inbox_status_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  channel text not null check (channel in ('whatsapp')),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 256),
  message_id uuid,
  status text not null check (status in ('sent', 'delivered', 'read', 'failed', 'deleted', 'unknown')),
  provider_timestamp timestamptz,
  error_codes integer[] not null default '{}' check (cardinality(error_codes) <= 20),
  received_at timestamptz not null default now(),
  unique (channel, provider_message_id, status),  -- = status:<wamid>:<status>; also the lookup index for "history of this wamid"
  foreign key (profile_id, message_id) references public.inbox_messages (profile_id, id) on delete cascade
);
-- Backfill/lookup of the events attached to one message. Partial: unattached events have no message to look up.
create index if not exists inbox_status_events_message_idx on public.inbox_status_events (message_id) where message_id is not null;

-- ============================================================================
-- 2. GUARD TRIGGERS (per-table, same convention as bk_customers_guard): identity columns are immutable; updated_at is maintained.
--    Message BODY is deliberately not frozen, so a future privacy phase is not blocked by this migration.
-- ============================================================================
create or replace function public.wa_accounts_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.profile_id <> old.profile_id or new.phone_number_id <> old.phone_number_id or new.created_at <> old.created_at then
    raise exception 'wa_accounts: identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists wa_accounts_guard_trg on public.wa_accounts;
create trigger wa_accounts_guard_trg before update on public.wa_accounts for each row execute function public.wa_accounts_guard();

create or replace function public.inbox_contacts_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.profile_id <> old.profile_id or new.channel <> old.channel or new.external_id <> old.external_id or new.created_at <> old.created_at then
    raise exception 'inbox_contacts: identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists inbox_contacts_guard_trg on public.inbox_contacts;
create trigger inbox_contacts_guard_trg before update on public.inbox_contacts for each row execute function public.inbox_contacts_guard();

create or replace function public.inbox_conversations_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.profile_id <> old.profile_id or new.channel <> old.channel or new.account_id <> old.account_id
     or new.contact_id <> old.contact_id or new.created_at <> old.created_at then
    raise exception 'inbox_conversations: identity columns are immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists inbox_conversations_guard_trg on public.inbox_conversations;
create trigger inbox_conversations_guard_trg before update on public.inbox_conversations for each row execute function public.inbox_conversations_guard();

-- provider_message_id may be set once (an outbound message gets its wamid after Meta accepts it) but never changed.
create or replace function public.inbox_messages_guard() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.profile_id <> old.profile_id or new.conversation_id <> old.conversation_id or new.channel <> old.channel
     or new.direction <> old.direction or new.created_at <> old.created_at or new.client_request_id is distinct from old.client_request_id
     or (old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id) then
    raise exception 'inbox_messages: identity columns are immutable';
  end if;
  return new;
end $$;
drop trigger if exists inbox_messages_guard_trg on public.inbox_messages;
create trigger inbox_messages_guard_trg before update on public.inbox_messages for each row execute function public.inbox_messages_guard();

create or replace function public.inbox_message_media_guard() returns trigger language plpgsql as $$
begin
  if new.message_id <> old.message_id or new.profile_id <> old.profile_id or new.kind <> old.kind or new.media_id <> old.media_id or new.created_at <> old.created_at then
    raise exception 'inbox_message_media: identity columns are immutable';
  end if;
  return new;
end $$;
drop trigger if exists inbox_message_media_guard_trg on public.inbox_message_media;
create trigger inbox_message_media_guard_trg before update on public.inbox_message_media for each row execute function public.inbox_message_media_guard();

-- Append-only: the only permitted change is attaching a previously unattached event to its message. (DELETE is not blocked: rows go
-- away only through the profile/message cascade.)
create or replace function public.inbox_status_events_guard() returns trigger language plpgsql as $$
begin
  if old.message_id is not null or new.message_id is null
     or (to_jsonb(new) - 'message_id') is distinct from (to_jsonb(old) - 'message_id') then
    raise exception 'inbox_status_events: status history is append-only';
  end if;
  return new;
end $$;
drop trigger if exists inbox_status_events_guard_trg on public.inbox_status_events;
create trigger inbox_status_events_guard_trg before update on public.inbox_status_events for each row execute function public.inbox_status_events_guard();

-- ============================================================================
-- 3. STATUS RANK (pure; see the STATUS RULE above)
-- ============================================================================
create or replace function public.inbox_status_rank(p_status text) returns integer
language sql immutable as $$
  select case p_status when 'queued' then 0 when 'sent' then 1 when 'failed' then 2 when 'delivered' then 3 when 'read' then 4 end
$$;

-- ============================================================================
-- 4. RPC: ingest one normalized inbound WhatsApp message (Phase 3 InboundMessageEvent). Atomic and idempotent.
--    The owner is ALWAYS derived from wa_accounts via the phone_number_id; there is no profile parameter to trust.
--    Returns (never raises for a bad payload, so a poison event cannot be retried forever):
--      'created' | 'duplicate' | 'unknown_account' | 'account_disabled' | 'waba_mismatch' | 'invalid'
--    A raised exception means a real fault (database error): the caller must answer 5xx so Meta retries.
-- ============================================================================
create or replace function public.inbox_ingest_whatsapp_message(
  p_phone_number_id text, p_waba_id text, p_message_id text, p_from text, p_timestamp timestamptz,
  p_type text, p_text text, p_contact_name text, p_reply_to_message_id text,
  p_media_kind text, p_media_id text, p_media_mime_type text, p_media_sha256 text, p_media_filename text, p_media_caption text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acct public.wa_accounts%rowtype;
  v_phone text := nullif(btrim(p_phone_number_id), '');
  v_wamid text := nullif(btrim(p_message_id), '');
  v_from text := nullif(btrim(p_from), '');
  v_ts timestamptz := least(coalesce(p_timestamp, now()), now());   -- never in the future
  v_type text := case when p_type ~ '^[a-z_]{1,32}$' then p_type else 'unsupported' end;
  v_name text := nullif(btrim(left(coalesce(p_contact_name, ''), 120)), '');
  v_contact uuid;
  v_conv uuid;
  v_msg uuid;
begin
  if v_phone is null or v_wamid is null or v_from is null or char_length(v_wamid) > 256 or char_length(v_from) > 64 then
    return 'invalid';
  end if;

  select * into v_acct from public.wa_accounts a where a.phone_number_id = v_phone;
  if not found then return 'unknown_account'; end if;
  if v_acct.status <> 'active' then return 'account_disabled'; end if;
  if nullif(btrim(p_waba_id), '') is not null and btrim(p_waba_id) <> v_acct.waba_id then return 'waba_mismatch'; end if;

  -- Fast path only (saves the upserts on an obvious redelivery). Correctness does NOT depend on it: the unique index below decides.
  if exists (select 1 from public.inbox_messages m where m.channel = 'whatsapp' and m.provider_message_id = v_wamid) then
    return 'duplicate';
  end if;

  insert into public.inbox_contacts as c (profile_id, channel, external_id, display_name, first_seen_at, last_seen_at)
  values (v_acct.profile_id, 'whatsapp', v_from, v_name, v_ts, v_ts)
  on conflict (profile_id, channel, external_id) do update
    set last_seen_at = greatest(c.last_seen_at, excluded.last_seen_at),
        first_seen_at = least(c.first_seen_at, excluded.first_seen_at),
        display_name = coalesce(excluded.display_name, c.display_name)
  returning c.id into v_contact;

  insert into public.inbox_conversations (profile_id, channel, account_id, contact_id, last_message_at)
  values (v_acct.profile_id, 'whatsapp', v_acct.id, v_contact, v_ts)
  on conflict (account_id, contact_id) do nothing
  returning id into v_conv;
  if v_conv is null then   -- a concurrent/earlier insert won: its row is visible to this fresh statement
    select cv.id into v_conv from public.inbox_conversations cv where cv.account_id = v_acct.id and cv.contact_id = v_contact;
  end if;

  insert into public.inbox_messages (profile_id, conversation_id, channel, direction, provider_message_id, type, body,
                                     reply_to_provider_message_id, provider_timestamp, status)
  values (v_acct.profile_id, v_conv, 'whatsapp', 'inbound', v_wamid, v_type, left(p_text, 4096),
          left(nullif(btrim(p_reply_to_message_id), ''), 256), p_timestamp, 'received')
  on conflict (channel, provider_message_id) where provider_message_id is not null do nothing
  returning id into v_msg;
  if v_msg is null then return 'duplicate'; end if;   -- lost the race: nothing else is touched, counters are not bumped

  if p_media_kind in ('image', 'audio', 'video', 'document', 'sticker') and nullif(btrim(p_media_id), '') is not null then
    insert into public.inbox_message_media (message_id, profile_id, kind, media_id, mime_type, sha256, filename, caption)
    values (v_msg, v_acct.profile_id, p_media_kind, left(btrim(p_media_id), 256), left(p_media_mime_type, 128), left(p_media_sha256, 128),
            left(p_media_filename, 255), left(p_media_caption, 1024));
  end if;

  update public.inbox_conversations cv
     set unread_count = cv.unread_count + 1,
         last_message_at = greatest(cv.last_message_at, v_ts),
         last_inbound_at = greatest(coalesce(cv.last_inbound_at, v_ts), v_ts),
         status = 'open'                                  -- a new inbound message reopens a closed thread
   where cv.id = v_conv;

  return 'created';
end;
$$;

-- ============================================================================
-- 5. RPC: ingest one normalized WhatsApp status event (Phase 3 StatusEvent). Atomic and idempotent. Same return contract as above.
--    Order-independent: the event is always stored; the message's current status only moves up the rank (see STATUS RULE).
--    A status for a message that does not exist yet is stored unattached (message_id null); the future outbound "message accepted"
--    step attaches it (the guard allows exactly that update) and recomputes the current status from the history.
-- ============================================================================
create or replace function public.inbox_ingest_whatsapp_status(
  p_phone_number_id text, p_waba_id text, p_message_id text, p_status text, p_timestamp timestamptz, p_error_codes integer[])
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acct public.wa_accounts%rowtype;
  v_phone text := nullif(btrim(p_phone_number_id), '');
  v_wamid text := nullif(btrim(p_message_id), '');
  v_codes integer[] := coalesce(p_error_codes[1:20], '{}');
  v_msg uuid;
  v_event uuid;
begin
  if v_phone is null or v_wamid is null or char_length(v_wamid) > 256
     or p_status is null or p_status not in ('sent', 'delivered', 'read', 'failed', 'deleted', 'unknown') then
    return 'invalid';
  end if;

  select * into v_acct from public.wa_accounts a where a.phone_number_id = v_phone;
  if not found then return 'unknown_account'; end if;
  if v_acct.status <> 'active' then return 'account_disabled'; end if;
  if nullif(btrim(p_waba_id), '') is not null and btrim(p_waba_id) <> v_acct.waba_id then return 'waba_mismatch'; end if;

  -- Only a message of THIS profile can be attached (a wamid under another profile is never touched).
  select m.id into v_msg from public.inbox_messages m
   where m.channel = 'whatsapp' and m.provider_message_id = v_wamid and m.profile_id = v_acct.profile_id;

  insert into public.inbox_status_events (profile_id, channel, provider_message_id, message_id, status, provider_timestamp, error_codes)
  values (v_acct.profile_id, 'whatsapp', v_wamid, v_msg, p_status, p_timestamp, v_codes)
  on conflict (channel, provider_message_id, status) do nothing
  returning id into v_event;
  if v_event is null then return 'duplicate'; end if;   -- same transition delivered again: nothing else changes

  if v_msg is not null then
    -- One conditional UPDATE: under concurrency the row lock re-evaluates the rank test, so the highest rank always wins.
    update public.inbox_messages m
       set status = p_status,
           status_updated_at = now(),
           error_codes = case when p_status = 'failed' then v_codes else m.error_codes end
     where m.id = v_msg and m.direction = 'outbound'
       and public.inbox_status_rank(p_status) > public.inbox_status_rank(m.status);
  end if;

  return 'created';
end;
$$;

-- ============================================================================
-- 6. FUNCTION GRANTS — same convention as 2026-12-03: nothing executable by anyone, then the two RPCs by service_role only.
--    (Guards and the rank helper are only ever called by triggers / by the RPCs, which run as the owner.)
-- ============================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in (
              'wa_accounts_guard', 'inbox_contacts_guard', 'inbox_conversations_guard', 'inbox_messages_guard', 'inbox_message_media_guard',
              'inbox_status_events_guard', 'inbox_status_rank', 'inbox_ingest_whatsapp_message', 'inbox_ingest_whatsapp_status')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
  end loop;
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('inbox_ingest_whatsapp_message', 'inbox_ingest_whatsapp_status')
  loop
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- ============================================================================
-- 7. ROW LEVEL SECURITY AND TABLE PRIVILEGES — owner read only; no client or service-role write path except the RPCs.
-- ============================================================================
alter table public.wa_accounts enable row level security;
alter table public.inbox_contacts enable row level security;
alter table public.inbox_conversations enable row level security;
alter table public.inbox_messages enable row level security;
alter table public.inbox_message_media enable row level security;
alter table public.inbox_status_events enable row level security;

revoke all on public.wa_accounts, public.inbox_contacts, public.inbox_conversations, public.inbox_messages,
  public.inbox_message_media, public.inbox_status_events from anon, authenticated, service_role;
grant select on public.wa_accounts, public.inbox_contacts, public.inbox_conversations, public.inbox_messages,
  public.inbox_message_media, public.inbox_status_events to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['wa_accounts', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_message_media', 'inbox_status_events']
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || ' owner read') then
      execute format('create policy %I on public.%I for select to authenticated using (exists (select 1 from public.profiles p where p.id = profile_id and p.user_id = auth.uid()))',
                     t || ' owner read', t);
    end if;
  end loop;
end $$;

commit;
