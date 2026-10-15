-- Card appointments: the card the customer chose — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Builds on 2026-12-23_card_appointments.sql (already applied; that file is NOT edited). Purely additive:
--   * TWO new nullable columns on card_appointments:  card_tier ('standard' | 'pro' | 'premium')  and  card_price_xaf (the live price when the customer chose, a snapshot).
--   * ONE new function  card_appt_create_with_card(...)  = the existing, reviewed card_appt_create(...) plus the two card fields. It VALIDATES the card fields (both or neither, a known
--     tier, a sane price) and then calls card_appt_create, so every rule that function enforces (the conversation's own verified WhatsApp number, validation, one open request per
--     conversation, idempotency, the audit event) is inherited, not copied. The card is written in the same transaction, only for a request that was just created.
--   * card_appt_set_status(...) is REPLACED by the same function with the same signature, same checks, same transitions, same notification-clearing, same audit event: the only
--     difference is that a successful change also returns the customer's name, time, place and card, which is what the receipt message needs.
-- Nothing else changes: no table, column, policy, index or other function is created, altered or dropped. Existing rows keep NULL card fields. The old card_appt_create keeps working,
-- so the deploy order cannot break the bot: apply this file first, then deploy the code.
--
-- ACCESS is unchanged (SELECT-only RLS for the owner and staff with inbox.view; no write privilege for any API role; the new function is service_role only).
-- Depends on: 2026-12-23_card_appointments.sql.
-- Rollback: supabase/support/2026-12-24_card_appointments_card_choice.rollback.sql

begin;

alter table public.card_appointments add column if not exists card_tier text check (card_tier is null or card_tier in ('standard', 'pro', 'premium'));
alter table public.card_appointments add column if not exists card_price_xaf integer check (card_price_xaf is null or (card_price_xaf > 0 and card_price_xaf <= 10000000));

-- ============================================================================
-- 1. SUBMIT A REQUEST WITH THE CHOSEN CARD
--    Returns the same jsonb as card_appt_create: { result: 'created' | 'exists' | 'invalid' | 'skip', id, status, profile_id }.
-- ============================================================================
create or replace function public.card_appt_create_with_card(p_conversation_id uuid, p_name text, p_phone text, p_time text, p_place text, p_note text, p_lang text, p_card_tier text, p_card_price integer)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_res jsonb;
begin
  -- both or neither; a known tier; a sane price
  if (p_card_tier is null) <> (p_card_price is null) then return jsonb_build_object('result', 'invalid'); end if;
  if p_card_tier is not null and (p_card_tier not in ('standard', 'pro', 'premium') or p_card_price < 1 or p_card_price > 10000000) then
    return jsonb_build_object('result', 'invalid');
  end if;

  v_res := public.card_appt_create(p_conversation_id, p_name, p_phone, p_time, p_place, p_note, p_lang);

  -- only for a request that was created by THIS call (a repeat returns the existing one untouched)
  if v_res ->> 'result' = 'created' and p_card_tier is not null then
    update public.card_appointments set card_tier = p_card_tier, card_price_xaf = p_card_price, updated_at = now() where id = (v_res ->> 'id')::uuid;
  end if;
  return v_res;
end;
$$;

-- ============================================================================
-- 2. CONFIRM / DECLINE / CANCEL / COMPLETE: identical to 2026-12-23, plus the receipt fields in the success answer
-- ============================================================================
create or replace function public.card_appt_set_status(p_actor_user_id uuid, p_appointment_id uuid, p_to text, p_details text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.card_appointments%rowtype;
  v_rel text;
  v_details text := nullif(btrim(regexp_replace(regexp_replace(coalesce(p_details, ''), '[[:cntrl:]]+', ' ', 'g'), '[[:space:]]+', ' ', 'g')), '');
begin
  if p_actor_user_id is null or p_appointment_id is null then return jsonb_build_object('result', 'not_found'); end if;
  if p_to is null or p_to not in ('confirmed', 'declined', 'cancelled', 'completed') then return jsonb_build_object('result', 'invalid'); end if;
  if v_details is not null and char_length(v_details) > 300 then return jsonb_build_object('result', 'invalid'); end if;

  select * into v from public.card_appointments a where a.id = p_appointment_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  -- the owner of the organization, or a team member with inbox.reply (Team plan, active membership of THIS organization): decided here, whatever the caller checked before
  v_rel := public.inbox_actor_access(p_actor_user_id, v.conversation_id, 'inbox.reply');
  if v_rel not in ('owner', 'member') then
    return jsonb_build_object('result', case when v_rel = 'forbidden' then 'forbidden' else 'not_found' end);
  end if;

  if v.status = p_to then
    return jsonb_build_object('result', 'noop', 'status', v.status, 'conversation_id', v.conversation_id, 'profile_id', v.profile_id, 'lang', v.lang);
  end if;
  if not ((v.status = 'pending' and p_to in ('confirmed', 'declined', 'cancelled')) or (v.status = 'confirmed' and p_to in ('cancelled', 'completed'))) then
    return jsonb_build_object('result', 'invalid_transition', 'status', v.status);
  end if;

  update public.card_appointments
     set status = p_to, decided_by = p_actor_user_id, decided_at = now(), decision_details = v_details, updated_at = now(),
         customer_notify_status = null, customer_notified_at = null   -- the outcome of telling the customer belongs to the previous status: it is cleared with the change, atomically
   where id = v.id;
  insert into public.card_appointment_events (appointment_id, actor_kind, actor_user_id, from_status, to_status, note)
  values (v.id, case when v_rel = 'owner' then 'owner' else 'staff' end, p_actor_user_id, v.status, p_to, v_details);
  return jsonb_build_object('result', 'ok', 'status', p_to, 'from', v.status, 'conversation_id', v.conversation_id, 'profile_id', v.profile_id, 'lang', v.lang,
                            'customer_name', v.customer_name, 'preferred_time', v.preferred_time, 'meeting_place', v.meeting_place, 'card_tier', v.card_tier, 'card_price_xaf', v.card_price_xaf);
end;
$$;

do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('card_appt_create_with_card', 'card_appt_set_status')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

commit;
