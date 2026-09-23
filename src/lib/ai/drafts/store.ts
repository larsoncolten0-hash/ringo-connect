import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { AiLocale, AiWorkspace } from "@/lib/ai/types";
import { DRAFT_VIEW_COLUMNS, type DraftRow } from "./view";
import type { DraftType } from "./types";

// Draft persistence. Same posture as conversations.ts: reads use the owner's
// session client (RLS: own rows only) PLUS explicit user/profile filters;
// writes use the service role, always with user_id/profile_id taken from the
// server-resolved workspace — never from the model or the request body.
// These functions only ever touch ai_drafts / ai_draft_events; the owner's
// real Ringo data is written solely by the apply endpoint, via the owner's
// session client.

export type DraftAuditAction = "created" | "updated" | "discarded" | "apply_started" | "applied" | "apply_failed" | "stale" | "expired";

export async function recordDraftEvent(e: {
  draftId: string;
  workspace: AiWorkspace;
  draftType: string;
  action: DraftAuditAction;
  revision?: number | null;
  resultId?: string | null;
  errorCode?: string | null;
  fields?: string[];
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("ai_draft_events")
    .insert({
      draft_id: e.draftId,
      user_id: e.workspace.userId,
      profile_id: e.workspace.profileId,
      draft_type: e.draftType.slice(0, 40),
      action: e.action,
      revision: e.revision ?? null,
      result_id: e.resultId ?? null,
      error_code: e.errorCode ? e.errorCode.slice(0, 60) : null,
      // Field NAMES only — never values (no contact details, no text).
      metadata: e.fields ? { fields: e.fields.slice(0, 20) } : {},
    });
  if (error) console.error("recordDraftEvent failed:", error.message);
}

export async function insertDraft(input: {
  workspace: AiWorkspace;
  conversationId: string;
  type: DraftType;
  payload: unknown;
  base: Record<string, unknown> | null;
  summary: string;
  locale: AiLocale;
}): Promise<DraftRow> {
  const { data, error } = await createAdminClient()
    .from("ai_drafts")
    .insert({
      user_id: input.workspace.userId,
      profile_id: input.workspace.profileId,
      conversation_id: input.conversationId,
      draft_type: input.type,
      payload: input.payload,
      base: input.base,
      summary: input.summary.slice(0, 300),
      locale: input.locale,
    })
    .select(DRAFT_VIEW_COLUMNS)
    .single();
  if (error || !data) throw new Error(`insertDraft failed: ${error?.message}`);
  return data as DraftRow;
}

/** One of the owner's drafts — optionally only if it belongs to the given conversation. */
export async function getOwnDraft(workspace: AiWorkspace, draftId: string, conversationId?: string): Promise<(DraftRow & { conversation_id: string }) | null> {
  let q = createClient()
    .from("ai_drafts")
    .select(`${DRAFT_VIEW_COLUMNS}, conversation_id`)
    .eq("id", draftId)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId);
  if (conversationId) q = q.eq("conversation_id", conversationId);
  const { data } = await q.maybeSingle();
  return (data as (DraftRow & { conversation_id: string }) | null) ?? null;
}

export async function listConversationDrafts(workspace: AiWorkspace, conversationId: string): Promise<DraftRow[]> {
  const { data, error } = await createClient()
    .from("ai_drafts")
    .select(DRAFT_VIEW_COLUMNS)
    .eq("conversation_id", conversationId)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) console.error("listConversationDrafts failed:", error.message);
  return (data || []) as DraftRow[];
}

const EDITABLE: readonly string[] = ["awaiting_confirmation", "failed", "stale"];

/** Revises a draft in place (new payload → revision + 1). Optimistic on the revision the caller read. */
export async function reviseDraft(workspace: AiWorkspace, draft: DraftRow, next: { payload: unknown; base: Record<string, unknown> | null; summary: string }): Promise<DraftRow | null> {
  if (!EDITABLE.includes(draft.status)) return null;
  const { data, error } = await createAdminClient()
    .from("ai_drafts")
    .update({
      payload: next.payload,
      base: next.base,
      summary: next.summary.slice(0, 300),
      revision: draft.revision + 1,
      status: "awaiting_confirmation",
      error_code: null,
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", draft.id)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .eq("revision", draft.revision)
    .in("status", EDITABLE as string[])
    .select(DRAFT_VIEW_COLUMNS)
    .maybeSingle();
  if (error) console.error("reviseDraft failed:", error.message);
  return (data as DraftRow | null) ?? null;
}

/** Owner (or the model on their request) discards a draft that hasn't been applied. */
export async function discardDraft(workspace: AiWorkspace, draftId: string): Promise<DraftRow | null> {
  const { data, error } = await createAdminClient()
    .from("ai_drafts")
    .update({ status: "rejected", updated_at: new Date().toISOString() })
    .eq("id", draftId)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .in("status", EDITABLE as string[])
    .select(DRAFT_VIEW_COLUMNS)
    .maybeSingle();
  if (error) console.error("discardDraft failed:", error.message);
  return (data as DraftRow | null) ?? null;
}

export type ClaimOutcome = "claimed" | "not_found" | "applied" | "rejected" | "expired" | "stale" | "in_progress" | "revision_mismatch";

/** The atomic gate every apply goes through (ai_claim_draft, row-locked). */
export async function claimDraft(workspace: AiWorkspace, draftId: string, revision: number) {
  const { data, error } = await createAdminClient().rpc("ai_claim_draft", {
    p_draft_id: draftId,
    p_user_id: workspace.userId,
    p_profile_id: workspace.profileId,
    p_revision: revision,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    if (error) console.error("ai_claim_draft failed:", error.message);
    return null;
  }
  return row as { outcome: ClaimOutcome; draft_type: string | null; payload: unknown; base: Record<string, unknown> | null; target_id: string | null; result_id: string | null; revision: number | null };
}

/** Records the apply result on a claimed draft. */
export async function finishDraft(
  workspace: AiWorkspace,
  draftId: string,
  result: { status: "applied"; resultId: string | null } | { status: "failed" | "stale"; errorCode: string }
): Promise<DraftRow | null> {
  const now = new Date().toISOString();
  const patch =
    result.status === "applied"
      ? { status: "applied", result_id: result.resultId, applied_at: now, error_code: null, updated_at: now }
      : { status: result.status, error_code: result.errorCode, updated_at: now };
  const { data, error } = await createAdminClient()
    .from("ai_drafts")
    .update(patch)
    .eq("id", draftId)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .eq("status", "applying")
    .select(DRAFT_VIEW_COLUMNS)
    .maybeSingle();
  if (error) console.error("finishDraft failed:", error.message);
  return (data as DraftRow | null) ?? null;
}
