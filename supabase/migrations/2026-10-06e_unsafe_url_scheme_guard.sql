-- ============================================================================
-- Ringo Connect - security: refuse executable URL schemes in creator-supplied link columns
--
-- REQUIRES OWNER APPROVAL AND MANUAL APPLICATION. Additive: ONE new function and up to six BEFORE INSERT / UPDATE triggers.
-- No row, column, policy or grant is changed. Roll back with supabase/support/2026-10-06e_unsafe_url_scheme_guard.rollback.sql.
--
-- THE PROBLEM
--   (community_announcements.link_url is covered too: a creator-typed announcement link becomes the button in the email and the push link.)
--   The dashboard editor saves products.landing_url, tracks.buy_url / external_url and events.ticket_url straight to Supabase
--   from the browser, with no server-side validation, and the public pages render them as <a href={...}> / window.open().
--   React 18 still runs a javascript: href, so a creator (or anyone with a free account calling the REST API with their own
--   JWT) could store  javascript:...  and run script in every visitor's browser on the main origin when they click the button.
--   The application now validates on save and again on render (src/lib/linkUrl.ts, normalizeLinkUrl / safeExternalUrl); this
--   closes the REST-API route, which no client-side check can.
--
-- THE RULE (the platform's existing one, lib/linkUrl.ts): a value is refused if it starts with a URL scheme other than
--   http, https, mailto, tel, sms, whatsapp. A value with no scheme at all ("example.com") is allowed: the application adds
--   https:// when it renders it. Browsers ignore tabs, line breaks, spaces and control characters while reading a scheme
--   ("java<TAB>script:" runs as javascript:), so those are stripped before the check.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT
--   A CHECK is re-evaluated for EVERY update of a row, so one legacy row holding a value that predates the rule would make
--   every unrelated edit of that row fail (the dashboard, the AI product update, a price change...). This trigger validates a
--   column only when its value is being SET or CHANGED, so existing rows keep working untouched and any new unsafe value is
--   refused. It applies to every caller, the service role included.
-- ============================================================================

create or replace function public.reject_unsafe_url_columns() returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_col text;
  v_new text;
  v_old text;
  v_scheme text;
begin
  foreach v_col in array tg_argv loop
    v_new := to_jsonb(new) ->> v_col;
    if v_new is null or btrim(v_new) = '' then
      continue;
    end if;
    if tg_op = 'UPDATE' then
      v_old := to_jsonb(old) ->> v_col;
      if v_new is not distinct from v_old then
        continue; -- a value that was already there (and may predate this rule) is not re-judged
      end if;
    end if;
    v_scheme := substring(lower(regexp_replace(v_new, '[\x01-\x20\x7f]', '', 'g')) from '^([a-z][a-z0-9+.-]*):');
    if v_scheme is not null and v_scheme not in ('http', 'https', 'mailto', 'tel', 'sms', 'whatsapp') then
      raise exception 'unsafe_url_scheme' using errcode = '23514', detail = v_col;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.reject_unsafe_url_columns() from public, anon, authenticated, service_role;

do $$
declare
  r record;
  v_missing text := '';
begin
  for r in
    select * from (values
      ('products',     'landing_url',                    'trg_a_unsafe_url_products'),
      ('tracks',       'buy_url,external_url',           'trg_a_unsafe_url_tracks'),
      ('events',       'ticket_url',                     'trg_a_unsafe_url_events'),
      ('links',        'url',                            'trg_a_unsafe_url_links'),
      ('social_links', 'url',                            'trg_a_unsafe_url_social_links'),
      ('community_announcements', 'link_url',            'trg_a_unsafe_url_community_announcements')
    ) as t(tbl, cols, trg)
  loop
    if to_regclass('public.' || r.tbl) is null
       or (select count(*) from information_schema.columns
            where table_schema = 'public' and table_name = r.tbl and column_name = any (string_to_array(r.cols, ','))) <> cardinality(string_to_array(r.cols, ',')) then
      v_missing := v_missing || ' ' || r.tbl;
      continue;
    end if;
    execute format('drop trigger if exists %I on public.%I', r.trg, r.tbl);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.reject_unsafe_url_columns(%s)',
                   r.trg, r.tbl, (select string_agg(quote_literal(c), ', ') from unnest(string_to_array(r.cols, ',')) c));
  end loop;
  if v_missing <> '' then
    raise notice 'unsafe-URL guard skipped (table or column not present in this database):%', v_missing;
  end if;
end $$;
