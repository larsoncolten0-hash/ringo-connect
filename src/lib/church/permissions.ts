// Churches & Ministries: the `church.*` permission catalogue (Phase 2B). Pure: no I/O, no React, safe in the browser and on the server.
//
// The database (2026-12-27_church_people_groups.sql) is the authority: church_has_permission() decides every read and write, and its guard triggers decide who may GRANT these strings.
// This file only mirrors those rules so the Team screens and the church routes can answer clearly (and hide what would be refused). A wrong answer here can show or hide a button; it cannot
// give access.

/** Ordinary permissions: a church admin who holds one may hand it on (the owner always may). */
export const CHURCH_ORDINARY_PERMISSIONS = [
  "church.members.view",
  "church.members.manage",
  "church.groups.view",
  "church.groups.manage",
  "church.leadership.view",
  "church.leadership.manage",
] as const;

/** Sensitive permissions: only the church OWNER can grant, change or reactivate them. `church.export` is reserved for a later phase and is not offered in this phase. */
export const CHURCH_SENSITIVE_PERMISSIONS = ["church.children.view", "church.children.manage", "church.members.delete"] as const;

/** Content Studio (Phase 3). Not in the ordinary list, so the database guards treat them as owner-only to grant (any `church.*` string they do not list is sensitive): only the church OWNER
 *  can give them. view: read every entry incl. drafts; manage: create / edit / delete DRAFTS; publish: publish, schedule, unpublish, and edit or delete a LIVE entry. */
export const CHURCH_CONTENT_PERMISSIONS = ["church.content.view", "church.content.manage", "church.content.publish"] as const;

/** Events & Announcements (Phase 4). view: read every entry incl. drafts; manage: create / edit / delete DRAFTS; publish: publish, unpublish, and edit or delete a LIVE entry. Owner-only to grant, like every `church.*` string the 2A guards do not list. */
export const CHURCH_EVENTS_PERMISSIONS = ["church.events.view", "church.events.manage", "church.events.publish"] as const;

/** Bible programs (Phase 5). Same three levels as events. Staff never see WHO takes part in a program: only counts. Owner-only to grant. */
export const CHURCH_BIBLE_PERMISSIONS = ["church.bible.view", "church.bible.manage", "church.bible.publish"] as const;

/** Attendance (Phase 7). view: read the attendance of an event; manage: record and remove it. Recording also needs the People view permission (the roster picker). Owner-only to grant. */
export const CHURCH_ATTENDANCE_PERMISSIONS = ["church.attendance.view", "church.attendance.manage"] as const;

/** Church Music (Phase 8). manage: add, edit, hide and remove the music links of the church page. Owner-only to grant. */
export const CHURCH_MUSIC_PERMISSIONS = ["church.music.manage"] as const;

/** Church Reports (Phase 10). view: read the church's AGGREGATE reports (counts only, never names) and download them as CSV. A section is only included when the person also holds the permission for the data behind it (for example attendance numbers need church.attendance.view). Owner-only to grant. */
export const CHURCH_REPORTS_PERMISSIONS = ["church.reports.view"] as const;

/** Care & Support (Phase 9, data layer only: no payment of any kind). view: read every care case incl. drafts and the consent record; manage: create / edit / delete DRAFT cases and record consent; publish: publish, unpublish, and edit or delete a LIVE case. Owner-only to grant. */
export const CHURCH_CARE_PERMISSIONS = ["church.care.view", "church.care.manage", "church.care.publish"] as const;

/** Testimonies (visitors share a testimony with the church). view: read every testimony, its phone number and its moderation history; manage: review, correct the public text, note, unpublish, record a withdrawal of consent; publish: also publish an approved testimony whose submitter consented. Owner-only to grant. */
export const CHURCH_TESTIMONIES_PERMISSIONS = ["church.testimonies.view", "church.testimonies.manage", "church.testimonies.publish"] as const;

/** Every church permission the Team role editor can hand out. */
export const CHURCH_PERMISSIONS = [
  ...CHURCH_ORDINARY_PERMISSIONS,
  ...CHURCH_SENSITIVE_PERMISSIONS,
  ...CHURCH_CONTENT_PERMISSIONS,
  ...CHURCH_EVENTS_PERMISSIONS,
  ...CHURCH_BIBLE_PERMISSIONS,
  ...CHURCH_ATTENDANCE_PERMISSIONS,
  ...CHURCH_MUSIC_PERMISSIONS,
  ...CHURCH_REPORTS_PERMISSIONS,
  ...CHURCH_CARE_PERMISSIONS,
  ...CHURCH_TESTIMONIES_PERMISSIONS,
] as const;

export type ChurchPermission = (typeof CHURCH_PERMISSIONS)[number];

export const isChurchPermission = (value: unknown): value is ChurchPermission => typeof value === "string" && (CHURCH_PERMISSIONS as readonly string[]).includes(value);

/** Anything in the church namespace, including case / spacing variants and strings this phase does not know (the database treats every one of them as owner-only). */
export const isChurchPermissionName = (value: unknown): boolean => typeof value === "string" && value.trim().toLowerCase().startsWith("church.");

export const isSensitiveChurchPermissionName = (value: unknown): boolean =>
  isChurchPermissionName(value) && !(CHURCH_ORDINARY_PERMISSIONS as readonly string[]).includes(String(value).trim().toLowerCase());

