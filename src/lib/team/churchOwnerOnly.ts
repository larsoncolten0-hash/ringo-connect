import { NextResponse } from "next/server";

// Church permissions (church.*) have their own grant rules, enforced in the database (2026-12-27_church_people_groups.sql: triggers on organization_roles / organization_members /
// organization_invitations): the church OWNER may grant anything; anyone else only the ordinary ones they hold themselves; a platform admin nothing. The Team routes repeat the rule so a
// manager gets a clear answer instead of a database error. `code` lets the UI show the right message.
export const CHURCH_PERMISSION_DENIED_ERROR = "You can't grant or change these church permissions. Children and delete permissions can only be granted by the church owner.";

export const churchPermissionDeniedResponse = () => NextResponse.json({ code: "church_permission_denied", error: CHURCH_PERMISSION_DENIED_ERROR }, { status: 403 });
