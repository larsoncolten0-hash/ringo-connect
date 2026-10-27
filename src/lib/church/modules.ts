import type { ChurchCapabilities } from "./permissions";

// The sections of the church workspace, in ONE fixed order, with who may open each one. Pure: no React, no I/O, safe in the browser and on the server. The section navigation, the church home grid and
// the church index page (which sends a person who may open a single section straight to it) all read this list, so they can never disagree. A section only appears for a person allowed to open it;
// the server re-checks on every page and every request, and the database decides what is read or written.

export type ChurchModuleKey =
  | "people"
  | "members"
  | "groups"
  | "leadership"
  | "content"
  | "events"
  | "announcements"
  | "pubgroups"
  | "pastors"
  | "bible"
  | "attendance"
  | "features"
  | "music"
  | "reports"
  | "care"
  | "testimonies"
  | "counselling"
  | "giving"
  | "store";
export type ChurchModuleGroup = "community" | "ministry" | "care" | "business";

export interface ChurchModuleDef {
  key: ChurchModuleKey;
  href: string;
  group: ChurchModuleGroup;
  show: (caps: ChurchCapabilities, isOwner: boolean) => boolean;
}

export const CHURCH_MODULE_DEFS: readonly ChurchModuleDef[] = [
  { key: "people", href: "/dashboard/church/people", group: "community", show: (c) => c.viewMembers || c.viewChildren },
  { key: "members", href: "/dashboard/church/members", group: "community", show: (c) => c.viewMembers },
  { key: "groups", href: "/dashboard/church/groups", group: "community", show: (c) => c.viewGroups },
  { key: "leadership", href: "/dashboard/church/leadership", group: "community", show: (c) => c.viewLeadership },
  { key: "content", href: "/dashboard/church/content", group: "ministry", show: (c) => c.viewContent },
  { key: "events", href: "/dashboard/church/events", group: "ministry", show: (c) => c.viewEvents },
  { key: "announcements", href: "/dashboard/church/announcements", group: "ministry", show: (c) => c.viewEvents },
  { key: "pubgroups", href: "/dashboard/church/group-pages", group: "ministry", show: (c) => c.viewGroups },
  { key: "pastors", href: "/dashboard/church/pastors", group: "ministry", show: (c) => c.managePastors },
  { key: "bible", href: "/dashboard/church/bible", group: "ministry", show: (c) => c.viewBible },
  { key: "attendance", href: "/dashboard/church/attendance", group: "ministry", show: (c) => c.viewAttendance },
  { key: "music", href: "/dashboard/church/music", group: "ministry", show: (c) => c.manageMusic },
  { key: "reports", href: "/dashboard/church/reports", group: "care", show: (c) => c.viewReports },
  { key: "care", href: "/dashboard/church/care", group: "care", show: (c) => c.viewCare },
  { key: "testimonies", href: "/dashboard/church/testimonies", group: "care", show: (c) => c.viewTestimonies },
  { key: "counselling", href: "/dashboard/church/counselling", group: "care", show: (c) => c.viewCounselling },
  { key: "giving", href: "/dashboard/church/giving", group: "business", show: (c) => c.manageGiving },
  { key: "features", href: "/dashboard/church/features", group: "business", show: (_c, isOwner) => isOwner },
  { key: "store", href: "/dashboard/church/store", group: "business", show: (_c, isOwner) => isOwner },
];

/** The sections this person may open, in order. */
export const accessibleChurchModules = (caps: ChurchCapabilities, isOwner: boolean): ChurchModuleDef[] => CHURCH_MODULE_DEFS.filter((m) => m.show(caps, isOwner));
