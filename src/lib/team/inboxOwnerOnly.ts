import { NextResponse } from "next/server";

// WhatsApp Inbox permissions (inbox.*) are OWNER-ONLY to grant or revoke. The database enforces it (2026-12-13_whatsapp_inbox_team_permission_guard.sql:
// triggers on organization_roles / organization_members / organization_invitations); the Team routes repeat it so a manager gets a clear answer instead of
// a database error, and so the rule still holds if a route is ever reached some other way. `code` lets the UI show the right message.
export const INBOX_OWNER_ONLY_ERROR = "Only the organization owner can grant or change Inbox permissions.";

export const inboxOwnerOnlyResponse = () => NextResponse.json({ code: "inbox_owner_only", error: INBOX_OWNER_ONLY_ERROR }, { status: 403 });
export const inboxDependencyResponse = (missing: string[]) =>
  NextResponse.json({ code: "inbox_dependencies", error: `Inbox permissions need their prerequisites in the same role (${missing.join(", ")}).` }, { status: 400 });
