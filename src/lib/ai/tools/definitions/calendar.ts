import { getOwnPlanById, getOwnItem, insertItems, updateOwnItem, upsertPlan } from "@/lib/ai/calendar/store";
import { CALENDAR_CONTENT_TYPES, CALENDAR_LINK_TYPES, type ProposedCalendarItem } from "@/lib/ai/calendar/types";
import { isUuid } from "@/lib/customer/connect";
import type { CalendarPlanView } from "@/lib/ai/content/calendarView";
import type { AiTool } from "../types";

// Ringo AI Content Calendar — the model composes each item's content itself
// (grounded by the existing get_my_*_summary tools, same as generate_content
// already requires), then calls create_content_calendar to validate and
// persist the whole month at once. The tool never calls the model a second
// time internally — the SAME turn that's already happening IS the planning
// step, exactly like generate_content's "write first, then present" shape.
//
// Publishing is deliberately NOT reachable from either tool — only
// update_content_calendar_item's status enum exists, and it never includes
// "published". The owner's own "Publish to Community" click
// (POST /api/ai/calendar/items/[id]/publish) is the only path to
// content_calendar_items.status = 'published' — see publish.ts.

const nullable = (schema: Record<string, unknown>, description: string) => ({ anyOf: [schema, { type: "null" }], description });
const MAX_ITEMS_PER_PLAN = 20;
const MAX_CONTENT_CHARS = 1500;

const FOCUS_VALUES = ["grow_community", "promote_products", "promote_event", "promote_services", "announce", "let_ringo_decide"] as const;

const HINTS: Record<string, string> = {
  invalid_input: "Some values aren't valid (see fields). Fix them and call again.",
  plan_not_found: "That plan_id doesn't exist in this workspace. Call create_content_calendar for the month first, or ask the user which month they mean.",
  item_not_found: "That item_id doesn't exist in this workspace, or was already published (published items can't be changed here).",
};
const refuse = (reason: string, fields?: string[]) => ({ ok: false, reason, ...(fields ? { fields } : {}), hint: HINTS[reason] ?? "" });

// A regex only checks shape (e.g. "2026-10-40" matches \d{4}-\d{2}-\d{2}) but
// isn't a real date — an invalid one would fail at the Postgres `date` column
// on insert, silently dropping the whole bulk insert (see insertItems) while
// the tool still reports ok:true. Reject it here instead, up front.
function isValidCalendarDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function str(v: unknown, max: number): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > max ? undefined : t || null;
}

function parseProposedItem(raw: unknown): ProposedCalendarItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.scheduled_date !== "string" || !isValidCalendarDate(r.scheduled_date)) return null;
  const content = typeof r.content === "string" ? r.content.trim() : "";
  if (!content || content.length > MAX_CONTENT_CHARS) return null;
  const title = str(r.title, 120);
  if (title === undefined) return null;
  const cta = str(r.cta, 80);
  if (cta === undefined) return null;
  const scheduledTime = typeof r.scheduled_time === "string" || r.scheduled_time === null ? (r.scheduled_time as string | null) : r.scheduled_time === undefined ? null : undefined;
  if (scheduledTime === undefined) return null;
  if (typeof r.content_type !== "string" || !(CALENDAR_CONTENT_TYPES as readonly string[]).includes(r.content_type)) return null;
  if (typeof r.link_type !== "string" || !(CALENDAR_LINK_TYPES as readonly string[]).includes(r.link_type)) return null;
  const linkRefId = r.link_ref_id === null || r.link_ref_id === undefined ? null : typeof r.link_ref_id === "string" && isUuid(r.link_ref_id) ? r.link_ref_id : undefined;
  if (linkRefId === undefined) return null;
  if ((r.link_type !== "none") !== !!linkRefId) return null; // a real link_type needs a ref id, and vice versa
  return {
    scheduledDate: r.scheduled_date,
    scheduledTime,
    title,
    content,
    cta,
    contentType: r.content_type as ProposedCalendarItem["contentType"],
    linkType: r.link_type as ProposedCalendarItem["linkType"],
    linkRefId,
  };
}

