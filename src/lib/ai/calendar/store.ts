import { createAdminClient } from "@/lib/supabase/server";
import type { AiWorkspace } from "@/lib/ai/types";
import type { CalendarItemRow, CalendarItemStatus, CalendarPlanRow, ProposedCalendarItem } from "./types";

// Ringo AI Content Calendar — ownership-scoped CRUD. Every read/write is
// scoped to workspace.userId + workspace.profileId (the server-resolved
// caller, never anything the client supplies), mirroring drafts/store.ts's
// own ownership pattern. Service-role client throughout, since RLS on these
// tables is read-only (see the migration) — every write goes through here.

const PLAN_COLUMNS = "id, user_id, profile_id, year, month, title, focus, timezone, locale, status, created_at, updated_at";
const ITEM_COLUMNS =
  "id, plan_id, user_id, profile_id, scheduled_date, scheduled_time, timezone, title, content, cta, image_url, content_type, link_type, link_ref_id, status, reminder_enabled, reminder_sent_at, published_at, community_post_id, ai_generated, created_at, updated_at";

export async function getOwnPlan(workspace: AiWorkspace, year: number, month: number): Promise<CalendarPlanRow | null> {
  const { data } = await createAdminClient()
    .from("content_calendar_plans")
    .select(PLAN_COLUMNS)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();
  return (data as CalendarPlanRow) ?? null;
}

export async function getOwnPlanById(workspace: AiWorkspace, planId: string): Promise<CalendarPlanRow | null> {
  const { data } = await createAdminClient()
    .from("content_calendar_plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .maybeSingle();
  return (data as CalendarPlanRow) ?? null;
}

export async function listOwnPlans(workspace: AiWorkspace, limit = 12): Promise<CalendarPlanRow[]> {
  const { data } = await createAdminClient()
    .from("content_calendar_plans")
    .select(PLAN_COLUMNS)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(limit);
  return (data as CalendarPlanRow[]) || [];
}

/** Creates the month's plan if it doesn't exist yet, or updates the given fields if it does. */
export async function upsertPlan(
  workspace: AiWorkspace,
  year: number,
  month: number,
  patch: { title?: string | null; focus?: string | null; timezone?: string; locale?: string; status?: string }
): Promise<CalendarPlanRow | null> {
  const existing = await getOwnPlan(workspace, year, month);
  const db = createAdminClient();
  if (existing) {
    const { data, error } = await db
      .from("content_calendar_plans")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select(PLAN_COLUMNS)
      .maybeSingle();
    if (error) console.error("upsertPlan (update) failed:", error.message);
    return (data as CalendarPlanRow) ?? existing;
  }
  const { data, error } = await db
    .from("content_calendar_plans")
    .insert({ user_id: workspace.userId, profile_id: workspace.profileId, year, month, ...patch })
    .select(PLAN_COLUMNS)
    .maybeSingle();
  if (error) {
    console.error("upsertPlan (insert) failed:", error.message);
    return null;
  }
  return data as CalendarPlanRow;
}

export async function listPlanItems(workspace: AiWorkspace, planId: string): Promise<CalendarItemRow[]> {
  const { data } = await createAdminClient()
    .from("content_calendar_items")
    .select(ITEM_COLUMNS)
    .eq("plan_id", planId)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .order("scheduled_date", { ascending: true });
  return (data as CalendarItemRow[]) || [];
}

export async function getOwnItem(workspace: AiWorkspace, itemId: string): Promise<CalendarItemRow | null> {
  const { data } = await createAdminClient()
    .from("content_calendar_items")
    .select(ITEM_COLUMNS)
    .eq("id", itemId)
    .eq("user_id", workspace.userId)
    .eq("profile_id", workspace.profileId)
    .maybeSingle();
  return (data as CalendarItemRow) ?? null;
}

export async function insertItems(
  workspace: AiWorkspace,
  planId: string,
  timezone: string,
  items: ProposedCalendarItem[],
  aiGenerated: boolean
): Promise<CalendarItemRow[]> {
  if (items.length === 0) return [];
  const rows = items.map((it) => ({
    plan_id: planId,
    user_id: workspace.userId,
    profile_id: workspace.profileId,
    scheduled_date: it.scheduledDate,
    scheduled_time: it.scheduledTime,
    timezone,
    title: it.title,
    content: it.content,
    cta: it.cta,
    content_type: it.contentType,
    link_type: it.linkType,
    link_ref_id: it.linkRefId,
    status: "planned",
    ai_generated: aiGenerated,
  }));
  const { data, error } = await createAdminClient().from("content_calendar_items").insert(rows).select(ITEM_COLUMNS);
  if (error) {
    console.error("insertItems failed:", error.message);
    return [];
  }
  return (data as CalendarItemRow[]) || [];
}

export interface ItemUpdate {
  scheduledDate?: string;
  scheduledTime?: string | null;
  title?: string | null;
  content?: string;
  cta?: string | null;
  imageUrl?: string | null;
  contentType?: string;
  status?: CalendarItemStatus;
  reminderEnabled?: boolean;
}

/**
 * Applies an edit/status-change to the caller's own item. Refuses (returns
 * null) once an item is 'published' — that's the durable record of what
 * actually went out; nothing about it should be editable after the fact.
 * Changing the date or the status clears reminder_sent_at, so a rescheduled
 * item or a freshly re-approved one gets a real reminder again rather than
 * silently reusing a stale already-sent flag.
 */
export async function updateOwnItem(workspace: AiWorkspace, itemId: string, patch: ItemUpdate): Promise<CalendarItemRow | null> {
  const existing = await getOwnItem(workspace, itemId);
  if (!existing || existing.status === "published") return null;

  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.scheduledDate !== undefined) dbPatch.scheduled_date = patch.scheduledDate;
  if (patch.scheduledTime !== undefined) dbPatch.scheduled_time = patch.scheduledTime;
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.content !== undefined) dbPatch.content = patch.content;
  if (patch.cta !== undefined) dbPatch.cta = patch.cta;
  if (patch.imageUrl !== undefined) dbPatch.image_url = patch.imageUrl;
  if (patch.contentType !== undefined) dbPatch.content_type = patch.contentType;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if (patch.reminderEnabled !== undefined) dbPatch.reminder_enabled = patch.reminderEnabled;
  if (patch.scheduledDate !== undefined || patch.status !== undefined) dbPatch.reminder_sent_at = null;

  const { data, error } = await createAdminClient().from("content_calendar_items").update(dbPatch).eq("id", itemId).select(ITEM_COLUMNS).maybeSingle();
  if (error) {
    console.error("updateOwnItem failed:", error.message);
    return null;
  }
  return (data as CalendarItemRow) ?? null;
}

export async function deleteOwnItem(workspace: AiWorkspace, itemId: string): Promise<boolean> {
  const existing = await getOwnItem(workspace, itemId);
  if (!existing || existing.status === "published") return false;
  const { error } = await createAdminClient().from("content_calendar_items").delete().eq("id", itemId);
  if (error) {
    console.error("deleteOwnItem failed:", error.message);
    return false;
  }
  return true;
}
