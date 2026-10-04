-- WhatsApp outbound media (Phase 9) — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Two NEW server-side functions and nothing else. NO new table, column, index, constraint, trigger or policy; no existing object is modified.
-- The Phase 4 schema already models what is needed: inbox_messages (direction, type, body, status 'queued', provider_message_id,
-- client_request_id, sent_by_user_id) and inbox_message_media (kind, media_id, mime_type, sha256, filename, caption). Outbound media is just an
-- outbound message whose type is the media kind, with the caption in body, plus one metadata row once Meta has accepted it.
--
--   inbox_prepare_outbound_media(actor, conversation, client_request_id, kind, caption)
--       Before anything is uploaded or sent. Creates ONE 'queued' outbound row (idempotent on client_request_id) and returns the recipient and the
--       business phone_number_id, both read from the database. Same ownership, 24-hour window, account and replay rules as the Phase 7 text
--       function. Never accepts a recipient, phone number id, WABA id, token or profile id.
--   inbox_complete_outbound_media(actor, message, provider_message_id, media_id, mime_type, filename, sha256)
--       After Meta ACCEPTED the message. Calls the audited Phase 7 inbox_complete_outbound (wamid, early status events, status ranking, conversation
--       timestamps) and, in the same transaction, stores the media metadata row. If anything fails the whole call rolls back.
--
-- A failed upload or a definite Meta rejection is recorded with the EXISTING inbox_fail_outbound (nothing new needed), so no row is ever left
-- permanently "sent" when Meta refused the file. Ringo stores NO media binary and NO Meta media URL: only the Meta media id and metadata, and
-- storage_status stays 'not_downloaded' (Ringo holds no copy). The caption of an outbound media message lives in inbox_messages.body (the
-- queued/failed row needs it before the media row exists) and is copied to inbox_message_media.caption on completion.
--
-- AUTHORIZATION (same model as Phase 7/8): the Next.js route passes the signed-in user as p_actor_user_id; every function re-derives ownership in
-- the database (conversation/message -> profile -> profiles.user_id = actor) and answers 'not_found' otherwise.
--
-- IDEMPOTENCY: UNIQUE (profile_id, client_request_id) decides. A replay returns the ORIGINAL row (never a second message and never a second media
-- row); the same key with another conversation, kind or caption is 'conflict'. Meta has no idempotency key: as in Phase 7, an unknown outcome
-- after the send leaves the row 'queued' and the application never resends it automatically.
--
-- Depends on: 2026-12-07 (Phase 4 tables, inbox_status_rank), 2026-12-08 (inbox_complete_outbound, inbox_fail_outbound).
-- Rollback: supabase/support/2026-12-10_whatsapp_outbound_media.rollback.sql (drops only these two functions; stored messages and media rows stay).

begin;

