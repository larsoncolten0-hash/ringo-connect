begin;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customer_connections'
      and column_name in ('customer_id', 'profile_id', 'status')
    group by table_name
    having count(*) = 3
  ) then
    raise exception 'Ringo Loyalty prerequisite missing: public.customer_connections(customer_id, profile_id, status)';
  end if;
end;
$$;

create table public.customer_qr_codes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  nonce text not null check (char_length(nonce) between 16 and 64),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index customer_qr_codes_one_live
  on public.customer_qr_codes (customer_id) where revoked_at is null;

create table public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'visits' check (type in ('visits', 'spend', 'points')),
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  target integer not null check (target between 1 and 100000000),
  unit_amount integer check (unit_amount is null or unit_amount > 0),
  points_per_unit integer check (points_per_unit is null or points_per_unit between 1 and 1000000),
  reward_title text not null check (char_length(btrim(reward_title)) between 1 and 120),
  reward_expires_days integer check (reward_expires_days is null or reward_expires_days between 1 and 3650),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, profile_id),
  constraint loyalty_programs_currency_required
    check (type = 'visits' or currency is not null),
  constraint loyalty_programs_points_config
    check ((type = 'points') = (unit_amount is not null and points_per_unit is not null)),
  constraint loyalty_programs_window
    check (starts_at is null or ends_at is null or ends_at > starts_at)
);
create unique index loyalty_programs_one_active
  on public.loyalty_programs (profile_id, type, action_key) where active;
create index loyalty_programs_profile_idx
  on public.loyalty_programs (profile_id, active);

create table public.loyalty_memberships (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null,
  profile_id uuid not null,
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  cycle integer not null default 1 check (cycle >= 1),
  status text not null default 'active' check (status in ('active', 'reward_ready')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, customer_id),
  unique (id, profile_id, customer_id),
  foreign key (program_id, profile_id)
    references public.loyalty_programs (id, profile_id) on delete cascade
);
create index loyalty_memberships_profile_idx
  on public.loyalty_memberships (profile_id, status);
create index loyalty_memberships_customer_idx
  on public.loyalty_memberships (customer_id, updated_at desc);

create table public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  program_id uuid not null,
  membership_id uuid not null,
  customer_id uuid not null,
  cycle integer not null check (cycle >= 1),
  title_snapshot text not null check (char_length(btrim(title_snapshot)) between 1 and 120),
  status text not null default 'available' check (status in ('available', 'redeemed', 'expired', 'voided')),
  earned_at timestamptz not null default now(),
  expires_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid references public.users(id) on delete set null,
  voided_at timestamptz,
  constraint loyalty_rewards_redeemed_consistent check ((status = 'redeemed') = (redeemed_at is not null)),
  constraint loyalty_rewards_voided_consistent check ((status = 'voided') = (voided_at is not null)),
  foreign key (program_id, profile_id)
    references public.loyalty_programs (id, profile_id) on delete cascade,
  foreign key (membership_id, profile_id, customer_id)
    references public.loyalty_memberships (id, profile_id, customer_id) on delete cascade
);
create unique index loyalty_rewards_one_live_per_cycle
  on public.loyalty_rewards (membership_id, cycle) where status <> 'voided';
create index loyalty_rewards_customer_idx
  on public.loyalty_rewards (customer_id, status, earned_at desc);
create index loyalty_rewards_profile_idx
  on public.loyalty_rewards (profile_id, status, earned_at desc);

create table public.loyalty_package_templates (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  price integer check (price is null or price >= 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  duration_days integer not null default 30 check (duration_days between 1 and 3650),
  carry_over boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, profile_id)
);
create index loyalty_package_templates_profile_idx
  on public.loyalty_package_templates (profile_id, active);

create table public.loyalty_package_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.loyalty_package_templates(id) on delete cascade,
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  quantity integer not null check (quantity between 1 and 10000),
  unique (template_id, action_key)
);

create table public.loyalty_packages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  template_id uuid references public.loyalty_package_templates(id) on delete set null,
  name_snapshot text not null check (char_length(btrim(name_snapshot)) between 1 and 120),
  price_snapshot integer check (price_snapshot is null or price_snapshot >= 0),
  currency_snapshot text check (currency_snapshot is null or currency_snapshot ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active', 'completed', 'expired', 'cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  carry_over boolean not null default false,
  carried_to_package_id uuid unique references public.loyalty_packages(id) on delete set null,
  activated_by uuid references public.users(id) on delete set null,
  activated_at timestamptz not null default now(),
  activation_key text not null check (char_length(activation_key) between 8 and 100),
  payment_reference text check (payment_reference is null or char_length(payment_reference) <= 120),
  order_kind text check (order_kind is null or order_kind in ('music_order', 'restaurant_order', 'booking')),
  order_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (profile_id, activation_key),
  unique (id, profile_id, customer_id),
  constraint loyalty_packages_period check (ends_at > starts_at),
  constraint loyalty_packages_order_ref check ((order_kind is null) = (order_id is null)),
  constraint loyalty_packages_cancel_consistent check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint loyalty_packages_no_self_carry check (carried_to_package_id is null or carried_to_package_id <> id)
);
create index loyalty_packages_customer_idx
  on public.loyalty_packages (customer_id, status, ends_at desc);