const itemInputSchema = {
  type: "object",
  properties: {
    scheduled_date: { type: "string", format: "date", description: "YYYY-MM-DD, within the requested month." },
    scheduled_time: nullable({ type: "string" }, "Time of day as the user would say it (e.g. '10:00'), or null."),
    title: nullable({ type: "string" }, "Short label for the calendar cell (max 120 chars), or null."),
    content: { type: "string", description: `The actual post text (max ${MAX_CONTENT_CHARS} chars). Only real facts — see the tool description.` },
    cta: nullable({ type: "string" }, "Call to action (max 80 chars), or null."),
    content_type: { type: "string", enum: [...CALENDAR_CONTENT_TYPES] },
    link_type: { type: "string", enum: [...CALENDAR_LINK_TYPES], description: "What this post is about, if a specific Ringo object — 'none' otherwise." },
    link_ref_id: nullable({ type: "string", format: "uuid" }, "The id of that product/track/event from a get_my_*_summary tool. Required together with a non-'none' link_type; null otherwise."),
  },
  required: ["scheduled_date", "scheduled_time", "title", "content", "cta", "content_type", "link_type", "link_ref_id"],
  additionalProperties: false,
};

export const createContentCalendar: AiTool<{ year: number; month: number; focus: string | null; items: ProposedCalendarItem[] }> = {
  name: "create_content_calendar",
  description:
    `Create (or replace the draft items of) a month's Ringo AI Content Calendar. Call this AFTER grounding yourself with the relevant get_my_*_summary tool(s) (catalog/music/events/bookings/restaurant) and composing each post's actual text — never before. A useful month mixes content types (value, engagement, announcements, promotions, reminders, community-building) rather than repeating the same type. Only include facts a get_my_*_summary tool actually returned or the user gave you in this conversation — never invent a price, product, event, date, promotion, discount, availability or business claim; if you don't have a real fact a post would need, write a general content idea instead (e.g. a tip or engagement post) rather than a specific claim. Up to ${MAX_ITEMS_PER_PLAN} items per call. This never publishes anything — every item starts as 'planned' and stays that way until the owner reviews and approves it in the calendar, and even then only THEIR OWN click on Publish to Community sends it anywhere.`,
  kind: "calendar",
  permission: "settings.manage",
  inputSchema: {
    type: "object",
    properties: {
      year: { type: "integer", description: "e.g. 2026." },
      month: { type: "integer", description: "1-12." },
      focus: { type: "string", enum: [...FOCUS_VALUES, "custom"], description: "What the user said they want to focus on this month, or 'custom' if they described it in their own words (put their words in one item's context, not here)." },
      items: { type: "array", items: itemInputSchema, maxItems: MAX_ITEMS_PER_PLAN, description: "The proposed posts for the month." },
    },
    required: ["year", "month", "focus", "items"],
    additionalProperties: false,
  },
  parseInput(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    const year = typeof r.year === "number" && Number.isInteger(r.year) ? r.year : NaN;
    const month = typeof r.month === "number" && Number.isInteger(r.month) ? r.month : NaN;
    if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    const focus = typeof r.focus === "string" ? r.focus : null;
    if (!Array.isArray(r.items) || r.items.length === 0 || r.items.length > MAX_ITEMS_PER_PLAN) return null;
    const items: ProposedCalendarItem[] = [];
    for (const raw of r.items) {
      const item = parseProposedItem(raw);
      if (!item) return null;
      items.push(item);
    }
    return { year, month, focus, items };
  },
  async run(ctx, input) {
    const plan = await upsertPlan(ctx.workspace, input.year, input.month, { focus: input.focus, timezone: "UTC", locale: ctx.locale, status: "active" });
    if (!plan) return refuse("plan_not_found");
    const rows = await insertItems(ctx.workspace, plan.id, plan.timezone, input.items, true);

    const view: CalendarPlanView = {
      id: plan.id,
      year: plan.year,
      month: plan.month,
      itemCount: rows.length,
      items: rows.slice(0, 8).map((r) => ({ id: r.id, scheduledDate: r.scheduled_date, title: r.title, contentType: r.content_type })),
    };
    ctx.emitCalendarPlan?.(view);

    return {
      ok: true,
      plan_id: plan.id,
      items_created: rows.length,
      shown_to_user: "A calendar summary card, and the full month is now visible in the Content Calendar view.",
      important: "Nothing was published. Every item is 'planned' until the owner reviews and approves it, and publishing to Community only ever happens from the owner's own Publish click.",
    };
  },
};

