-- Rollback for 2026-10-27_ringo_ai_drafts.sql.
-- Removes ONLY the objects that migration created. Nothing else is touched —
-- products, events and profile changes that owners already applied from
-- drafts are ordinary Ringo data and stay exactly as they are.
-- Destroys all pending drafts and the AI draft audit trail.
--
-- IMPORTANT: run this only together with reverting the Phase 2 code; the
-- deployed code's draft tools and apply endpoint need these objects.

drop function if exists public.ai_claim_draft(uuid, uuid, uuid, int, int);
drop function if exists public.ai_create_product_within_limit(uuid, uuid, text, text, numeric);
drop function if exists public.ai_apply_profile_update(uuid, jsonb, jsonb);
drop table if exists public.ai_draft_events;
drop table if exists public.ai_drafts;
drop function if exists public.ai_drafts_guard_terminal();
