import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { deleteOwnItem, getOwnItem, updateOwnItem } from "@/lib/ai/calendar/store";
import { CALENDAR_CONTENT_TYPES } from "@/lib/ai/calendar/types";
import { isUuid } from "@/lib/customer/connect";

// PATCH /api/ai/calendar/items/[id] — direct owner edits from the calendar UI (edit text/date/
// time/CTA/content_type, approve/postpone/skip/cancel, toggle reminder). "published" is never a
// valid value here — see publish/route.ts, the only path to that status.
// DELETE /api/ai/calendar/items/[id] — remove a planned item (refused once published).
export const dynamic = "force-dynamic";

const STATUS_BY_REASON: Record<string, number> = { not_authenticated: 401, disabled: 403, not_configured: 503, not_in_beta: 403, plan_not_eligible: 403 };
const MAX_CONTENT_CHARS = 1500;
const EDITABLE_STATUSES = ["draft", "planned", "approved", "postponed", "skipped", "cancelled"];

// A regex only checks shape (e.g. "2026-10-40" matches \d{4}-\d{2}-\d{2}) but isn't a real date —
// an invalid one would fail at the Postgres `date` column on update. Reject it here instead.
function isValidCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const existing = await getOwnItem(access.access.workspace, params.id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const patch: Parameters<typeof updateOwnItem>[2] = {};

  if (body.scheduledDate !== undefined) {
    if (typeof body.scheduledDate !== "string" || !isValidCalendarDate(body.scheduledDate)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.scheduledDate = body.scheduledDate;
  }
  if (body.scheduledTime !== undefined) {
    if (body.scheduledTime !== null && typeof body.scheduledTime !== "string") return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.scheduledTime = body.scheduledTime;
  }
  if (body.title !== undefined) {
    if (body.title !== null && (typeof body.title !== "string" || body.title.length > 120)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.title = body.title;
  }
  if (body.content !== undefined) {
    if (typeof body.content !== "string" || !body.content.trim() || body.content.length > MAX_CONTENT_CHARS) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.content = body.content.trim();
  }
  if (body.cta !== undefined) {
    if (body.cta !== null && (typeof body.cta !== "string" || body.cta.length > 80)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.cta = body.cta;
  }
  if (body.imageUrl !== undefined) {
    if (body.imageUrl !== null && typeof body.imageUrl !== "string") return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.imageUrl = body.imageUrl;
  }
  if (body.contentType !== undefined) {
    if (typeof body.contentType !== "string" || !(CALENDAR_CONTENT_TYPES as readonly string[]).includes(body.contentType)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.contentType = body.contentType;
  }
  if (body.status !== undefined) {
    // "published" is never accepted here — see the module comment.
    if (typeof body.status !== "string" || !EDITABLE_STATUSES.includes(body.status)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.status = body.status as any;
  }
  if (body.reminderEnabled !== undefined) {
    if (typeof body.reminderEnabled !== "boolean") return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    patch.reminderEnabled = body.reminderEnabled;
  }

  const updated = await updateOwnItem(access.access.workspace, params.id, patch);
  if (!updated) return NextResponse.json({ error: existing.status === "published" ? "already_published" : "update_failed" }, { status: existing.status === "published" ? 409 : 500 });
  return NextResponse.json({ item: updated });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const ok = await deleteOwnItem(access.access.workspace, params.id);
  if (!ok) return NextResponse.json({ error: "not_found_or_published" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
