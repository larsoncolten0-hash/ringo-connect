// Shared shape + labeling rules for the organization switcher (desktop
// OrgSwitcher and the mobile "More" menu's workspace section) — one
// definition so the two surfaces can never drift into showing different
// labels for the same organization.
export interface OrgOption {
  profileId: string;
  name: string;
  isOwner: boolean;
  roleName: string | null;
  // Whether this organization's plan unlocks Team Management — see
  // 2026-10-02_team_plan_gate.sql. Only meaningful combined with isOwner:
  // an owned profile that ISN'T an Enterprise business is just the
  // person's individual Ringo, not a business workspace, so it's labeled
  // "Personal" (see the product spec's own example: "Personal Ringo →
  // Personal") instead of showing its profile name.
  teamEnabled: boolean;
}

export function orgDisplayName(org: OrgOption): string {
  return org.isOwner && !org.teamEnabled ? "Personal" : org.name;
}

export function orgDisplaySubtitle(org: OrgOption): string {
  if (org.isOwner) return org.teamEnabled ? "Owner" : "Personal";
  return org.roleName || "Team member";
}
