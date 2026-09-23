import { createClient } from "@/lib/supabase/server";
import type { AiWorkspace } from "@/lib/ai/types";
import { getDraftDefinition } from "./registry";
import { loadDraftFacts, loadOwnerMessages, todayUtc } from "./facts";
import { claimDraft, finishDraft, getOwnDraft, recordDraftEvent } from "./store";
import { toDraftView, type DraftView } from "./view";
import type { ApplyFailure } from "./types";

// Applying a confirmed draft. Called ONLY by POST /api/ai/drafts/[id]/apply —
// i.e. by the owner's explicit "Confirm & Apply" click, after the route has
// re-resolved the session and Ringo AI access (guard.ts). Never reachable
// from the model: there is no apply tool, and chat messages never call this.
//
//   1. load the owner's draft (session client, scoped to user + profile)
//   2. claim it atomically (ai_claim_draft: row lock, status + revision +
//      expiry checks) — a second click / replay / stale revision stops here
//   3. fresh facts + the owner's own messages → re-validate the stored
//      payload (must re-validate to itself) + re-check plan/feature access
//   4. apply through the owner's session client (existing RLS + triggers)
//   5. record applied / failed / stale on the draft + the audit trail

export type ApplyResponse =
  | { ok: true; draft: DraftView; alreadyApplied: boolean }
  | { ok: false; code: ApplyFailure | "not_found" | "already_applied" | "in_progress" | "revision_mismatch" | "discarded" | "expired" | "claim_failed"; draft: DraftView | null };

// Order-independent for object keys (a payload re-built by validation can
// legitimately enumerate keys in a different order than the one stored in
// the draft's JSONB column), but still order-SENSITIVE for arrays (e.g.
// `categories`, where element order is a real, meaningful difference).
export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => same(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(
      (k) => Object.prototype.hasOwnProperty.call(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
    );
  }
  return false;
}

export async function applyDraft(workspace: AiWorkspace, draftId: string, revision: number): Promise<ApplyResponse> {
  const db = createClient();
  const owned = await getOwnDraft(workspace, draftId);
  if (!owned) return { ok: false, code: "not_found", draft: null };
  const def = getDraftDefinition(owned.draft_type);
  if (!def) return { ok: false, code: "not_found", draft: null };

  const claim = await claimDraft(workspace, draftId, revision);
  const view = async () => {
    const fresh = await getOwnDraft(workspace, draftId);
    return fresh ? toDraftView(fresh) : null;
  };
  if (!claim) return { ok: false, code: "claim_failed", draft: toDraftView(owned) };
  switch (claim.outcome) {
    case "claimed":
      break;
    case "applied":
      return { ok: false, code: "already_applied", draft: await view() };
    case "rejected":
      return { ok: false, code: "discarded", draft: await view() };
    case "expired":
      await recordDraftEvent({ draftId, workspace, draftType: owned.draft_type, action: "expired", revision: owned.revision });
      return { ok: false, code: "expired", draft: await view() };
    case "stale":
      return { ok: false, code: "stale", draft: await view() };
    case "in_progress":
      return { ok: false, code: "in_progress", draft: await view() };
    case "revision_mismatch":
      return { ok: false, code: "revision_mismatch", draft: await view() };
    default:
      return { ok: false, code: "not_found", draft: null };
  }

  const payload = claim.payload;
  await recordDraftEvent({ draftId, workspace, draftType: owned.draft_type, action: "apply_started", revision: claim.revision, fields: def.fieldNames(payload) });

  const fail = async (code: ApplyFailure): Promise<ApplyResponse> => {
    const status = code === "stale" ? "stale" : "failed";
    const row = await finishDraft(workspace, draftId, { status, errorCode: code });
    await recordDraftEvent({ draftId, workspace, draftType: owned.draft_type, action: status === "stale" ? "stale" : "apply_failed", revision: claim.revision, errorCode: code });
    return { ok: false, code, draft: row ? toDraftView(row) : await view() };
  };

  try {
    const [facts, ownerText] = await Promise.all([loadDraftFacts(db, workspace), loadOwnerMessages(db, workspace.userId, owned.conversation_id)]);
    if (!facts || !ownerText) return await fail("facts_unavailable");

    // The stored payload passed validation when it was prepared; if it no
    // longer re-validates to itself, the page changed underneath it (e.g.
    // store currency, categories) — stale, never "apply something else".
    const checked = def.validate(payload, { facts, userText: ownerText, today: todayUtc() });
    if (!checked.ok) {
      if (checked.reason === "feature_unavailable" || checked.reason === "plan_limit_reached") return await fail(checked.reason);
      return await fail("stale");
    }
    if (!same(checked.payload, payload)) return await fail("stale");

    const gate = def.availability(facts, payload);
    if (!gate.ok) return await fail(gate.reason);

    const result = await def.apply(db, workspace, { payload, base: claim.base, targetId: claim.target_id as string }, facts);
    if (!result.ok) return await fail(result.code);

    const row = await finishDraft(workspace, draftId, { status: "applied", resultId: result.resultId });
    await recordDraftEvent({ draftId, workspace, draftType: owned.draft_type, action: "applied", revision: claim.revision, resultId: result.resultId, fields: def.fieldNames(payload) });
    return { ok: true, draft: (row ? toDraftView(row) : await view()) as DraftView, alreadyApplied: result.alreadyApplied };
  } catch (error) {
    console.error("ai draft apply crashed:", error instanceof Error ? error.message : error);
    return await fail("write_failed");
  }
}
