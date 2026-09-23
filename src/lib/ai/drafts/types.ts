import type { createClient } from "@/lib/supabase/server";
import type { AiWorkspace } from "@/lib/ai/types";

// Ringo AI Phase 2 — controlled drafts. The contract every draft type
// implements (see ./registry.ts for the list). The model can only PREPARE a
// draft through a draft tool; a draft is applied only by the owner's explicit
// "Confirm & Apply" click (POST /api/ai/drafts/[id]/apply), which re-runs
// validate + availability here and then calls `apply` with the owner's OWN
// session client — so the existing RLS policies and triggers on
// profiles/products/events remain the authorization boundary, exactly as for
// the Dashboard editor. Adding a draft type = one new file + one registry line
// + the draft_type CHECK in a new additive migration.

export const DRAFT_TYPES = ["profile.update", "product.create", "event.create"] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];

export const DRAFT_STATUSES = ["awaiting_confirmation", "applying", "applied", "failed", "rejected", "expired", "stale"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

/** Why a draft couldn't be prepared — returned to the model so it can ask or explain. */
export type DraftRejection =
  | "invalid_input"
  | "missing_fields"
  | "nothing_to_change"
  | "contact_not_from_user"
  | "feature_unavailable"
  | "plan_limit_reached"
  | "date_in_past"
  | "facts_unavailable";

/** Why a confirmed draft couldn't be applied — shown to the owner (translated). */
export type ApplyFailure =
  | "stale"
  | "feature_unavailable"
  | "plan_limit_reached"
  | "invalid_payload"
  | "facts_unavailable"
  | "write_failed";

export type SessionDb = ReturnType<typeof createClient>;

/**
 * Fresh, server-read facts about the owner's own workspace that draft
 * validation depends on. Loaded with the owner's session client (RLS) and
 * explicitly scoped to the server-resolved profile — never from the model.
 */
export interface DraftFacts {
  category: string | null;
  categories: string[];
  currency: string;
  /** plans.max_products: null = unlimited, 0 = catalog locked (same rule as Editor.tsx). */
  maxProducts: number | null;
  productCount: number;
  eventCount: number;
}

export interface DraftValidationContext {
  facts: DraftFacts;
  /** Everything the OWNER typed in this conversation (never model text) — contact provenance. */
  userText: string[];
  /** Today's date (YYYY-MM-DD, UTC) — injected so validation is deterministic in tests. */
  today: string;
}

export type ValidationResult<P> = { ok: true; payload: P } | { ok: false; reason: DraftRejection; fields?: string[] };

/** One row of the review card. Values are raw; the UI formats them per `kind` in the owner's language. */
export interface DraftChange {
  field: string;
  kind: "text" | "longtext" | "category" | "categories" | "music_role" | "restaurant_subcategory" | "phone" | "email" | "price" | "date";
  before: unknown;
  after: unknown;
  /** Text Ringo AI wrote (bio, descriptions) — labelled as AI-written on the card. */
  generated?: boolean;
}

export type ApplyResult = { ok: true; resultId: string | null; alreadyApplied: boolean } | { ok: false; code: ApplyFailure };

export interface StoredDraftForApply<P> {
  payload: P;
  base: Record<string, unknown> | null;
  targetId: string;
}

export interface DraftDefinition<P> {
  type: DraftType;
  /**
   * The ONLY way a payload is produced: from the model's tool input at draft
   * time, and again on the stored payload at apply time (it must be
   * idempotent — validating a valid payload returns the same payload).
   */
  validate: (raw: unknown, ctx: DraftValidationContext) => ValidationResult<P>;
  /** Plan/feature gate, re-checked at apply time with fresh facts. */
  availability: (facts: DraftFacts, payload: P) => { ok: true } | { ok: false; reason: "feature_unavailable" | "plan_limit_reached" };
  /** Current values of whatever the draft changes (profile.update only). */
  loadBase?: (db: SessionDb, workspace: AiWorkspace, payload: P) => Promise<Record<string, unknown> | null>;
  changes: (payload: P, base: Record<string, unknown> | null) => DraftChange[];
  /** Short, server-built, human-readable summary (stored on the draft). */
  summary: (payload: P) => string;
  /** Names of the fields the draft touches — the only draft detail written to the audit trail. */
  fieldNames: (payload: P) => string[];
  /** Performs the write through the owner's session client (RLS applies). */
  apply: (db: SessionDb, workspace: AiWorkspace, draft: StoredDraftForApply<P>, facts: DraftFacts) => Promise<ApplyResult>;
  /** Where the owner continues in the existing Dashboard after applying. */
  reviewPath: (resultId: string | null) => string;
}