/** The distinct church-namespace permissions of a list (any case / spacing variant counts). */
export const churchPermissionsOf = (permissions: readonly string[] | null | undefined): string[] => Array.from(new Set((permissions || []).filter(isChurchPermissionName)));

/**
 * Whether `actor` may change a role's church permissions from `before` to `after` (mirrors team_church_change_denied in the database):
 *  - nothing changes -> allowed;
 *  - the OWNER -> allowed;
 *  - anyone else (and never a platform admin) -> only ORDINARY permissions, and only ones they hold themselves.
 */
export function churchRoleChangeAllowed(args: { isOwner: boolean; isAdmin: boolean; held: ReadonlySet<string>; before: readonly string[]; after: readonly string[] }): boolean {
  const before = new Set(churchPermissionsOf(args.before).map((p) => p.trim().toLowerCase()));
  const after = new Set(churchPermissionsOf(args.after).map((p) => p.trim().toLowerCase()));
  const touched = [...Array.from(before).filter((p) => !after.has(p)), ...Array.from(after).filter((p) => !before.has(p))];
  if (touched.length === 0) return true;
  if (args.isOwner) return true;
  if (args.isAdmin) return false;
  const added = Array.from(after).filter((p) => !before.has(p));
  return touched.every((p) => !isSensitiveChurchPermissionName(p)) && added.every((p) => args.held.has(p));
}

/** What a signed-in person may do in the church workspace. Derived from a permission list; the owner passes ALL. */
export interface ChurchCapabilities {
  viewMembers: boolean;
  manageMembers: boolean;
  deleteMembers: boolean;
  viewChildren: boolean;
  manageChildren: boolean;
  viewGroups: boolean;
  manageGroups: boolean;
  viewLeadership: boolean;
  manageLeadership: boolean;
  /** Mirrors the daily_words SELECT policy: any of the three content permissions opens reading (drafts and scheduled entries included). */
  viewContent: boolean;
  /** Create, edit and delete DRAFTS (the publish permission also holds this, as in the daily_words write policies). */
  manageContent: boolean;
  publishContent: boolean;
  /** Events & Announcements: any of the three opens reading (drafts included); manage also holds with publish, as in the ministry_* write policies. */
  viewEvents: boolean;
  manageEvents: boolean;
  publishEvents: boolean;
  /** Bible programs. */
  viewBible: boolean;
  manageBible: boolean;
  publishBible: boolean;
  /** Attendance. */
  viewAttendance: boolean;
  manageAttendance: boolean;
  /** Church Music links. */
  manageMusic: boolean;
  /** Church Reports (aggregates only). */
  viewReports: boolean;
  /** Care & Support cases (private by default; consent is required before anything is public). */
  viewCare: boolean;
  manageCare: boolean;
  publishCare: boolean;
  /** Testimonies: private submissions (names, phone numbers) and their moderation. */
  viewTestimonies: boolean;
  manageTestimonies: boolean;
  publishTestimonies: boolean;
}

export function churchCapabilities(permissions: readonly string[]): ChurchCapabilities {
  const has = (p: string) => permissions.includes(p);
  const manageMembers = has("church.members.manage");
  const manageChildren = has("church.children.manage");
  const manageGroups = has("church.groups.manage");
  const manageLeadership = has("church.leadership.manage");
  return {
    // Mirrors the SELECT policies exactly: reading members / children needs the `view` string itself (`manage` alone does not open the rows); groups and leadership accept either.
    viewMembers: has("church.members.view"),
    manageMembers,
    deleteMembers: has("church.members.delete"),
    viewChildren: has("church.children.view"),
    manageChildren,
    viewGroups: has("church.groups.view") || manageGroups,
    manageGroups,
    viewLeadership: has("church.leadership.view") || manageLeadership,
    manageLeadership,
    viewContent: has("church.content.view") || has("church.content.manage") || has("church.content.publish"),
    manageContent: has("church.content.manage") || has("church.content.publish"),
    publishContent: has("church.content.publish"),
    viewEvents: has("church.events.view") || has("church.events.manage") || has("church.events.publish"),
    manageEvents: has("church.events.manage") || has("church.events.publish"),
    publishEvents: has("church.events.publish"),
    viewBible: has("church.bible.view") || has("church.bible.manage") || has("church.bible.publish"),
    manageBible: has("church.bible.manage") || has("church.bible.publish"),
    publishBible: has("church.bible.publish"),
    viewAttendance: has("church.attendance.view") || has("church.attendance.manage"),
    manageAttendance: has("church.attendance.manage"),
    manageMusic: has("church.music.manage"),
    viewReports: has("church.reports.view"),
    viewCare: has("church.care.view") || has("church.care.manage") || has("church.care.publish"),
    manageCare: has("church.care.manage") || has("church.care.publish"),
    publishCare: has("church.care.publish"),
    viewTestimonies: has("church.testimonies.view") || has("church.testimonies.manage") || has("church.testimonies.publish"),
    manageTestimonies: has("church.testimonies.manage") || has("church.testimonies.publish"),
    publishTestimonies: has("church.testimonies.publish"),
  };
}

export const NO_CHURCH_CAPABILITIES: ChurchCapabilities = churchCapabilities([]);
