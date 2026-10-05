import { cache } from "react";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActiveOrgCookie } from "@/lib/team/access";
import { INBOX_PERMISSIONS } from "@/lib/team/permissions";
import type { RpcClient } from "@/lib/whatsapp/ingest";
import { resolveInboxOwner, type InboxDenial } from "./access";
import { isUuid } from "./format";

// WHO is using the Inbox: the organization's OWNER (exactly as before) or a TEAM MEMBER working in someone else's organization from their OWN account.
// The owner path is the unchanged one (resolveInboxOwner). The staff path never trusts the browser:
//   authenticated user (session)  ->  the database lists the organizations where that user is an ACTIVE member, whose plan has Team Management and whose
//   role grants inbox.view (inbox_member_workspaces, service role)  ->  the active-organization cookie only PICKS among those; it never grants anything.
// Every privileged operation is re-checked by the database function that performs it (inbox_member_* / the staff read policies), so this module is a
// UX/routing layer: a wrong answer here can show or hide a button, it cannot give access.

export type InboxKind = "owner" | "staff";
export const ALL_INBOX_PERMISSIONS: readonly string[] = INBOX_PERMISSIONS;

export interface InboxActor {
  kind: InboxKind;
  userId: string;
  /** The organization (profile) whose Inbox this is. Server-resolved from the database / the session, never from the request. */
  profileId: string;
  /** The user's own session client: reads are filtered by RLS (owner-read, or the staff read policies) AND by this profile id. */
  supabase: ReturnType<typeof createClient>;
  /** The Inbox permissions that work for this actor (all seven for the owner). */
  permissions: readonly string[];
}
export type InboxActorResult = { ok: true; actor: InboxActor } | { ok: false; reason: InboxDenial };

export interface StaffWorkspace { profileId: string; permissions: string[] }

/** Whether the user has ANY active team membership (their own membership rows are visible to them under RLS). Fails closed. Avoids a function call for everyone else. */
export async function hasActiveMembership(session: { from(table: string): any }, userId: string): Promise<boolean> {
  try {
    const { data, error } = await session.from("organization_members").select("profile_id").eq("user_id", userId).eq("status", "active").limit(1);
    return !error && Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/** The organizations where `userId` may use the Inbox as a team member. Fails closed (empty) on any error. */
export async function listStaffWorkspaces(userId: string, admin?: RpcClient): Promise<StaffWorkspace[]> {
  try {
    const client = admin ?? (createAdminClient() as unknown as RpcClient);
    const res = await client.rpc("inbox_member_workspaces", { p_actor_user_id: userId });
    if (res.error || !Array.isArray(res.data)) return [];
    return (res.data as any[])
      .filter((w) => w && isUuid(w.profile_id) && Array.isArray(w.permissions))
      .map((w) => ({ profileId: String(w.profile_id), permissions: (w.permissions as unknown[]).filter((p): p is string => typeof p === "string") }));
  } catch {
    return [];
  }
}

function cookieHint(): string | null {
  try {
    return getActiveOrgCookie();
  } catch {
    return null;
  }
}

// cache(): the layout and the page both ask in one request; the answer is computed once.
export const resolveInboxActor = cache(async (): Promise<InboxActorResult> => {
  const owner = await resolveInboxOwner();
  if (owner.ok) {
    const hint = cookieHint();
    // The owner's own Inbox, unless they chose (cookie) an organization where they are staff and that organization really admits them.
    if (!hint || hint === owner.owner.profileId) return { ok: true, actor: { kind: "owner", userId: owner.owner.userId, profileId: owner.owner.profileId, supabase: owner.owner.supabase, permissions: ALL_INBOX_PERMISSIONS } };
    const w = (await hasActiveMembership(owner.owner.supabase, owner.owner.userId) ? await listStaffWorkspaces(owner.owner.userId) : []).find((x) => x.profileId === hint);
    if (!w) return { ok: true, actor: { kind: "owner", userId: owner.owner.userId, profileId: owner.owner.profileId, supabase: owner.owner.supabase, permissions: ALL_INBOX_PERMISSIONS } };
    return { ok: true, actor: { kind: "staff", userId: owner.owner.userId, profileId: w.profileId, supabase: owner.owner.supabase, permissions: w.permissions } };
  }
  if (owner.reason === "not_signed_in") return { ok: false, reason: "not_signed_in" };

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, reason: "not_signed_in" };
  const workspaces = (await hasActiveMembership(supabase, user.id)) ? await listStaffWorkspaces(user.id) : [];
  if (workspaces.length === 0) return { ok: false, reason: owner.reason };
  const hint = cookieHint();
  const chosen = workspaces.find((x) => x.profileId === hint) ?? workspaces[0];
  return { ok: true, actor: { kind: "staff", userId: user.id, profileId: chosen.profileId, supabase, permissions: chosen.permissions } };
});

export const actorCan = (actor: Pick<InboxActor, "permissions">, permission: string): boolean => actor.permissions.includes(permission);

/** Whether to show "Inbox" in the dashboard navigation for a team member (the organization has WhatsApp, the plan has Team Management, the role has inbox.view). */
export async function staffInboxNavVisible(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  return (await listStaffWorkspaces(userId)).length > 0;
}
