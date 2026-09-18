-- ============================================================================
-- B1 ROLLBACK. Removes ONLY objects the B1 migration created. Legacy data, the earn/redeem RPCs,
-- existing RLS, existing privileges, cards, payments, notifications and Phase A are not touched.
--
-- TECHNICAL ROLLBACK (right after deployment, nothing used yet): run as-is. It REFUSES if any plan,
-- membership, audit row or managed member exists.
--
-- PRODUCTION ROLLBACK (real membership data exists): this DESTROYS that history. Prefer the soft
-- switch first: set config membership_enabled=false per Association (no schema change, nothing lost).
-- To remove the schema anyway: EXPORT association_membership_plans, association_memberships and
-- association_audit_log first, then put   select set_config('assoc_b1.rollback_with_data', 'yes', true);
-- as the line right after `begin;` below. Managed members that were not active stay status='disabled'
-- afterwards; list them BEFORE rolling back with:
--   select id, name, lifecycle_state, status from public.association_members where lifecycle_state is not null;
-- ============================================================================
begin;

do $$
begin
  if coalesce(current_setting('assoc_b1.rollback_with_data', true), '') <> 'yes'
     and (exists (select 1 from public.association_membership_plans)
          or exists (select 1 from public.association_memberships)
          or exists (select 1 from public.association_audit_log)
          or exists (select 1 from public.association_members where lifecycle_state is not null)) then
    raise exception 'B1 rollback refused: membership data exists. Export it, or disable the module per Association (membership_enabled=false).';
  end if;
end $$;

drop trigger if exists trg_association_members_lifecycle on public.association_members;
drop trigger if exists trg_association_members_points_guard on public.association_members;
drop view if exists public.association_memberships_effective;

drop function if exists public.association_update_membership_settings(uuid, uuid, boolean, text);
drop function if exists public.association_create_plan(uuid, uuid, text, text, text, text, numeric, text, int, int, int);
drop function if exists public.association_update_plan(uuid, uuid, text, text, text, text, numeric, text, int, int, int);
drop function if exists public.association_set_plan_active(uuid, uuid, boolean);
drop function if exists public.association_start_membership(uuid, uuid, uuid, uuid, timestamptz);
drop function if exists public.association_activate_membership(uuid, uuid);
drop function if exists public.association_suspend_membership(uuid, uuid, text);
drop function if exists public.association_reinstate_membership(uuid, uuid);
drop function if exists public.association_renew_membership(uuid, uuid, uuid);
drop function if exists public.association_cancel_membership(uuid, uuid, text);
drop function if exists public.association_expire_memberships(uuid, uuid, int);
drop function if exists public._assoc_materialize_expiry(uuid, uuid);
drop function if exists public._assoc_audit(uuid, uuid, text, text, uuid, uuid, jsonb, jsonb);
drop function if exists public._assoc_actor_can(uuid, uuid, text);
drop function if exists public._assoc_membership_enabled(uuid);
drop function if exists public.association_members_lifecycle_guard();
drop function if exists public.association_members_points_guard();
drop function if exists public.association_membership_effective_state(public.association_memberships);

drop table if exists public.association_memberships;
drop table if exists public.association_membership_plans;
drop table if exists public.association_audit_log;
drop function if exists public.association_memberships_insert_guard();
drop function if exists public.association_memberships_update_guard();
drop function if exists public.association_audit_block_update();

alter table public.association_members drop constraint if exists association_members_lifecycle_status_check;
alter table public.association_members drop constraint if exists association_members_lifecycle_state_check;
drop index if exists public.association_members_id_association_id_uidx;
alter table public.association_members drop column if exists lifecycle_changed_at;
alter table public.association_members drop column if exists lifecycle_state;
alter table public.associations drop column if exists membership_seq;
update public.associations set config = config - 'membership_enabled' - 'membership_number_prefix'
 where config ? 'membership_enabled' or config ? 'membership_number_prefix';

commit;
