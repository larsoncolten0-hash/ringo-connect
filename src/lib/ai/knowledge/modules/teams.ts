import type { KnowledgeModule } from "../types";

export const teamsModule: KnowledgeModule = {
  id: "teams",
  version: 1,
  title: "Team & organization management",
  summary: "Staff seats, roles and permissions, invitations, switching workspaces.",
  appliesTo: {},
  body: `
Team is part of the Business plans (Business Basic and Business Pro, with a fixed number of staff seats — see the plans module for current numbers). Other plans don't show Team.
At Dashboard → Team (/dashboard/team) the owner invites staff by email with a role. Roles are sets of permissions (e.g. orders, kitchen, menu, tables, customers, sales, loyalty, bookings, tickets) with category-specific default roles; owners can create custom roles. A removed staff member frees their seat.
Staff members see a workspace switcher and a banner showing which business they're working for. Ringo AI is currently for owners only; it isn't available while acting as staff.
`.trim(),
  related: ["plans"],
};
