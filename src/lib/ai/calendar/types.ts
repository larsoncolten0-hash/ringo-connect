// Ringo AI Content Calendar — shared types. Mirrors the drafts/content/image
// subsystems' own "one types file, one store file" shape.

export const CALENDAR_PLAN_STATUSES = ["draft", "active", "archived"] as const;
export type CalendarPlanStatus = (typeof CALENDAR_PLAN_STATUSES)[number];

export const CALENDAR_ITEM_STATUSES = ["draft", "planned", "approved", "published", "postponed", "skipped", "cancelled"] as const;
export type CalendarItemStatus = (typeof CALENDAR_ITEM_STATUSES)[number];

export const CALENDAR_CONTENT_TYPES = [
  "announcement",
  "promotion",
  "product",
  "service",
  "educational",
  "engagement",
  "event",
  "music",
  "behind_the_scenes",
  "reminder",
  "seasonal",
  "community",
  "other",
] as const;
export type CalendarContentType = (typeof CALENDAR_CONTENT_TYPES)[number];

export const CALENDAR_LINK_TYPES = ["none", "product", "music", "event", "booking"] as const;
export type CalendarLinkType = (typeof CALENDAR_LINK_TYPES)[number];

export interface CalendarPlanRow {
  id: string;
  user_id: string;
  profile_id: string;
  year: number;
  month: number;
  title: string | null;
  focus: string | null;
  timezone: string;
  locale: "en" | "fr";
  status: CalendarPlanStatus;
  created_at: string;
  updated_at: string;
}

export interface CalendarItemRow {
  id: string;
  plan_id: string;
  user_id: string;
  profile_id: string;
  scheduled_date: string;
  scheduled_time: string | null;
  timezone: string;
  title: string | null;
  content: string;
  cta: string | null;
  image_url: string | null;
  content_type: CalendarContentType;
  link_type: CalendarLinkType;
  link_ref_id: string | null;
  status: CalendarItemStatus;
  reminder_enabled: boolean;
  reminder_sent_at: string | null;
  published_at: string | null;
  community_post_id: string | null;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
}

/** A proposed item before it's written to the DB (the AI planning step produces these). */
export interface ProposedCalendarItem {
  scheduledDate: string;
  scheduledTime: string | null;
  title: string | null;
  content: string;
  cta: string | null;
  contentType: CalendarContentType;
  linkType: CalendarLinkType;
  linkRefId: string | null;
}
