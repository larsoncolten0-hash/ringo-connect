-- ROLLBACK for 2026-12-24_card_appointments_card_choice.sql — FOR OWNER REVIEW; do not run unless rolling back.
--
-- Drops the new function, puts card_appt_set_status back EXACTLY as 2026-12-23 defined it (same checks, same transitions, same notification clearing; it simply stops returning the
-- receipt fields), and drops the two card columns (the chosen card of existing requests is lost; everything else about them stays). Touches nothing else. Safe to re-run.
-- After a rollback the code must be the version without the card choice (it calls card_appt_create_with_card first and falls back to card_appt_create when that function is missing).
begin;

drop function if exists public.card_appt_create_with_card(uuid, text, text, text, text, text, text, text, integer);

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
  return jsonb_build_object('result', 'ok', 'status', p_to, 'from', v.status, 'conversation_id', v.conversation_id, 'profile_id', v.profile_id, 'lang', v.lang);
end;
$$;

alter table public.card_appointments drop column if exists card_price_xaf;
alter table public.card_appointments drop column if exists card_tier;

commit;
