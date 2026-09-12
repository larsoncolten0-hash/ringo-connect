-- Event gate scanning / check-in — QR-based entry verification for events
-- sold through event_ticket_types (2026-09-21_event_ticket_types.sql).
-- Extends that migration's digital_tickets rather than replacing anything:
-- every existing ticket-type/purchase/payout table is untouched.
--
-- Design notes:
--
-- * Security staff never get a Supabase account or a Ringo session — a
--   "scanner session" is a bare bearer token (scanner_sessions.token, a
--   64-char random hex string, never the row's own uuid — same
--   unguessable-token posture as digital_tickets.ticket_code) embedded in
--   a link the organizer shares. Every scanner API route
--   (src/app/api/scanner/[token]/*) looks the token up with the ADMIN
--   client and does its own active/expiry/event checks in application
--   code — there is deliberately no RLS policy that ever grants the
--   scanner anything directly, because there is no auth.uid() for it to
--   key off (see the RLS section below).
--
-- * Ticket validity (status: valid/used/cancelled/refunded — already
--   existed) and physical admission state (the new entry_state:
--   not_checked_in/inside/outside) are deliberately two separate columns
--   rather than folding "used" into more entry-related statuses. This
--   matters for re-entry: a re-entry-enabled ticket must stay
--   status='valid' forever (so TicketPassView.tsx — built for the
--   single-entry model — keeps showing the fan their live QR exactly as
--   before) while entry_state toggles inside/outside on every gate scan.
--   A single-entry ticket instead flips status to 'used' on its one
--   successful entry scan (unchanged from the original model) and
--   entry_state stays 'inside' permanently — either way, checkin_ticket()
--   below is the one place that decides which happens.
--
-- * The actual concurrency guarantee (two gates scanning the same ticket
--   at once) is a single `select ... for update` inside checkin_ticket(),
--   not a read-then-write from application code — the second call
--   genuinely blocks on the row lock until the first transaction commits,
--   then re-evaluates against the now-current state. Locked to
--   service_role only, same posture as reserve_event_ticket_type() in the
--   previous migration.
--
-- * ticket_checkin_logs is a self-contained audit trail — gate_name,
--   ticket_type_name and ticket_holder_name are snapshotted at scan time
--   (not joined live), so a later scanner rename or ticket-type edit never
--   rewrites what the log already says happened, and reading the log back
--   for the organizer's dashboard never needs to re-join half the schema.
--
-- Additive/idempotent throughout, same reasoning as every migration since
-- 2026-09-12.

-- ============================================================================
-- 1. EVENTS — entry policy + default ID-verification requirement
-- ============================================================================
alter table events add column if not exists entry_policy text not null default 'single_entry';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'events_entry_policy_check') then
    alter table events add constraint events_entry_policy_check
      check (entry_policy in ('single_entry', 're_entry_allowed', 'unlimited_re_entry'));
  end if;
end $$;
alter table events add column if not exists require_id_verification boolean not null default false;

-- ============================================================================
-- 2. EVENT TICKET TYPES — optional per-tier override of the event default
--    (null = inherit events.require_id_verification)
-- ============================================================================
alter table event_ticket_types add column if not exists require_id_verification boolean;

-- ============================================================================
-- 3. DIGITAL TICKETS — physical admission state, separate from `status`
-- ============================================================================
alter table digital_tickets add column if not exists entry_state text not null default 'not_checked_in';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'digital_tickets_entry_state_check') then
    alter table digital_tickets add constraint digital_tickets_entry_state_check
      check (entry_state in ('not_checked_in', 'inside', 'outside'));
  end if;
end $$;
alter table digital_tickets add column if not exists last_checkin_at timestamptz;
create index if not exists digital_tickets_entry_state_idx on digital_tickets (event_id, entry_state);

-- ============================================================================
-- 4. SCANNER SESSIONS — one per gate/device the organizer creates
-- ============================================================================
create table if not exists scanner_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  -- Denormalized from events.profile_id at creation time — lets every RLS
  -- policy and every dashboard query key off profile_id directly, same
  -- convenience digital_tickets.profile_id already gives that table.
  profile_id uuid not null references profiles(id) on delete cascade,
  gate_name text not null,
  scanner_type text not null default 'entry',
  -- 'scanner' (scan + see the local per-gate count only) vs 'supervisor'
  -- (also gate activity + scan history for the whole event) — see
  -- src/app/api/scanner/[token]/route.ts. Never a route to financial data
  -- at either level (see that route's own comment).
  permission_level text not null default 'scanner',
  -- The actual bearer credential — see set_scanner_session_token() below.
  -- Never the row's own id.
  token text not null unique,
  is_active boolean not null default true,
  -- Nullable at the schema level (an organizer could technically leave an
  -- event open-ended), but the dashboard's own create form always
  -- proposes one — see EventCheckinDashboard.tsx — so a scanner link is
  -- never accidentally left permanently valid in normal use.
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists scanner_sessions_event_id_idx on scanner_sessions (event_id);
create index if not exists scanner_sessions_token_idx on scanner_sessions (token);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scanner_sessions_type_check') then
    alter table scanner_sessions add constraint scanner_sessions_type_check check (scanner_type in ('entry', 'exit'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scanner_sessions_permission_check') then
    alter table scanner_sessions add constraint scanner_sessions_permission_check check (permission_level in ('scanner', 'supervisor'));
  end if;
end $$;

-- Same generator shape as digital_tickets.ticket_code/restaurant_tables.
-- public_code, but 32 random bytes (64 hex chars), not 6 — this token
-- alone is the entire authorization for scanning, with no accompanying
-- Supabase session to back it up, so it needs materially more entropy
-- than a code a fan reads off their own already-access-controlled ticket
-- page.
create or replace function set_scanner_session_token() returns trigger as $$
declare
  candidate text;
  attempts int := 0;
begin
  if new.token is not null then
    return new;
  end if;
  loop
    candidate := encode(gen_random_bytes(32), 'hex');
    attempts := attempts + 1;
    exit when not exists (select 1 from scanner_sessions where token = candidate);
    if attempts > 20 then
      candidate := encode(gen_random_bytes(32), 'hex') || attempts::text;
      exit;
    end if;
  end loop;
  new.token := candidate;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_set_scanner_session_token on scanner_sessions;
create trigger trg_set_scanner_session_token
before insert on scanner_sessions
for each row execute function set_scanner_session_token();

alter table scanner_sessions enable row level security;
do $$
begin
  -- Owner/admin only — no anon or "authenticated" policy at all. A
  -- scanner in the field authenticates with its bearer token, not a
  -- Supabase session, so it has no auth.uid() for any RLS policy to
  -- recognize in the first place; every scanner-facing read/write goes
  -- through the admin client in src/app/api/scanner/[token]/*, which does
  -- its own token/expiry/event checks instead.
  if not exists (select 1 from pg_policies where tablename = 'scanner_sessions' and policyname = 'scanner_sessions owner all') then
    create policy "scanner_sessions owner all" on scanner_sessions for all using (
      exists (select 1 from profiles p where p.id = profile_id and (p.user_id = auth.uid() or is_admin()))
    );
  end if;
end $$;

-- ============================================================================
-- 5. TICKET CHECK-IN LOGS — the audit trail (section 29 of the spec)
-- ============================================================================
create table if not exists ticket_checkin_logs (
  id uuid primary key default gen_random_uuid(),
  -- Null only for a scan of a code that never resolved to a real ticket at
  -- all ("not_found") — everything else always references a real row.
  ticket_id uuid references digital_tickets(id) on delete cascade,
  -- The raw scanned value, kept regardless of whether it resolved — the
  -- only way an organizer can later distinguish "garbled QR" from
  -- "someone is trying random codes at my gate" in the audit trail.
  scanned_code text,
  event_id uuid not null references events(id) on delete cascade,
  scanner_session_id uuid references scanner_sessions(id) on delete set null,
  -- Snapshotted, not joined — see the migration header.
  gate_name text not null,
  ticket_type_name text,
  ticket_holder_name text,
  direction text not null,
  result text not null,
  created_at timestamptz not null default now()
);
create index if not exists ticket_checkin_logs_event_id_idx on ticket_checkin_logs (event_id, created_at desc);
create index if not exists ticket_checkin_logs_ticket_id_idx on ticket_checkin_logs (ticket_id);
create index if not exists ticket_checkin_logs_scanner_session_id_idx on ticket_checkin_logs (scanner_session_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ticket_checkin_logs_direction_check') then
    alter table ticket_checkin_logs add constraint ticket_checkin_logs_direction_check check (direction in ('entry', 'exit'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ticket_checkin_logs_result_check') then
    alter table ticket_checkin_logs add constraint ticket_checkin_logs_result_check check (
      result in ('approved', 'not_found', 'wrong_event', 'unpaid', 'cancelled', 'refunded', 'already_used', 'already_inside', 'not_inside', 'expired_session')
    );
  end if;
end $$;

alter table ticket_checkin_logs enable row level security;
do $$
begin
  -- Owner/admin read — the dashboard's live check-in view/history reads
  -- this directly with the regular client. No insert/update/delete policy
  -- for anyone: every log row is written exclusively by the admin client
  -- inside src/app/api/scanner/[token]/scan/route.ts, the one place a
  -- check-in can actually happen.
  if not exists (select 1 from pg_policies where tablename = 'ticket_checkin_logs' and policyname = 'ticket_checkin_logs owner read') then
    create policy "ticket_checkin_logs owner read" on ticket_checkin_logs for select using (
      exists (
        select 1 from events e join profiles p on p.id = e.profile_id
        where e.id = event_id and (p.user_id = auth.uid() or is_admin())
      )
    );
  end if;
end $$;

-- ============================================================================
-- 6. ATOMIC CHECK-IN — the one place a ticket's entry_state/status
--    actually transitions. See the migration header for why the row lock
--    here (not application code) is what makes two simultaneous gate
--    scans of the same ticket safe.
-- ============================================================================
create or replace function checkin_ticket(p_ticket_id uuid, p_direction text, p_entry_policy text)
returns jsonb as $$
declare
  v_ticket digital_tickets;
  v_outcome text;
begin
  select * into v_ticket from digital_tickets where id = p_ticket_id for update;
  if v_ticket is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if v_ticket.status = 'cancelled' then
    return jsonb_build_object('outcome', 'cancelled', 'ticket', to_jsonb(v_ticket));
  end if;
  if v_ticket.status = 'refunded' then
    return jsonb_build_object('outcome', 'refunded', 'ticket', to_jsonb(v_ticket));
  end if;
  if v_ticket.status = 'used' then
    return jsonb_build_object('outcome', 'already_used', 'ticket', to_jsonb(v_ticket));
  end if;

  if p_direction = 'entry' then
    if v_ticket.entry_state = 'inside' then
      return jsonb_build_object('outcome', 'already_inside', 'ticket', to_jsonb(v_ticket));
    end if;
    -- A single-entry ticket's one legitimate entry also retires it
    -- (status → 'used') — every later scan anywhere then hits the
    -- v_ticket.status = 'used' branch above, entry or exit, any gate.
    -- Re-entry-enabled tickets stay 'valid' and only ever move between
    -- inside/outside.
    update digital_tickets
    set entry_state = 'inside',
        last_checkin_at = now(),
        status = case when p_entry_policy = 'single_entry' then 'used' else status end
    where id = p_ticket_id
    returning * into v_ticket;
    v_outcome := 'approved';
  else
    if v_ticket.entry_state <> 'inside' then
      return jsonb_build_object('outcome', 'not_inside', 'ticket', to_jsonb(v_ticket));
    end if;
    update digital_tickets
    set entry_state = 'outside', last_checkin_at = now()
    where id = p_ticket_id
    returning * into v_ticket;
    v_outcome := 'approved';
  end if;

  return jsonb_build_object('outcome', v_outcome, 'ticket', to_jsonb(v_ticket));
end;
$$ language plpgsql security definer;

revoke all on function checkin_ticket(uuid, text, text) from public, anon, authenticated;
grant execute on function checkin_ticket(uuid, text, text) to service_role;
