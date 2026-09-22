// PHASE 2/3 CONTRACTS — types only, nothing here is wired up yet.
//
// Every future Ringo AI action follows one path:
//   model proposes → server builds an AiActionDraft (validated, stored, not
//   applied) → the user reviews it in the UI → the user confirms → the
//   server executes it through Ringo's EXISTING logic (the same API route or
//   lib function the Dashboard uses) → result shown.
// The model never executes anything and never writes Ringo data directly;
// confirmation is a user click handled by a dedicated endpoint, never a
// model message. Draft tools use AiTool.kind = "draft"; executors are plain
// server code, not model-callable tools.

import type { CategoryId } from "@/lib/categories";

export type AiActionType =
  | "profile.setup"
  | "profile.update"
  | "product.create"
  | "event.create"
  | "menu_item.create"
  | "music_release.prepare"
  | "announcement.prepare";

export type AiActionDraftStatus = "proposed" | "confirmed" | "applied" | "rejected" | "expired" | "failed";

export interface AiActionDraft<Payload = unknown> {
  id: string;
  type: AiActionType;
  /** Always the server-resolved workspace — never from the model. */
  userId: string;
  profileId: string;
  conversationId: string;
  /** Validated against the action's schema before storage. */
  payload: Payload;
  /** What the user sees on the review card, in their language. */
  summary: string;
  status: AiActionDraftStatus;
  createdAt: string;
  expiresAt: string;
}

/**
 * How a confirmed draft is applied. Implementations must call existing
 * Ringo logic (e.g. the same validation and writes as the Editor or
 * /api/... route) — never a parallel code path.
 */
export interface AiActionExecutor<Payload> {
  type: AiActionType;
  /** Server-side validation; returns a clean payload or null. */
  validate: (raw: unknown) => Payload | null;
  /** Where the user reviews/finishes it in the existing UI (safe default). */
  reviewPath: (payload: Payload) => string;
  apply?: (ctx: { userId: string; profileId: string }, payload: Payload) => Promise<{ ok: true } | { ok: false; reason: string }>;
}

/**
 * AI onboarding ("I'm an Afrobeat artist in Cameroon called David…").
 * The model only ever produces this structured extraction; missing fields
 * drive follow-up questions; a complete one becomes a "profile.setup"
 * draft that is applied through Ringo's existing profile editing logic.
 */
export interface ProfileSetupExtraction {
  category: CategoryId | null;
  musicRole: string | null;
  restaurantSubcategory: string | null;
  displayName: string | null;
  bio: string | null;
  location: string | null;
  genre: string | null;
  goals: string[];
  whatsappNumber: string | null;
  missingFields: string[];
  confidence: "low" | "medium" | "high";
}
