-- ============================================================================
-- Ringo Connect - security (Phase 3): a creator can only point a paid file at THEIR OWN storage folder
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. Additive: one function and two BEFORE INSERT / UPDATE triggers. No policy, grant, column, row or
-- existing function is changed. Roll back with supabase/support/2026-10-07b_private_file_path_ownership_guard.rollback.sql and check it with
-- supabase/support/2026-10-07b_private_file_path_ownership_guard.verify.sql (read-only).
--
-- THE PROBLEM (confirmed from the repository)
--   Paid downloads live in two PRIVATE buckets (protected-audio, digital-products). Their storage policies only let a user touch the folder named after
--   their own user id, and there is no read policy: reads happen in two server routes that sign a short-lived URL with the SERVICE ROLE, which bypasses
--   storage RLS, after checking that an order paid for the item:
--       /api/music/tracks/[id]/audio     signs tracks.protected_audio_path
--       /api/products/download           signs the snapshot of products.digital_file_path taken when the order is created
--   Both routes sign whatever string is stored in that column, and nothing validates it:
--     * tracks / products "owner write" RLS (FOR ALL) lets the owner write ANY value to any column through the REST API;
--     * tracks / products are publicly readable ("for select using (true)"), so every creator's protected_audio_path / digital_file_path is public;
--     * music_orders / music_order_items are "owner all", so the seller can even create their own "paid" order with no payment.
--   Attack (any creator account, no payment needed on music): read a victim's tracks.protected_audio_path (or products.digital_file_path), set it on the
--   attacker's own track / digital product, create or buy an order for that item, call the download route, and receive a signed URL for the VICTIM's
--   paid file. The service role signs it, so the storage policy that protects the victim's folder is never consulted.
--
-- THE FIX - validate the value where it is written, in the database (the routes and the editor are unchanged)
--   For a write by a signed-in end user (auth.uid() is not null; the service role carries no user and is unaffected, exactly as in the Phase 2 and Inbox
--   guards), whenever the file path is set or changed to a non-empty value, it must be a path inside a folder the writer legitimately owns:
--       <auth.uid()>/...                       the caller's own folder (the editor builds <userId>/tracks-protected/<uuid>.<ext>), or
--       <owner of the row's profile>/...       the business owner's folder (a staff member editing the owner's product keeps working)
--   and it may not contain "..", a leading "/", or a backslash. Platform admins are exempt (they can already write any row). Clearing the path, or
--   leaving it unchanged, is always allowed, so existing rows and every unrelated edit are untouched.
--   Storage policies already guarantee nobody but the folder's owner can ever put an object into that folder, so "my folder" == "my file".
-- ============================================================================

create or replace function public.private_file_path_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_col text := tg_argv[0];                -- the column this trigger guards ('protected_audio_path' or 'digital_file_path')
  v_new text := to_jsonb(new) ->> tg_argv[0];
  v_old text;
  v_prefix text;
begin
  if auth.uid() is null then return new; end if;             -- the service role / direct database access: no end-user identity
  if v_new is null or btrim(v_new) = '' then return new; end if; -- clearing the file is always allowed
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) ->> tg_argv[0];
    if v_new is not distinct from v_old then return new; end if; -- unchanged: not this guard's business
  end if;
  if public.is_admin() then return new; end if;

  v_prefix := split_part(v_new, '/', 1);
  if v_new like '/%' or position('\' in v_new) > 0 or v_new ~ '(^|/)\.\.(/|$)' or position('/' in v_new) = 0 or char_length(v_new) <= char_length(v_prefix) + 1 then
    raise exception 'private_file_path_ownership' using errcode = '42501', detail = v_col || ' is not a valid storage path';
  end if;
  if v_prefix = auth.uid()::text
     or exists (select 1 from public.profiles p where p.id = (to_jsonb(new) ->> 'profile_id')::uuid and p.user_id::text = v_prefix) then
    return new;
  end if;
  raise exception 'private_file_path_ownership' using errcode = '42501', detail = v_col || ' must point inside your own storage folder';
end;
$$;

revoke all on function public.private_file_path_guard() from public, anon, authenticated, service_role;

drop trigger if exists tracks_protected_audio_path_guard_trg on public.tracks;
create trigger tracks_protected_audio_path_guard_trg before insert or update of protected_audio_path on public.tracks
  for each row execute function public.private_file_path_guard('protected_audio_path');
drop trigger if exists products_digital_file_path_guard_trg on public.products;
create trigger products_digital_file_path_guard_trg before insert or update of digital_file_path on public.products
  for each row execute function public.private_file_path_guard('digital_file_path');

-- Postconditions (structure only: this migration writes to no live row, so there is nothing to undo).
do $$
declare
  v_bad text;
begin
  select string_agg(t.tgname, ', ') into v_bad
    from (values ('public.tracks'::regclass, 'tracks_protected_audio_path_guard_trg'),
                 ('public.products'::regclass, 'products_digital_file_path_guard_trg')) t(rel, tgname)
   where not exists (select 1 from pg_trigger g where g.tgrelid = t.rel and g.tgname = t.tgname and g.tgenabled = 'O' and not g.tgisinternal);
  if v_bad is not null then
    raise exception 'postcondition failed: trigger missing or disabled: %', v_bad;
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.pronamespace = 'public'::regnamespace and p.proname = 'private_file_path_guard'
                and a.privilege_type = 'EXECUTE' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated', 'service_role'))) then
    raise exception 'postcondition failed: an API role can EXECUTE private_file_path_guard';
  end if;
end $$;
