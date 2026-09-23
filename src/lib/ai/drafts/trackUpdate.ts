import { profileHasCategory } from "@/lib/categories";
import { isUuid } from "@/lib/customer/connect";
import type { DraftChange, DraftDefinition, DraftValidationContext, ValidationResult } from "./types";

// track.update — edit ONE existing standalone music track (title,
// description, price). Applied through the owner's session client with the
// same columns TrackRow.tsx's persistTrack writes (RLS "tracks owner
// write").
//
// Price is meaningless once a track belongs to a release (release_id set) —
// the Dashboard hides price/buy fields entirely for those, and the order
// route skips them; the bundle's own price on music_releases governs
// commerce instead. The RPC refuses a price change in that case (outcome
// 'release_locked' → feature_unavailable), atomically, so this can never
// race with the track being added to a release between prepare and confirm.
//
// Never touches: protected_audio_path, preview_audio_url, audio_url,
// external_url, buy_url, download_enabled, email_delivery_enabled,
// release_id, available — none of these are "content", all affect
// purchasability/entitlement/delivery and stay Dashboard-only.

export interface TrackUpdatePayload {
  trackId: string;
  title: string | null;
  description: string | null;
  price: number | null;
  /** The store currency at draft time; apply refuses if it changed since. */
  currency: string;
}

const MAX_PRICE = 100_000_000;

export function validateTrackUpdateDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<TrackUpdatePayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_input" };
  const r = raw as Record<string, unknown>;
  const invalid: string[] = [];

  const trackId = typeof r.trackId === "string" ? r.trackId : typeof r.track_id === "string" ? r.track_id : null;
  if (!trackId || !isUuid(trackId)) return { ok: false, reason: "invalid_input", fields: ["track_id"] };

  const title = r.title == null ? null : typeof r.title === "string" ? r.title.trim() || null : undefined;
  if (title === undefined || (title && title.length > 120)) invalid.push("title");

  const description = r.description == null ? null : typeof r.description === "string" ? r.description.trim() || null : undefined;
  if (description === undefined || (description && description.length > 1000)) invalid.push("description");

  const currency = ctx.facts.currency;
  let price: number | null = null;
  if (r.price !== null && r.price !== undefined) {
    const v = typeof r.price === "number" ? r.price : NaN;
    const decimalsOk = currency === "XAF" ? Number.isInteger(v) : Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
    if (!Number.isFinite(v) || v < 0 || v > MAX_PRICE || !decimalsOk) invalid.push("price");
    else price = v;
  }

  if (invalid.length) return { ok: false, reason: "invalid_input", fields: invalid };
  const finalTitle = title ?? null;
  const finalDescription = description ?? null;
  if (finalTitle === null && finalDescription === null && price === null) return { ok: false, reason: "nothing_to_change" };
  return { ok: true, payload: { trackId, title: finalTitle, description: finalDescription, price, currency } };
}

export const trackUpdateDraft: DraftDefinition<TrackUpdatePayload> = {
  type: "track.update",
  validate: validateTrackUpdateDraft,

  availability: (facts) => (profileHasCategory({ category: facts.category, categories: facts.categories }, "music_entertainment") ? { ok: true } : { ok: false, reason: "feature_unavailable" }),

  async loadBase(db, workspace, payload) {
    const { data, error } = await db
      .from("tracks")
      .select("title, description, price")
      .eq("id", payload.trackId)
      .eq("profile_id", workspace.profileId)
      .maybeSingle();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  },

  changes(payload, base) {
    const b = base || {};
    const rows: DraftChange[] = [];
    if (payload.title !== null) rows.push({ field: "track_title", kind: "text", before: b.title ?? null, after: payload.title });
    if (payload.description !== null) rows.push({ field: "track_description", kind: "longtext", before: b.description ?? null, after: payload.description, generated: true });
    if (payload.price !== null) rows.push({ field: "track_price", kind: "price", before: b.price == null ? null : { amount: Number(b.price), currency: payload.currency }, after: { amount: payload.price, currency: payload.currency } });
    return rows;
  },

  summary(payload) {
    const n = [payload.title, payload.description, payload.price].filter((v) => v !== null).length;
    return `Update track: ${n} field${n === 1 ? "" : "s"}`;
  },

  fieldNames: (payload) =>
    [payload.title !== null ? "title" : null, payload.description !== null ? "description" : null, payload.price !== null ? "price" : null].filter((v): v is string => v !== null),

  async apply(db, workspace, draft, facts) {
    if (facts.currency !== draft.payload.currency) return { ok: false, code: "stale" };
    const base = draft.base;
    if (!base) return { ok: false, code: "invalid_payload" };
    const patch: Record<string, unknown> = {};
    if (draft.payload.title !== null) patch.title = draft.payload.title;
    if (draft.payload.description !== null) patch.description = draft.payload.description;
    if (draft.payload.price !== null) patch.price = draft.payload.price;

    const { data, error } = await db.rpc("ai_apply_track_update", {
      p_track_id: draft.payload.trackId,
      p_profile_id: workspace.profileId,
      p_patch: patch,
      p_base: base,
    });
    if (error) {
      console.error("ai track update draft apply failed:", error.message);
      return { ok: false, code: "write_failed" };
    }
    switch (data) {
      case "updated":
        return { ok: true, resultId: draft.payload.trackId, alreadyApplied: false };
      case "already_applied":
        return { ok: true, resultId: draft.payload.trackId, alreadyApplied: true };
      case "stale":
        return { ok: false, code: "stale" };
      case "release_locked":
        return { ok: false, code: "feature_unavailable" };
      case "not_found":
        return { ok: false, code: "write_failed" };
      default:
        return { ok: false, code: "write_failed" };
    }
  },

  reviewPath: () => "/dashboard?section=tracks",
};
