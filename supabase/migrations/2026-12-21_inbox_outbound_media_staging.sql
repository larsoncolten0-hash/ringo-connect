-- WhatsApp Inbox: private staging bucket for LARGE OUTBOUND VIDEOS — PROPOSED, NOT APPLIED. FOR OWNER REVIEW ONLY.
--
-- Why: Vercel's serverless functions accept about 4.5 MB per request, but WhatsApp accepts videos up to 16 MB (MP4 / 3GPP). A larger video is therefore uploaded by the browser straight to
-- storage with a one-time SIGNED UPLOAD URL that only the server can issue (src/app/api/inbox/conversations/[id]/media/stage), then read back by the server, validated byte for byte,
-- uploaded to Meta and DELETED (src/app/api/inbox/conversations/[id]/media). Without this bucket the Inbox still sends every file up to 4 MB exactly as before; a larger video then
-- gets a clear "large uploads are not enabled yet" message.
--
-- Purely additive: ONE new storage bucket (private) and nothing else. No table, column, function, policy or existing bucket is created, altered or dropped.
--   * public = false             no public URL ever exists for these objects
--   * file_size_limit = 16 MB    Meta's own video limit; the bucket refuses a larger object even if the application check were bypassed
--   * allowed_mime_types         MP4 and 3GPP only
--   * NO storage.objects POLICY is added: anon and authenticated users cannot read, list, write or delete here. Only the service role (the server) and a signed upload URL it issued can write.
--
-- Cleanup: the server deletes the staged copy after every send attempt. A video that was uploaded but never sent stays until removed: delete objects older than a day from
-- this bucket periodically (Supabase Dashboard > Storage, or a scheduled job).
-- Rollback: supabase/support/2026-12-21_inbox_outbound_media_staging.rollback.sql

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inbox-outbound-media', 'inbox-outbound-media', false, 16777216, array['video/mp4', 'video/3gpp'])
on conflict (id) do nothing;

commit;
