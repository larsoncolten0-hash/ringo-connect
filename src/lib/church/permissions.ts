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

/** Every church permission the Team role editor can hand out in this phase. */
export const CHURCH_PERMISSIONS = [...CHURCH_ORDINARY_PERMISSIONS, ...CHURCH_SENSITIVE_PERMISSIONS] as const;

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
  };
}

export const NO_CHURCH_CAPABILITIES: ChurchCapabilities = churchCapabilities([]);
