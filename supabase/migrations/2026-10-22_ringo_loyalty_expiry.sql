begin;

do $$
begin
  if to_regclass('public.loyalty_rewards') is null
     or to_regclass('public.loyalty_packages') is null
     or to_regclass('public.loyalty_package_credits') is null
     or to_regclass('public.loyalty_memberships') is null
     or to_regclass('public.customer_connections') is null
     or to_regprocedure('public.loyalty_expire_due_reward(uuid)') is null then
    raise exception 'Ringo Loyalty expiry prerequisite missing: the approved 2026-10-21 loyalty migration must be applied first';
  end if;
end;
$$;

create table public.loyalty_expiry_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.ringo_customers(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_kind text not null check (subject_kind in ('reward', 'package')),
  subject_id uuid not null,
  event text not null check (event in ('reward_expiring', 'reward_expired', 'package_expired')),
  reported boolean not null,
  created_at timestamptz not null default now(),
  unique (subject_kind, subject_id, event),
  constraint loyalty_expiry_log_kind_event check (
    (subject_kind = 'reward' and event in ('reward_expiring', 'reward_expired'))
    or (subject_kind = 'package' and event = 'package_expired')
  )
);
create index loyalty_expiry_log_customer_idx
  on public.loyalty_expiry_log (customer_id, created_at desc);

alter table public.loyalty_expiry_log enable row level security;
revoke all on public.loyalty_expiry_log from public, anon, authenticated, service_role;
grant select on public.loyalty_expiry_log to service_role;

create function public.loyalty_sweep_expired(p_limit integer default 200, p_warn_days integer default 3)
returns table (
  out_event text,
  out_customer_id uuid,
  out_profile_id uuid,
  out_subject_id uuid,
  out_title text,
  out_at timestamptz,
  out_remaining integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  r record;
  v_m public.loyalty_memberships%rowtype;
  v_pkg public.loyalty_packages%rowtype;
  v_claimed uuid;
  v_active boolean;
  v_remaining integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid limit';
  end if;
  if p_warn_days is null or p_warn_days < 1 or p_warn_days > 30 then
    raise exception 'invalid warning window';
  end if;

  for r in
    select rw.membership_id
      from public.loyalty_rewards rw
     where rw.status = 'available' and rw.expires_at is not null and rw.expires_at <= now()
     order by rw.expires_at
     limit p_limit
  loop
    select * into v_m from public.loyalty_memberships where id = r.membership_id for update skip locked;
    if found then
      perform public.loyalty_expire_due_reward(r.membership_id);
    end if;
  end loop;

  for r in
    select rw.id, rw.customer_id, rw.profile_id, rw.title_snapshot, rw.expires_at
      from public.loyalty_rewards rw
     where rw.status = 'expired'
       and rw.expires_at is not null
       and rw.expires_at <= now()
       and rw.expires_at > now() - interval '3 days'
       and not exists (
         select 1 from public.loyalty_expiry_log l
          where l.subject_kind = 'reward' and l.subject_id = rw.id and l.event = 'reward_expired')
     order by rw.expires_at
     limit p_limit
  loop
    v_active := exists (
      select 1 from public.customer_connections c
       where c.customer_id = r.customer_id and c.profile_id = r.profile_id and c.status = 'active');
    insert into public.loyalty_expiry_log (customer_id, profile_id, subject_kind, subject_id, event, reported)
    values (r.customer_id, r.profile_id, 'reward', r.id, 'reward_expired', v_active)
    on conflict (subject_kind, subject_id, event) do nothing
    returning id into v_claimed;
    if v_claimed is not null and v_active then
      out_event := 'reward_expired'; out_customer_id := r.customer_id; out_profile_id := r.profile_id;
      out_subject_id := r.id; out_title := r.title_snapshot; out_at := r.expires_at; out_remaining := null;
      return next;
    end if;
  end loop;

  for r in
    select rw.id, rw.customer_id, rw.profile_id, rw.title_snapshot, rw.expires_at
      from public.loyalty_rewards rw
     where rw.status = 'available'
       and rw.expires_at is not null
       and rw.expires_at > now()
       and rw.expires_at <= now() + make_interval(days => p_warn_days)
       and rw.earned_at <= now() - interval '1 day'
       and not exists (
         select 1 from public.loyalty_expiry_log l
          where l.subject_kind = 'reward' and l.subject_id = rw.id and l.event = 'reward_expiring')
     order by rw.expires_at
     limit p_limit
  loop
    v_active := exists (
      select 1 from public.customer_connections c
       where c.customer_id = r.customer_id and c.profile_id = r.profile_id and c.status = 'active');
    insert into public.loyalty_expiry_log (customer_id, profile_id, subject_kind, subject_id, event, reported)
    values (r.customer_id, r.profile_id, 'reward', r.id, 'reward_expiring', v_active)
    on conflict (subject_kind, subject_id, event) do nothing
    returning id into v_claimed;
    if v_claimed is not null and v_active then
      out_event := 'reward_expiring'; out_customer_id := r.customer_id; out_profile_id := r.profile_id;
      out_subject_id := r.id; out_title := r.title_snapshot; out_at := r.expires_at; out_remaining := null;
      return next;
    end if;
  end loop;

  for r in
    select p.id
      from public.loyalty_packages p
     where p.status = 'active' and p.ends_at <= now()
     order by p.ends_at
     limit p_limit
  loop
    select * into v_pkg from public.loyalty_packages where id = r.id for update skip locked;
    if found and v_pkg.status = 'active' and v_pkg.ends_at <= now() then
      update public.loyalty_packages set status = 'expired', updated_at = now() where id = v_pkg.id;
    end if;
  end loop;

  for r in
    select p.id, p.customer_id, p.profile_id, p.name_snapshot, p.ends_at
      from public.loyalty_packages p
     where p.status = 'expired'
       and p.ends_at <= now()
       and p.ends_at > now() - interval '3 days'
       and not exists (
         select 1 from public.loyalty_expiry_log l
          where l.subject_kind = 'package' and l.subject_id = p.id and l.event = 'package_expired')
     order by p.ends_at
     limit p_limit
  loop
    select coalesce(sum(c.total - c.used - c.carried_out), 0)::integer into v_remaining
      from public.loyalty_package_credits c where c.package_id = r.id;
    v_active := exists (
      select 1 from public.customer_connections c
       where c.customer_id = r.customer_id and c.profile_id = r.profile_id and c.status = 'active');
    insert into public.loyalty_expiry_log (customer_id, profile_id, subject_kind, subject_id, event, reported)
    values (r.customer_id, r.profile_id, 'package', r.id, 'package_expired', v_active and v_remaining > 0)
    on conflict (subject_kind, subject_id, event) do nothing
    returning id into v_claimed;
    if v_claimed is not null and v_active and v_remaining > 0 then
      out_event := 'package_expired'; out_customer_id := r.customer_id; out_profile_id := r.profile_id;
      out_subject_id := r.id; out_title := r.name_snapshot; out_at := r.ends_at; out_remaining := v_remaining;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.loyalty_sweep_expired(integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.loyalty_sweep_expired(integer, integer) to service_role;

commit;
