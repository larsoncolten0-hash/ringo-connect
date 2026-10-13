-- VERIFY for 2026-12-21_inbox_outbound_media_staging.sql — READ-ONLY (a single SELECT). FOR OWNER REVIEW; run once AFTER the migration is applied.
-- Every row must show ok = true.

with
b as (select * from storage.buckets where id = 'inbox-outbound-media'),
checks(label, expect, actual) as (
  select '01 the bucket exists exactly once', '1', (select count(*)::text from b)
  union all select '02 it is private', 'false', (select coalesce((select public::text from b), 'missing'))
  union all select '03 it is capped at 16 MB (Meta''s video limit)', '16777216', (select coalesce((select file_size_limit::text from b), 'missing'))
  union all select '04 only MP4 and 3GPP are allowed', 'video/3gpp,video/mp4', (select coalesce((select array_to_string(array(select unnest(allowed_mime_types) order by 1), ',') from b), 'missing'))
  union all select '05 no policy lets anon or authenticated users touch objects in it', '0',
         (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%inbox-outbound-media%')
)
select label, expect, actual, (expect = actual) as ok from checks order by label;
