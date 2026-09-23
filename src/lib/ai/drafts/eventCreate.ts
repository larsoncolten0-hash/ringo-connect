import { profileHasTicketing } from "@/lib/categories";
import type { DraftDefinition, DraftValidationContext, ValidationResult } from "./types";

// event.create — one event, created UNPUBLISHED. The same insert
// TicketsEventsList makes (RLS "events owner write"), but always with
// status 'draft': events.status defaults to 'published', and Ringo AI must
// never publish anything. The owner adds ticket types/prices and publishes
// in the existing event editor (/dashboard/tickets/[id]).
// Gated exactly like the Dashboard: profileHasTicketing().

export interface EventDraftPayload {
  title: string;
  /** YYYY-MM-DD (events.event_date is a date). */
  date: string;
  /** Free text, as the event editor stores it (e.g. "8 PM", "20:00"). */
  time: string | null;
  location: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function validateEventDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<EventDraftPayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_input" };
  const r = raw as Record<string, unknown>;
  const invalid: string[] = [];
  const text = (v: unknown, max: number, key: string): string | null => {
    if (v === null || v === undefined) return null;
    if (typeof v !== "string" || v.trim().length > max) {
      invalid.push(key);
      return null;
    }
    return v.trim() || null;
  };

  const title = text(r.title, 120, "title");
  const date = text(r.date, 10, "date");
  const time = text(r.time, 20, "time");
  const location = text(r.location, 160, "location");
  if (date && !isRealDate(date)) invalid.push("date");

  if (invalid.length) return { ok: false, reason: "invalid_input", fields: invalid };
  const missing = [...(!title ? ["title"] : []), ...(!date ? ["date"] : [])];
  if (missing.length) return { ok: false, reason: "missing_fields", fields: missing };
  if ((date as string) < ctx.today) return { ok: false, reason: "date_in_past", fields: ["date"] };
  return { ok: true, payload: { title: title as string, date: date as string, time, location } };
}

export const eventCreateDraft: DraftDefinition<EventDraftPayload> = {
  type: "event.create",
  validate: validateEventDraft,

  availability: (facts) => (profileHasTicketing(facts) ? { ok: true } : { ok: false, reason: "feature_unavailable" }),

  changes: (p) => [
    { field: "event_title", kind: "text", before: null, after: p.title },
    { field: "event_date", kind: "date", before: null, after: p.date },
    ...(p.time ? [{ field: "event_time", kind: "text" as const, before: null, after: p.time }] : []),
    ...(p.location ? [{ field: "event_location", kind: "text" as const, before: null, after: p.location }] : []),
  ],

  summary: (p) => `New event (unpublished): ${p.title.slice(0, 70)} — ${p.date}`,
  fieldNames: (p) => ["title", "date", ...(p.time ? ["time"] : []), ...(p.location ? ["location"] : [])],

  async apply(db, workspace, draft, facts) {
    const { error } = await db.from("events").insert({
      id: draft.targetId,
      profile_id: workspace.profileId,
      title: draft.payload.title,
      event_date: draft.payload.date,
      event_time: draft.payload.time,
      location: draft.payload.location,
      status: "draft",
      sort_order: facts.eventCount,
    });
    if (error) {
      if ((error as { code?: string }).code === "23505") {
        const { data } = await db.from("events").select("id").eq("id", draft.targetId).eq("profile_id", workspace.profileId).maybeSingle();
        if (data) return { ok: true, resultId: draft.targetId, alreadyApplied: true };
      }
      console.error("ai event draft apply failed:", error.message);
      return { ok: false, code: "write_failed" };
    }
    return { ok: true, resultId: draft.targetId, alreadyApplied: false };
  },

  reviewPath: (resultId) => (resultId ? `/dashboard/tickets/${resultId}` : "/dashboard/tickets"),
};
