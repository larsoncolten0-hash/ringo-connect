import { profileHasTicketing } from "@/lib/categories";
import { isUuid } from "@/lib/customer/connect";
import type { DraftChange, DraftDefinition, DraftValidationContext, ValidationResult } from "./types";

// event.update — edit ONE existing event the caller already owns (title,
// description, date, time, location, and — only while the event has no
// tiered ticket types — its legacy price). Applied through the owner's
// session client with the same columns EventCheckinDashboard's persistField
// writes (RLS "events owner write").
//
// Unlike event.create, editing is NOT rejected for a past date — the human
// editor itself allows correcting an already-passed event, so this mirrors
// that rather than eventCreate.ts's creation-time date_in_past rule.
//
// Price is ambiguous once an event has event_ticket_types rows (which tier?)
// — the RPC itself refuses a price change in that case (outcome
// 'price_locked' → feature_unavailable), atomically, in the same
// transaction as the read that would decide it, so this can never race with
// a ticket tier being added between prepare and confirm.

export interface EventUpdatePayload {
  eventId: string;
  title: string | null;
  description: string | null;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
  price: number | null;
  /** The store currency at draft time; apply refuses if it changed since. */
  currency: string;
}

const MAX_PRICE = 100_000_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function validateEventUpdateDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<EventUpdatePayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_input" };
  const r = raw as Record<string, unknown>;
  const invalid: string[] = [];

  const eventId = typeof r.eventId === "string" ? r.eventId : typeof r.event_id === "string" ? r.event_id : null;
  if (!eventId || !isUuid(eventId)) return { ok: false, reason: "invalid_input", fields: ["event_id"] };

  const text = (v: unknown, max: number): string | null | undefined => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t.length > max ? undefined : t || null;
  };
  const title = text(r.title, 120);
  if (title === undefined) invalid.push("title");
  const description = text(r.description, 1000);
  if (description === undefined) invalid.push("description");
  const location = text(r.location, 160);
  if (location === undefined) invalid.push("location");
  const eventTime = text(r.event_time, 20);
  if (eventTime === undefined) invalid.push("event_time");

  const eventDate = text(r.event_date, 10);
  if (eventDate === undefined) invalid.push("event_date");
  else if (eventDate !== null && !isRealDate(eventDate)) invalid.push("event_date");

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
  const finalDate = eventDate ?? null;
  const finalTime = eventTime ?? null;
  const finalLocation = location ?? null;
  if (finalTitle === null && finalDescription === null && finalDate === null && finalTime === null && finalLocation === null && price === null) {
    return { ok: false, reason: "nothing_to_change" };
  }
  return { ok: true, payload: { eventId, title: finalTitle, description: finalDescription, eventDate: finalDate, eventTime: finalTime, location: finalLocation, price, currency } };
}

export const eventUpdateDraft: DraftDefinition<EventUpdatePayload> = {
  type: "event.update",
  validate: validateEventUpdateDraft,

  availability: (facts) => (profileHasTicketing(facts) ? { ok: true } : { ok: false, reason: "feature_unavailable" }),

  async loadBase(db, workspace, payload) {
    const { data, error } = await db
      .from("events")
      .select("title, description, event_date, event_time, location, price")
      .eq("id", payload.eventId)
      .eq("profile_id", workspace.profileId)
      .maybeSingle();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  },

  changes(payload, base) {
    const b = base || {};
    const rows: DraftChange[] = [];
    if (payload.title !== null) rows.push({ field: "event_title", kind: "text", before: b.title ?? null, after: payload.title });
    if (payload.description !== null) rows.push({ field: "event_description", kind: "longtext", before: b.description ?? null, after: payload.description, generated: true });
    if (payload.eventDate !== null) rows.push({ field: "event_date", kind: "date", before: b.event_date ?? null, after: payload.eventDate });
    if (payload.eventTime !== null) rows.push({ field: "event_time", kind: "text", before: b.event_time ?? null, after: payload.eventTime });
    if (payload.location !== null) rows.push({ field: "event_location", kind: "text", before: b.location ?? null, after: payload.location });
    if (payload.price !== null) rows.push({ field: "event_price", kind: "price", before: b.price == null ? null : { amount: Number(b.price), currency: payload.currency }, after: { amount: payload.price, currency: payload.currency } });
    return rows;
  },

  summary(payload) {
    const n = [payload.title, payload.description, payload.eventDate, payload.eventTime, payload.location, payload.price].filter((v) => v !== null).length;
    return `Update event: ${n} field${n === 1 ? "" : "s"}`;
  },

  fieldNames: (payload) =>
    [
      payload.title !== null ? "title" : null,
      payload.description !== null ? "description" : null,
      payload.eventDate !== null ? "event_date" : null,
      payload.eventTime !== null ? "event_time" : null,
      payload.location !== null ? "location" : null,
      payload.price !== null ? "price" : null,
    ].filter((v): v is string => v !== null),

  async apply(db, workspace, draft, facts) {
    if (facts.currency !== draft.payload.currency) return { ok: false, code: "stale" };
    const base = draft.base;
    if (!base) return { ok: false, code: "invalid_payload" };
    const patch: Record<string, unknown> = {};
    if (draft.payload.title !== null) patch.title = draft.payload.title;
    if (draft.payload.description !== null) patch.description = draft.payload.description;
    if (draft.payload.eventDate !== null) patch.event_date = draft.payload.eventDate;
    if (draft.payload.eventTime !== null) patch.event_time = draft.payload.eventTime;
    if (draft.payload.location !== null) patch.location = draft.payload.location;
    if (draft.payload.price !== null) patch.price = draft.payload.price;

    const { data, error } = await db.rpc("ai_apply_event_update", {
      p_event_id: draft.payload.eventId,
      p_profile_id: workspace.profileId,
      p_patch: patch,
      p_base: base,
    });
    if (error) {
      console.error("ai event update draft apply failed:", error.message);
      return { ok: false, code: "write_failed" };
    }
    switch (data) {
      case "updated":
        return { ok: true, resultId: draft.payload.eventId, alreadyApplied: false };
      case "already_applied":
        return { ok: true, resultId: draft.payload.eventId, alreadyApplied: true };
      case "stale":
        return { ok: false, code: "stale" };
      case "price_locked":
        return { ok: false, code: "feature_unavailable" };
      case "not_found":
        return { ok: false, code: "write_failed" };
      default:
        return { ok: false, code: "write_failed" };
    }
  },

  reviewPath: (resultId) => (resultId ? `/dashboard/tickets/${resultId}` : "/dashboard/tickets"),
};