export const updateContentCalendarItem: AiTool<{
  item_id: string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  title: string | null;
  content: string | null;
  cta: string | null;
  content_type: string | null;
  status: string | null;
}> = {
  name: "update_content_calendar_item",
  description:
    "Edit ONE existing calendar item (use an item_id from a create_content_calendar result or from what the user is looking at). Use null for every field you are not changing. To 'make this more engaging' or otherwise rewrite it, put your new text in `content`. To move it, set `scheduled_date`/`scheduled_time`. `status` may only be 'approved', 'postponed', 'skipped' or 'cancelled' — publishing is never done through chat, only the owner's own Publish click in the calendar does that. Never invent new facts when rewriting — the same rules as create_content_calendar apply.",
  kind: "calendar",
  permission: "settings.manage",
  inputSchema: {
    type: "object",
    properties: {
      item_id: { type: "string", format: "uuid" },
      scheduled_date: nullable({ type: "string", format: "date" }, "New date YYYY-MM-DD, or null to keep it."),
      scheduled_time: nullable({ type: "string" }, "New time, or null to keep it."),
      title: nullable({ type: "string" }, "New short label, or null to keep it."),
      content: nullable({ type: "string" }, `New post text (max ${MAX_CONTENT_CHARS} chars), or null to keep it.`),
      cta: nullable({ type: "string" }, "New call to action, or null to keep it."),
      content_type: nullable({ type: "string", enum: [...CALENDAR_CONTENT_TYPES] }, "New content type, or null to keep it."),
      status: nullable({ type: "string", enum: ["approved", "postponed", "skipped", "cancelled"] }, "New status, or null to keep it. Never 'published' — see the tool description."),
    },
    required: ["item_id", "scheduled_date", "scheduled_time", "title", "content", "cta", "content_type", "status"],
    additionalProperties: false,
  },
  parseInput(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.item_id !== "string" || !isUuid(r.item_id)) return null;
    if (r.scheduled_date !== null && (typeof r.scheduled_date !== "string" || !isValidCalendarDate(r.scheduled_date))) return null;
    if (r.scheduled_time !== null && typeof r.scheduled_time !== "string") return null;
    const title = str(r.title, 120);
    if (title === undefined) return null;
    const content = r.content === null ? null : typeof r.content === "string" && r.content.trim() && r.content.trim().length <= MAX_CONTENT_CHARS ? r.content.trim() : undefined;
    if (content === undefined) return null;
    const cta = str(r.cta, 80);
    if (cta === undefined) return null;
    if (r.content_type !== null && (typeof r.content_type !== "string" || !(CALENDAR_CONTENT_TYPES as readonly string[]).includes(r.content_type))) return null;
    if (r.status !== null && !["approved", "postponed", "skipped", "cancelled"].includes(r.status as string)) return null;
    return {
      item_id: r.item_id,
      scheduled_date: (r.scheduled_date as string) ?? null,
      scheduled_time: (r.scheduled_time as string) ?? null,
      title: title ?? null,
      content,
      cta: cta ?? null,
      content_type: (r.content_type as string) ?? null,
      status: (r.status as string) ?? null,
    };
  },
  async run(ctx, input) {
    const existing = await getOwnItem(ctx.workspace, input.item_id);
    if (!existing) return refuse("item_not_found");
    const updated = await updateOwnItem(ctx.workspace, input.item_id, {
      ...(input.scheduled_date ? { scheduledDate: input.scheduled_date } : {}),
      ...(input.scheduled_time !== null ? { scheduledTime: input.scheduled_time } : {}),
      ...(input.title !== null ? { title: input.title } : {}),
      ...(input.content !== null ? { content: input.content } : {}),
      ...(input.cta !== null ? { cta: input.cta } : {}),
      ...(input.content_type ? { contentType: input.content_type } : {}),
      ...(input.status ? { status: input.status as any } : {}),
    });
    if (!updated) return refuse("item_not_found");
    return { ok: true, item_id: updated.id, status: updated.status, shown_to_user: "The updated item in the Content Calendar." };
  },
};
