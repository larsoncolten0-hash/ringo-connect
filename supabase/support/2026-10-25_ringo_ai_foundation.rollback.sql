-- Rollback for 2026-10-25_ringo_ai_foundation.sql.
-- Removes ONLY the objects that migration created. Nothing that existed
-- before Ringo AI is touched. Destroys all Ringo AI conversations and usage
-- history — run only if you intend to remove Ringo AI entirely.

drop function if exists public.ai_quota_snapshot(uuid);
drop table if exists public.ai_feedback;
drop table if exists public.ai_usage_events;
drop table if exists public.ai_messages;
drop table if exists public.ai_conversations;
drop table if exists public.ai_beta_access;
drop table if exists public.ai_settings;