-- ============================================================================
-- 1. PREPARE: one queued media row per client_request_id
--    Returns jsonb: { result: 'created' | 'existing' | 'not_found' | 'invalid' | 'conflict' | 'account_disabled' | 'window_closed', ... }
--      created  -> message_id, to (the contact's WhatsApp id), phone_number_id (the business number to send from)
--      existing -> message_id, status, provider_message_id (the original row: the caller must NOT upload or send again)
-- ============================================================================
create or replace function public.inbox_prepare_outbound_media(
  p_actor_user_id uuid, p_conversation_id uuid, p_client_request_id uuid, p_kind text, p_caption text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cv public.inbox_conversations%rowtype;
  v_acct public.wa_accounts%rowtype;
  v_msg public.inbox_messages%rowtype;
  v_caption text := nullif(btrim(coalesce(p_caption, '')), '');
  v_to text;
begin
  if p_actor_user_id is null or p_conversation_id is null or p_client_request_id is null
     or p_kind is null or p_kind not in ('image', 'video', 'audio', 'document') then
    return jsonb_build_object('result', 'invalid');
  end if;

  select cv.* into v_cv
    from public.inbox_conversations cv
    join public.profiles p on p.id = cv.profile_id
   where cv.id = p_conversation_id and p.user_id = p_actor_user_id;
  if not found then return jsonb_build_object('result', 'not_found'); end if;

  -- Replay first: a retry of the same request always gets the original answer.
  select * into v_msg from public.inbox_messages m where m.profile_id = v_cv.profile_id and m.client_request_id = p_client_request_id;
  if found then
    if v_msg.conversation_id <> v_cv.id or v_msg.direction <> 'outbound' or v_msg.type <> p_kind or v_msg.body is distinct from v_caption then
      return jsonb_build_object('result', 'conflict');
    end if;
    return jsonb_build_object('result', 'existing', 'message_id', v_msg.id, 'status', v_msg.status, 'provider_message_id', v_msg.provider_message_id);
  end if;

  -- WhatsApp audio messages cannot carry a caption; the other kinds allow up to 1024 characters.
  if (v_caption is not null and (p_kind = 'audio' or char_length(v_caption) > 1024)) then
    return jsonb_build_object('result', 'invalid');
  end if;

  select * into v_acct from public.wa_accounts a where a.id = v_cv.account_id and a.profile_id = v_cv.profile_id;
  if not found or v_acct.status <> 'active' then return jsonb_build_object('result', 'account_disabled'); end if;

  if v_cv.last_inbound_at is null or v_cv.last_inbound_at < now() - interval '24 hours' then
    return jsonb_build_object('result', 'window_closed');
  end if;

  select c.external_id into v_to from public.inbox_contacts c where c.id = v_cv.contact_id and c.profile_id = v_cv.profile_id;
  if v_to is null then return jsonb_build_object('result', 'invalid'); end if;

  insert into public.inbox_messages (profile_id, conversation_id, channel, direction, type, body, status, sent_by_user_id, client_request_id)
  values (v_cv.profile_id, v_cv.id, 'whatsapp', 'outbound', p_kind, v_caption, 'queued', p_actor_user_id, p_client_request_id)
  on conflict (profile_id, client_request_id) where client_request_id is not null do nothing
  returning * into v_msg;

  if v_msg.id is null then
    -- Lost a race with an identical request: return the winner's row, never a second message.
    select * into v_msg from public.inbox_messages m where m.profile_id = v_cv.profile_id and m.client_request_id = p_client_request_id;
    if v_msg.conversation_id <> v_cv.id or v_msg.type <> p_kind or v_msg.body is distinct from v_caption then return jsonb_build_object('result', 'conflict'); end if;
    return jsonb_build_object('result', 'existing', 'message_id', v_msg.id, 'status', v_msg.status, 'provider_message_id', v_msg.provider_message_id);
  end if;

  return jsonb_build_object('result', 'created', 'message_id', v_msg.id, 'to', v_to, 'phone_number_id', v_acct.phone_number_id);
end;
$$;

-- ============================================================================
-- 2. COMPLETE: Meta accepted the media message (it returned a wamid)
--    Returns text: 'ok' | 'duplicate' | 'conflict' | 'not_found' | 'invalid'
--    The wamid, status, early events and conversation timestamps are handled by the audited Phase 7 function; this wrapper adds the metadata row.
-- ============================================================================
create or replace function public.inbox_complete_outbound_media(
  p_actor_user_id uuid, p_message_id uuid, p_provider_message_id text, p_media_id text, p_mime_type text, p_filename text, p_sha256 text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_m public.inbox_messages%rowtype;
  v_media text := nullif(btrim(coalesce(p_media_id, '')), '');
  v_res text;
begin
  if p_actor_user_id is null or p_message_id is null or v_media is null or char_length(v_media) > 256 then return 'invalid'; end if;

  select m.* into v_m
    from public.inbox_messages m
    join public.profiles p on p.id = m.profile_id
   where m.id = p_message_id and m.direction = 'outbound' and m.type in ('image', 'video', 'audio', 'document') and p.user_id = p_actor_user_id;
  if not found then return 'not_found'; end if;

  v_res := public.inbox_complete_outbound(p_actor_user_id, p_message_id, p_provider_message_id);

  if v_res in ('ok', 'duplicate') then
    insert into public.inbox_message_media (message_id, profile_id, kind, media_id, mime_type, sha256, filename, caption, storage_status)
    values (v_m.id, v_m.profile_id, v_m.type, v_media, left(nullif(btrim(coalesce(p_mime_type, '')), ''), 128), left(nullif(btrim(coalesce(p_sha256, '')), ''), 128),
            left(nullif(btrim(coalesce(p_filename, '')), ''), 255), left(v_m.body, 1024), 'not_downloaded')
    on conflict (message_id) do nothing;
  end if;

  return v_res;
end;
$$;

-- ============================================================================
-- 3. GRANTS: service_role only (same convention as 2026-12-07/08/09)
-- ============================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('inbox_prepare_outbound_media', 'inbox_complete_outbound_media')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

commit;