create index loyalty_packages_profile_idx
  on public.loyalty_packages (profile_id, status);
create index loyalty_packages_expiring_idx
  on public.loyalty_packages (ends_at) where status = 'active';

create table public.loyalty_package_credits (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null,
  profile_id uuid not null,
  customer_id uuid not null,
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  total integer not null check (total >= 0),
  used integer not null default 0 check (used >= 0),
  carried_in integer not null default 0 check (carried_in >= 0),
  carried_out integer not null default 0 check (carried_out >= 0),
  unique (package_id, action_key),
  unique (id, profile_id, customer_id),
  constraint loyalty_package_credits_balance
    check (used + carried_out <= total and carried_in <= total),
  foreign key (package_id, profile_id, customer_id)
    references public.loyalty_packages (id, profile_id, customer_id) on delete cascade
);

create table public.loyalty_activities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  program_id uuid,
  membership_id uuid,
  package_credit_id uuid,
  cycle integer check (cycle is null or cycle >= 1),
  kind text not null check (kind in ('record', 'reversal')),
  action_key text not null check (action_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  quantity integer not null check (quantity <> 0),
  progress_delta integer,
  balance_after integer check (balance_after is null or balance_after >= 0),
  recorded_by uuid references public.users(id) on delete set null,
  source text not null check (source in ('staff_scan', 'staff_search', 'staff_reversal', 'carry_over', 'system')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 100),
  reverses_activity_id uuid unique references public.loyalty_activities(id),
  reversal_reason text,
  ref_kind text check (ref_kind is null or ref_kind in ('music_order', 'restaurant_order', 'booking', 'ticket_order', 'payment')),
  ref_id uuid,
  created_at timestamptz not null default now(),
  unique (profile_id, idempotency_key),
  constraint loyalty_activities_kind_sign
    check ((kind = 'record' and quantity > 0) or (kind = 'reversal' and quantity < 0)),
  constraint loyalty_activities_reversal_link
    check ((kind = 'reversal') = (reverses_activity_id is not null)),
  constraint loyalty_activities_reversal_reason
    check (
      (kind = 'reversal' and reversal_reason is not null
         and char_length(btrim(reversal_reason)) between 3 and 300)
      or (kind = 'record' and reversal_reason is null)
    ),
  constraint loyalty_activities_ref_pair
    check ((ref_kind is null) = (ref_id is null)),
  constraint loyalty_activities_one_subject check (
    (program_id is not null and membership_id is not null and package_credit_id is null
       and cycle is not null and progress_delta is not null)
    or
    (program_id is null and membership_id is null and package_credit_id is not null
       and cycle is null and progress_delta is null)
  ),
  foreign key (program_id, profile_id)
    references public.loyalty_programs (id, profile_id) on delete cascade,
  foreign key (membership_id, profile_id, customer_id)
    references public.loyalty_memberships (id, profile_id, customer_id) on delete cascade,
  foreign key (package_credit_id, profile_id, customer_id)
    references public.loyalty_package_credits (id, profile_id, customer_id) on delete cascade
);
create index loyalty_activities_profile_idx
  on public.loyalty_activities (profile_id, created_at desc);
create index loyalty_activities_customer_idx
  on public.loyalty_activities (customer_id, created_at desc);
create index loyalty_activities_membership_idx
  on public.loyalty_activities (membership_id, cycle, created_at);
create unique index loyalty_activities_one_per_ref
  on public.loyalty_activities (program_id, ref_kind, ref_id)
  where ref_id is not null and kind = 'record';

create table public.loyalty_notification_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('membership', 'package')),
  subject_id uuid not null,
  cycle integer not null default 0,
  milestone text not null check (milestone in ('near_2', 'near_1', 'unlocked', 'redeemed', 'package_expiring')),
  created_at timestamptz not null default now(),
  unique (subject_kind, subject_id, cycle, milestone)
);
create index loyalty_notification_log_customer_idx
  on public.loyalty_notification_log (customer_id, created_at desc);

