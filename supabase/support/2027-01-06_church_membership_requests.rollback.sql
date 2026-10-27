-- ROLLBACK for 2027-01-06_church_membership_requests.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Removes exactly what that migration added: the additional update policy, the decision trigger and function, the request function and the two decision columns of church_members.
-- It touches no other column, row, policy, trigger or function. EVERY MEMBER ROW IS KEPT, including the pending requests and the people already approved: only the stamps "who settled it, and when"
-- (decided_at, decided_by) are lost. After the rollback a pending join request can no longer be approved by staff (the Phase 2A policy covers manual and invite rows only) until the migration is applied again.
--
-- DATA SAFETY: this file REFUSES to run while any decision stamp exists, so the audit trail is never dropped by accident. To drop it anyway, confirm the loss explicitly by adding this line as the FIRST
-- statement inside the transaction (same script, same transaction):
--     select set_config('church_requests.allow_data_loss', 'yes', true);
-- Safe to re-run: every drop is "if exists".
begin;

set local lock_timeout = '5s';

do $$
declare
  v_marker constant text := 'managed by 2027-01-06_church_membership_requests.sql';
  v_stamps bigint := 0;
  v_bad text;
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'church_members' and column_name = 'decided_at') then
    select count(*) into v_stamps from public.church_members where decided_at is not null;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('church_member_decision_guard', 'church_request_membership') and coalesce(obj_description(p.oid, 'pg_proc'), '') <> v_marker;
  if v_bad is not null then raise exception 'rollback refused: function(s) % exist but are not managed by this migration', v_bad; end if;
  if v_stamps > 0 and coalesce(current_setting('church_requests.allow_data_loss', true), '') <> 'yes' then
    raise exception 'rollback refused: % decision stamp(s) exist. Confirm the loss with: select set_config(''church_requests.allow_data_loss'', ''yes'', true);', v_stamps;
  end if;
end $$;

drop policy if exists church_members_update_requests on public.church_members;
drop trigger if exists church_members_decision_guard_trg on public.church_members;
drop function if exists public.church_request_membership(uuid, uuid, text);
drop function if exists public.church_member_decision_guard();
alter table public.church_members drop column if exists decided_by;
alter table public.church_members drop column if exists decided_at;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'church_members' and column_name in ('decided_at', 'decided_by')) then raise exception 'rollback postcondition failed: a column is still there'; end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('church_member_decision_guard', 'church_request_membership')) then raise exception 'rollback postcondition failed: a function is still there'; end if;
  if exists (select 1 from pg_policy where polname = 'church_members_update_requests') then raise exception 'rollback postcondition failed: the policy is still there'; end if;
  if (select count(*) from pg_policy where polrelid = 'public.church_members'::regclass and polname in ('church_members_update', 'church_members_insert', 'church_members_delete', 'church_members_children_only', 'church_members_no_platform_admin')) <> 5 then
    raise exception 'rollback postcondition failed: a Phase 2A policy of the roster is missing';
  end if;
end $$;

commit;