create table public.customer_loyalty_prefs (
  customer_id uuid primary key references public.ringo_customers(id) on delete cascade,
  notifications_enabled boolean not null default true,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create function public.loyalty_issue_qr(
  p_customer_id uuid, p_nonce text, p_secret_hash text, p_rotate boolean
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_live text;
begin
  if p_nonce is null or char_length(p_nonce) not between 16 and 64
     or p_secret_hash is null or p_secret_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid qr parameters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('loyalty_qr:' || p_customer_id::text, 0));

  select q.nonce into v_live from public.customer_qr_codes q
   where q.customer_id = p_customer_id and q.revoked_at is null;
  if v_live is not null and not coalesce(p_rotate, false) then
    return v_live;
  end if;

  update public.customer_qr_codes set revoked_at = now()
   where customer_id = p_customer_id and revoked_at is null;
  insert into public.customer_qr_codes (customer_id, nonce, secret_hash)
  values (p_customer_id, p_nonce, p_secret_hash);
  return p_nonce;
end;
$$;

create function public.loyalty_claim_milestone(
  p_customer_id uuid, p_subject_kind text, p_subject_id uuid, p_cycle integer, p_milestone text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into public.loyalty_notification_log (customer_id, subject_kind, subject_id, cycle, milestone)
  values (p_customer_id, p_subject_kind, p_subject_id, p_cycle, p_milestone)
  on conflict (subject_kind, subject_id, cycle, milestone) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

create function public.loyalty_issue_reward(p_membership_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.loyalty_memberships%rowtype;
  p public.loyalty_programs%rowtype;
  v_id uuid;
begin
  select * into m from public.loyalty_memberships where id = p_membership_id for update;
  if not found then return null; end if;
  select * into p from public.loyalty_programs where id = m.program_id;

  insert into public.loyalty_rewards
    (profile_id, program_id, membership_id, customer_id, cycle, title_snapshot, expires_at)
  values
    (m.profile_id, m.program_id, m.id, m.customer_id, m.cycle, p.reward_title,
     case when p.reward_expires_days is null then null
          else now() + make_interval(days => p.reward_expires_days) end)
  on conflict (membership_id, cycle) where status <> 'voided' do nothing
  returning id into v_id;

  update public.loyalty_memberships
     set status = 'reward_ready', updated_at = now()
   where id = m.id;
  return v_id;
end;
$$;

create function public.loyalty_advance_cycle(p_membership_id uuid, p_key text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.loyalty_memberships%rowtype;
  p public.loyalty_programs%rowtype;
  v_surplus integer;
  v_next integer;
begin
  select * into m from public.loyalty_memberships where id = p_membership_id for update;
  if not found then return; end if;
  select * into p from public.loyalty_programs where id = m.program_id;

  v_surplus := greatest(m.progress - p.target, 0);
  v_next := m.cycle + 1;

  update public.loyalty_memberships
     set cycle = v_next, progress = v_surplus, status = 'active', updated_at = now()
   where id = m.id;

  if v_surplus > 0 then
    insert into public.loyalty_activities
      (profile_id, customer_id, program_id, membership_id, cycle, kind, action_key,
       quantity, progress_delta, balance_after, source, idempotency_key)
    values
      (m.profile_id, m.customer_id, m.program_id, m.id, v_next, 'record', p.action_key,
       v_surplus, v_surplus, v_surplus, 'carry_over', 'carry:' || p_key);
  end if;

  if v_surplus >= p.target then
    perform public.loyalty_issue_reward(m.id);
  end if;
end;
$$;

create function public.loyalty_expire_due_reward(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  m public.loyalty_memberships%rowtype;
  r public.loyalty_rewards%rowtype;
begin
  select * into m from public.loyalty_memberships where id = p_membership_id;
  if not found or m.status <> 'reward_ready' then return; end if;

  select * into r from public.loyalty_rewards
   where membership_id = m.id and cycle = m.cycle and status = 'available'
     and expires_at is not null and expires_at <= now()
   for update;
  if not found then return; end if;

  update public.loyalty_rewards set status = 'expired' where id = r.id;
  perform public.loyalty_advance_cycle(m.id, 'expire:' || r.id::text);
end;
$$;

create function public.loyalty_record_activity(
  p_profile_id uuid,
  p_customer_id uuid,
  p_program_id uuid,
  p_quantity integer,
  p_staff_user_id uuid,
  p_source text,
  p_idempotency_key text,
  p_ref_kind text default null,
  p_ref_id uuid default null
)
returns table (
  out_outcome text,
  out_activity_id uuid,
  out_membership_id uuid,
  out_progress integer,
  out_target integer,
  out_cycle integer,
  out_reward_id uuid,
  out_notify text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_prog public.loyalty_programs%rowtype;
  v_mem public.loyalty_memberships%rowtype;
  v_existing public.loyalty_activities%rowtype;
  v_big bigint;
  v_delta integer;
  v_new integer;
  v_remaining integer;
  v_act uuid;
  v_reward uuid;
begin
  out_notify := '{}';

  if p_source not in ('staff_scan', 'staff_search', 'system')
     or p_quantity is null or p_quantity < 1 or p_quantity > 100000000
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    out_outcome := 'invalid_request'; return next; return;
  end if;

  select * into v_prog from public.loyalty_programs
   where id = p_program_id and profile_id = p_profile_id;
  if not found then out_outcome := 'program_not_found'; return next; return; end if;
  out_target := v_prog.target;

  if not v_prog.active
     or (v_prog.starts_at is not null and v_prog.starts_at > now())
     or (v_prog.ends_at is not null and v_prog.ends_at <= now()) then
    out_outcome := 'program_inactive'; return next; return;
  end if;

  if not exists (
    select 1 from public.customer_connections c
     where c.customer_id = p_customer_id and c.profile_id = p_profile_id and c.status = 'active'
  ) then
    out_outcome := 'not_connected'; return next; return;
  end if;

  if v_prog.type = 'points' then
    v_big := (p_quantity::bigint / v_prog.unit_amount) * v_prog.points_per_unit;
  else
    v_big := p_quantity::bigint;
  end if;
  if v_big < 1 then out_outcome := 'invalid_quantity'; return next; return; end if;

  if v_prog.type <> 'visits'
     and (p_quantity > 10000000 or v_big > v_prog.target::bigint * 10) then
    out_outcome := 'quantity_too_large'; return next; return;
  end if;
  v_delta := v_big::integer;

  insert into public.loyalty_memberships (program_id, profile_id, customer_id)
  values (p_program_id, p_profile_id, p_customer_id)
  on conflict (program_id, customer_id) do nothing;

  select * into v_mem from public.loyalty_memberships
   where program_id = p_program_id and customer_id = p_customer_id
   for update;
  out_membership_id := v_mem.id;

  select * into v_existing from public.loyalty_activities
   where profile_id = p_profile_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.membership_id is distinct from v_mem.id then
      out_outcome := 'invalid_request'; return next; return;
    end if;
    out_outcome := 'duplicate'; out_activity_id := v_existing.id;
    out_progress := v_mem.progress; out_cycle := v_mem.cycle;
    return next; return;
  end if;

  perform public.loyalty_expire_due_reward(v_mem.id);
  select * into v_mem from public.loyalty_memberships where id = v_mem.id;
  out_progress := v_mem.progress; out_cycle := v_mem.cycle;

  if v_mem.status = 'reward_ready' then
    out_outcome := 'at_target'; return next; return;
  end if;

  if v_mem.progress >= v_prog.target then
    v_reward := public.loyalty_issue_reward(v_mem.id);
    if v_reward is not null
       and public.loyalty_claim_milestone(p_customer_id, 'membership', v_mem.id, v_mem.cycle, 'unlocked') then
      out_notify := array_append(out_notify, 'unlocked');
    end if;
    out_reward_id := v_reward; out_outcome := 'at_target'; return next; return;
  end if;

  if v_prog.type = 'visits' and v_delta > v_prog.target - v_mem.progress then
    out_outcome := 'exceeds_remaining'; return next; return;
  end if;

  v_new := v_mem.progress + v_delta;

  insert into public.loyalty_activities
    (profile_id, customer_id, program_id, membership_id, cycle, kind, action_key,
     quantity, progress_delta, balance_after, recorded_by, source, idempotency_key, ref_kind, ref_id)
  values
    (p_profile_id, p_customer_id, p_program_id, v_mem.id, v_mem.cycle, 'record', v_prog.action_key,
     p_quantity, v_delta, v_new, p_staff_user_id, p_source, p_idempotency_key, p_ref_kind, p_ref_id)
  returning id into v_act;

  update public.loyalty_memberships
     set progress = v_new, updated_at = now()
   where id = v_mem.id;

  if v_new >= v_prog.target then
    v_reward := public.loyalty_issue_reward(v_mem.id);
    if v_reward is not null
       and public.loyalty_claim_milestone(p_customer_id, 'membership', v_mem.id, v_mem.cycle, 'unlocked') then
      out_notify := array_append(out_notify, 'unlocked');
    end if;
  elsif v_prog.type = 'visits' then
    v_remaining := v_prog.target - v_new;
    if v_remaining = 2 and v_prog.target > 2
       and public.loyalty_claim_milestone(p_customer_id, 'membership', v_mem.id, v_mem.cycle, 'near_2') then
      out_notify := array_append(out_notify, 'near_2');
    elsif v_remaining = 1 and v_prog.target > 1
       and public.loyalty_claim_milestone(p_customer_id, 'membership', v_mem.id, v_mem.cycle, 'near_1') then
      out_notify := array_append(out_notify, 'near_1');
    end if;
  end if;

  out_outcome := 'recorded'; out_activity_id := v_act; out_progress := v_new; out_reward_id := v_reward;
  return next; return;
end;
$$;

create function public.loyalty_redeem_reward(
  p_profile_id uuid, p_reward_id uuid, p_staff_user_id uuid
)
returns table (
  out_outcome text,
  out_reward_id uuid,
  out_membership_id uuid,
  out_customer_id uuid,
  out_title text,
  out_progress integer,
  out_cycle integer,
  out_notify text[]
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_mid uuid;
  m public.loyalty_memberships%rowtype;
  r public.loyalty_rewards%rowtype;
begin
  out_notify := '{}';

  select membership_id into v_mid from public.loyalty_rewards
   where id = p_reward_id and profile_id = p_profile_id;
  if v_mid is null then out_outcome := 'not_found'; return next; return; end if;

  select * into m from public.loyalty_memberships where id = v_mid for update;
  perform public.loyalty_expire_due_reward(m.id);
  select * into r from public.loyalty_rewards where id = p_reward_id for update;
  select * into m from public.loyalty_memberships where id = v_mid;
  out_reward_id := r.id; out_membership_id := m.id; out_customer_id := r.customer_id;
  out_title := r.title_snapshot; out_progress := m.progress; out_cycle := m.cycle;

  if r.status = 'redeemed' then out_outcome := 'already_redeemed'; return next; return; end if;
  if r.status = 'expired' then out_outcome := 'expired'; return next; return; end if;
  if r.status = 'voided' then out_outcome := 'voided'; return next; return; end if;

  if not exists (
    select 1 from public.customer_connections c
     where c.customer_id = r.customer_id and c.profile_id = p_profile_id and c.status = 'active'
  ) then
    out_outcome := 'not_connected'; return next; return;
  end if;

  update public.loyalty_rewards
     set status = 'redeemed', redeemed_at = now(), redeemed_by = p_staff_user_id
   where id = r.id;

  perform public.loyalty_advance_cycle(m.id, 'redeem:' || r.id::text);
  select * into m from public.loyalty_memberships where id = v_mid;
  out_progress := m.progress; out_cycle := m.cycle;

  if public.loyalty_claim_milestone(r.customer_id, 'membership', m.id, r.cycle, 'redeemed') then
    out_notify := array_append(out_notify, 'redeemed');
  end if;
  out_outcome := 'redeemed'; return next; return;
end;
$$;

create function public.loyalty_reverse_activity(
  p_profile_id uuid,
  p_activity_id uuid,
  p_staff_user_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns table (
  out_outcome text,
  out_reversal_id uuid,
  out_customer_id uuid,
  out_balance integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  a public.loyalty_activities%rowtype;
  m public.loyalty_memberships%rowtype;
  c public.loyalty_package_credits%rowtype;
  pk public.loyalty_packages%rowtype;
  p public.loyalty_programs%rowtype;
  v_reason text;
  v_new integer;
  v_id uuid;
begin
  v_reason := btrim(p_reason);
  if p_reason is null
     or char_length(v_reason) < 3 or char_length(v_reason) > 300
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    out_outcome := 'invalid_request'; return next; return;
  end if;

  select * into a from public.loyalty_activities
   where id = p_activity_id and profile_id = p_profile_id;
  if not found then out_outcome := 'not_found'; return next; return; end if;
  out_customer_id := a.customer_id;
  if a.kind <> 'record' or a.source = 'carry_over' then
    out_outcome := 'not_reversible'; return next; return;
  end if;

  if a.membership_id is not null then
    select * into m from public.loyalty_memberships where id = a.membership_id for update;
    perform public.loyalty_expire_due_reward(m.id);
    select * into m from public.loyalty_memberships where id = a.membership_id;
    select * into p from public.loyalty_programs where id = m.program_id;
  else
    select * into c from public.loyalty_package_credits where id = a.package_credit_id;
    select * into pk from public.loyalty_packages where id = c.package_id for update;
    select * into c from public.loyalty_package_credits where id = a.package_credit_id for update;
  end if;

  if exists (select 1 from public.loyalty_activities
              where profile_id = p_profile_id and idempotency_key = p_idempotency_key) then
    out_outcome := 'duplicate'; return next; return;
  end if;
  if exists (select 1 from public.loyalty_activities where reverses_activity_id = a.id) then
    out_outcome := 'already_reversed'; return next; return;
  end if;

  if a.membership_id is not null then
    if a.cycle <> m.cycle
       or exists (select 1 from public.loyalty_rewards rw
                   where rw.membership_id = m.id and rw.cycle = a.cycle and rw.status = 'redeemed')
       or m.progress - a.progress_delta < 0 then
      out_outcome := 'not_reversible'; return next; return;
    end if;
    v_new := m.progress - a.progress_delta;

    insert into public.loyalty_activities
      (profile_id, customer_id, program_id, membership_id, cycle, kind, action_key,
       quantity, progress_delta, balance_after, recorded_by, source, idempotency_key,
       reverses_activity_id, reversal_reason)
    values
      (a.profile_id, a.customer_id, a.program_id, a.membership_id, a.cycle, 'reversal', a.action_key,
       -a.quantity, -a.progress_delta, v_new, p_staff_user_id, 'staff_reversal', p_idempotency_key,
       a.id, v_reason)
    returning id into v_id;

    update public.loyalty_memberships
       set progress = v_new, updated_at = now(),
           status = case when m.status = 'reward_ready' and v_new >= p.target
                         then 'reward_ready' else 'active' end
     where id = m.id;

    if m.status = 'reward_ready' and v_new < p.target then
      update public.loyalty_rewards set status = 'voided', voided_at = now()
       where membership_id = m.id and cycle = m.cycle and status = 'available';
    end if;
    out_balance := v_new;
  else
    if pk.status not in ('active', 'completed')
       or c.carried_out > 0
       or pk.ends_at <= now()
       or c.used - a.quantity < 0 then
      out_outcome := 'not_reversible'; return next; return;
    end if;

    out_balance := c.total - (c.used - a.quantity) - c.carried_out;
    update public.loyalty_package_credits set used = used - a.quantity where id = c.id;
    if pk.status = 'completed' then
      update public.loyalty_packages set status = 'active', updated_at = now() where id = pk.id;
    end if;

    insert into public.loyalty_activities
      (profile_id, customer_id, package_credit_id, kind, action_key, quantity, balance_after,
       recorded_by, source, idempotency_key, reverses_activity_id, reversal_reason)
    values
      (a.profile_id, a.customer_id, a.package_credit_id, 'reversal', a.action_key, -a.quantity, out_balance,
       p_staff_user_id, 'staff_reversal', p_idempotency_key, a.id, v_reason)
    returning id into v_id;
  end if;

  out_outcome := 'reversed'; out_reversal_id := v_id; return next; return;
end;
$$;

create function public.loyalty_activate_package(
  p_profile_id uuid,
  p_customer_id uuid,
  p_template_id uuid,
  p_starts_at timestamptz,
  p_staff_user_id uuid,
  p_payment_reference text,
  p_activation_key text
)
returns table (out_outcome text, out_package_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  t public.loyalty_package_templates%rowtype;
  prev public.loyalty_packages%rowtype;
  v_src record;
  v_start timestamptz;
  v_pkg uuid;
  v_moved integer := 0;
  v_received integer;
begin
  if p_activation_key is null or char_length(p_activation_key) not between 8 and 100 then
    out_outcome := 'invalid_request'; return next; return;
  end if;

  select id into v_pkg from public.loyalty_packages
   where profile_id = p_profile_id and activation_key = p_activation_key;
  if found then out_outcome := 'duplicate'; out_package_id := v_pkg; return next; return; end if;

  select * into t from public.loyalty_package_templates
   where id = p_template_id and profile_id = p_profile_id;
  if not found then out_outcome := 'template_not_found'; return next; return; end if;
  if not t.active then out_outcome := 'template_inactive'; return next; return; end if;

  if not exists (
    select 1 from public.customer_connections c
     where c.customer_id = p_customer_id and c.profile_id = p_profile_id and c.status = 'active'
  ) then
    out_outcome := 'not_connected'; return next; return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('loyalty_pkg:' || p_profile_id::text || p_customer_id::text || p_template_id::text, 0));

  select id into v_pkg from public.loyalty_packages
   where profile_id = p_profile_id and activation_key = p_activation_key;
  if found then out_outcome := 'duplicate'; out_package_id := v_pkg; return next; return; end if;

  v_start := coalesce(p_starts_at, now());
  insert into public.loyalty_packages
    (profile_id, customer_id, template_id, name_snapshot, price_snapshot, currency_snapshot,
     starts_at, ends_at, carry_over, activated_by, activation_key, payment_reference)
  values
    (p_profile_id, p_customer_id, t.id, t.name, t.price, t.currency,
     v_start, v_start + make_interval(days => t.duration_days), t.carry_over,
     p_staff_user_id, p_activation_key, left(p_payment_reference, 120))
  returning id into v_pkg;

  insert into public.loyalty_package_credits (package_id, profile_id, customer_id, action_key, total)
  select v_pkg, p_profile_id, p_customer_id, i.action_key, i.quantity
    from public.loyalty_package_template_items i
   where i.template_id = t.id;

  if t.carry_over then
    select * into prev from public.loyalty_packages
     where profile_id = p_profile_id and customer_id = p_customer_id and template_id = t.id
       and id <> v_pkg and carried_to_package_id is null
       and status in ('active', 'completed', 'expired') and starts_at < v_start
     order by starts_at desc
     limit 1
     for update;

    if found then
      for v_src in
        select pc.id as src_id,
               pc.action_key as src_action,
               pc.total - pc.used - pc.carried_out as rem
          from public.loyalty_package_credits pc
         where pc.package_id = prev.id
           and pc.total - pc.used - pc.carried_out > 0
         for update
      loop
        update public.loyalty_package_credits nc
           set total = nc.total + v_src.rem,
               carried_in = nc.carried_in + v_src.rem
         where nc.package_id = v_pkg and nc.action_key = v_src.src_action;

        if found then
          update public.loyalty_package_credits
             set carried_out = carried_out + v_src.rem
           where id = v_src.src_id;
          v_moved := v_moved + v_src.rem;
        end if;
      end loop;

      select coalesce(sum(carried_in), 0) into v_received
        from public.loyalty_package_credits where package_id = v_pkg;
      if v_received <> v_moved then
        raise exception 'loyalty carry-over mismatch: moved %, received %', v_moved, v_received;
      end if;

      if v_moved > 0 then
        update public.loyalty_packages
           set carried_to_package_id = v_pkg,
               updated_at = now(),
               status = case
                 when status = 'active'
                  and not exists (select 1 from public.loyalty_package_credits x
                                   where x.package_id = prev.id
                                     and x.total - x.used - x.carried_out > 0)
                 then 'completed'
                 else status
               end
         where id = prev.id;
      end if;
    end if;
  end if;

  out_outcome := 'activated'; out_package_id := v_pkg; return next; return;
end;
$$;

create function public.loyalty_use_package_credit(
  p_profile_id uuid,
  p_customer_id uuid,
  p_credit_id uuid,
  p_quantity integer,
  p_staff_user_id uuid,
  p_source text,
  p_idempotency_key text
)
returns table (
  out_outcome text,
  out_activity_id uuid,
  out_package_id uuid,
  out_package_status text,
  out_action_key text,
  out_remaining integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_pid uuid;
  pk public.loyalty_packages%rowtype;
  c public.loyalty_package_credits%rowtype;
  v_existing public.loyalty_activities%rowtype;
  v_remaining integer;
  v_act uuid;
begin
  if p_source not in ('staff_scan', 'staff_search')
     or p_quantity is null or p_quantity < 1 or p_quantity > 10000
     or p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    out_outcome := 'invalid_request'; return next; return;
  end if;

  select package_id into v_pid from public.loyalty_package_credits
   where id = p_credit_id and profile_id = p_profile_id and customer_id = p_customer_id;
  if v_pid is null then out_outcome := 'not_found'; return next; return; end if;

  select * into pk from public.loyalty_packages where id = v_pid for update;
  select * into c from public.loyalty_package_credits where id = p_credit_id for update;
  out_package_id := pk.id; out_package_status := pk.status; out_action_key := c.action_key;
  out_remaining := c.total - c.used - c.carried_out;

  select * into v_existing from public.loyalty_activities
   where profile_id = p_profile_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.package_credit_id is distinct from c.id then
      out_outcome := 'invalid_request'; return next; return;
    end if;
    out_outcome := 'duplicate'; out_activity_id := v_existing.id; return next; return;
  end if;

  if not exists (
    select 1 from public.customer_connections cc
     where cc.customer_id = p_customer_id and cc.profile_id = p_profile_id and cc.status = 'active'
  ) then
    out_outcome := 'not_connected'; return next; return;
  end if;

  if pk.status = 'cancelled' then out_outcome := 'package_cancelled'; return next; return; end if;
  if pk.status = 'active' and pk.ends_at <= now() then
    update public.loyalty_packages set status = 'expired', updated_at = now() where id = pk.id;
    out_package_status := 'expired';
    out_outcome := 'package_expired'; return next; return;
  end if;
  if pk.status = 'expired' then out_outcome := 'package_expired'; return next; return; end if;
  if pk.starts_at > now() then out_outcome := 'package_not_started'; return next; return; end if;
  if pk.status <> 'active' or out_remaining < p_quantity then
    out_outcome := 'insufficient_balance'; return next; return;
  end if;

  v_remaining := out_remaining - p_quantity;
  insert into public.loyalty_activities
    (profile_id, customer_id, package_credit_id, kind, action_key, quantity, balance_after,
     recorded_by, source, idempotency_key)
  values
    (p_profile_id, p_customer_id, c.id, 'record', c.action_key, p_quantity, v_remaining,
     p_staff_user_id, p_source, p_idempotency_key)
  returning id into v_act;

  update public.loyalty_package_credits set used = used + p_quantity where id = c.id;

  if not exists (
    select 1 from public.loyalty_package_credits x
     where x.package_id = pk.id and x.total - x.used - x.carried_out > 0
  ) then
    update public.loyalty_packages set status = 'completed', updated_at = now() where id = pk.id;
    out_package_status := 'completed';
  end if;

  out_outcome := 'recorded'; out_activity_id := v_act; out_remaining := v_remaining;
  return next; return;
end;
$$;

create function public.loyalty_cancel_package(
  p_profile_id uuid, p_package_id uuid, p_staff_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_staff_user_id is null then return 'invalid_request'; end if;

  update public.loyalty_packages
     set status = 'cancelled', cancelled_at = now(), cancelled_by = p_staff_user_id, updated_at = now()
   where id = p_package_id and profile_id = p_profile_id and status = 'active'
  returning id into v_id;
  return case when v_id is null then 'not_cancellable' else 'cancelled' end;
end;
$$;

create function public.loyalty_claim_expiring_packages(p_within_days integer default 5)
returns table (
  out_package_id uuid,
  out_customer_id uuid,
  out_profile_id uuid,
  out_name text,
  out_ends_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
  if p_within_days is null or p_within_days < 1 or p_within_days > 30 then
    raise exception 'invalid window';
  end if;

  return query
  with due as (
    select pk.id, pk.customer_id, pk.profile_id, pk.name_snapshot, pk.ends_at
      from public.loyalty_packages pk
     where pk.status = 'active'
       and pk.ends_at > now()
       and pk.ends_at <= now() + make_interval(days => p_within_days)
       and exists (select 1 from public.loyalty_package_credits pc
                    where pc.package_id = pk.id and pc.total - pc.used - pc.carried_out > 0)
  ), claimed as (
    insert into public.loyalty_notification_log (customer_id, subject_kind, subject_id, cycle, milestone)
    select d.customer_id, 'package', d.id, 0, 'package_expiring' from due d
    on conflict (subject_kind, subject_id, cycle, milestone) do nothing
    returning subject_id
  )
  select d.id, d.customer_id, d.profile_id, d.name_snapshot, d.ends_at
    from due d
    join claimed cl on cl.subject_id = d.id;
end;
$$;

alter table public.customer_qr_codes enable row level security;
alter table public.loyalty_programs enable row level security;
alter table public.loyalty_memberships enable row level security;
alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_package_templates enable row level security;
alter table public.loyalty_package_template_items enable row level security;
alter table public.loyalty_packages enable row level security;
alter table public.loyalty_package_credits enable row level security;
alter table public.loyalty_activities enable row level security;
alter table public.loyalty_notification_log enable row level security;
alter table public.customer_loyalty_prefs enable row level security;

revoke all on
  public.customer_qr_codes, public.loyalty_programs, public.loyalty_memberships,
  public.loyalty_rewards, public.loyalty_package_templates, public.loyalty_package_template_items,
  public.loyalty_packages, public.loyalty_package_credits, public.loyalty_activities,
  public.loyalty_notification_log, public.customer_loyalty_prefs
from public, anon, authenticated, service_role;

grant select on
  public.customer_qr_codes,
  public.loyalty_memberships,
  public.loyalty_rewards,
  public.loyalty_packages,
  public.loyalty_package_credits,
  public.loyalty_activities,
  public.loyalty_notification_log
to service_role;

grant select, insert on public.loyalty_programs to service_role;
grant update (name, target, unit_amount, points_per_unit, reward_title,
              reward_expires_days, active, starts_at, ends_at, updated_at)
  on public.loyalty_programs to service_role;

grant select, insert on public.loyalty_package_templates to service_role;
grant update (name, price, currency, duration_days, carry_over, active, updated_at)
  on public.loyalty_package_templates to service_role;

grant select, insert, update, delete on public.loyalty_package_template_items to service_role;
grant select, insert, update on public.customer_loyalty_prefs to service_role;

revoke all on function public.loyalty_issue_qr(uuid, text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_claim_milestone(uuid, text, uuid, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_issue_reward(uuid) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_advance_cycle(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_expire_due_reward(uuid) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_record_activity(uuid, uuid, uuid, integer, uuid, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_redeem_reward(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_reverse_activity(uuid, uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_activate_package(uuid, uuid, uuid, timestamptz, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_use_package_credit(uuid, uuid, uuid, integer, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_cancel_package(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.loyalty_claim_expiring_packages(integer) from public, anon, authenticated, service_role;

grant execute on function public.loyalty_issue_qr(uuid, text, text, boolean) to service_role;
grant execute on function public.loyalty_record_activity(uuid, uuid, uuid, integer, uuid, text, text, text, uuid) to service_role;
grant execute on function public.loyalty_redeem_reward(uuid, uuid, uuid) to service_role;
grant execute on function public.loyalty_reverse_activity(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.loyalty_activate_package(uuid, uuid, uuid, timestamptz, uuid, text, text) to service_role;
grant execute on function public.loyalty_use_package_credit(uuid, uuid, uuid, integer, uuid, text, text) to service_role;
grant execute on function public.loyalty_cancel_package(uuid, uuid, uuid) to service_role;
grant execute on function public.loyalty_claim_expiring_packages(integer) to service_role;

commit;
