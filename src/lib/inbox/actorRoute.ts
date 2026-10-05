import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { RpcClient } from "@/lib/whatsapp/ingest";
import { resolveInboxOwner } from "./access";
import { resolveInboxActor, actorCan, hasActiveMembership } from "./actor";
import { logOrgActivity, type OrgActivityAction } from "@/lib/team/activity";
import { MAX_BODY_CHARS } from "./route";
import { isUuid } from "./format";
import type { Actor, ToolResult } from "./tools";

// Guards for the Inbox routes that a TEAM MEMBER may use as well as the owner (reply, media, close/reopen, mark read, saved-reply create/edit, AI).
// The owner path is the old one, unchanged (same statuses, same database functions). The staff path:
//   1. JSON only, signed-in user from the session                                                    (401)
//   2. the conversation (from the URL) is looked up SERVER-side and the database decides the relation of THIS user to the organization that owns it
//      (inbox_actor_access: owner | member | forbidden | not_found)  — never a profile id from the request
//   3. 'member' -> the existing send / status / read code runs with a service client whose function names are mapped to the inbox_member_* variants
//      (which re-check membership, the Team plan gate, the permission and its dependencies, and record the REAL staff user). Any operation without a
//      member variant (saved-reply delete, settings, ...) fails closed here.
//   4. 'forbidden' (a real member without the permission) -> 403; anyone else -> the unchanged owner behaviour (403 / 404).
// Nothing here accepts a profile id, owner id, recipient, phone number, role or permission from the browser.

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** owner function -> member function. The ONLY operations a team member can reach; anything else is refused (there is no delete mapping). */
export const MEMBER_FUNCTIONS: Readonly<Record<string, string>> = Object.freeze({
  inbox_prepare_outbound_text: "inbox_member_prepare_outbound_text",
  inbox_complete_outbound: "inbox_member_complete_outbound",
  inbox_fail_outbound: "inbox_member_fail_outbound",
  inbox_prepare_outbound_media: "inbox_member_prepare_outbound_media",
  inbox_complete_outbound_media: "inbox_member_complete_outbound_media",
  inbox_set_conversation_status: "inbox_member_set_conversation_status",
  inbox_mark_conversation_read: "inbox_member_mark_conversation_read",
  inbox_saved_reply_save: "inbox_member_saved_reply_save",
});

/** A service client for a team member: every call is routed to its member variant; unknown functions fail closed. */
export function memberRpcClient(admin: RpcClient): RpcClient {
  return {
    rpc(fn, args) {
      const member = Object.prototype.hasOwnProperty.call(MEMBER_FUNCTIONS, fn) ? MEMBER_FUNCTIONS[fn] : null;
      if (!member) return Promise.resolve({ data: null, error: { code: "not_allowed" } });
      return admin.rpc(member, args);
    },
  };
}

export type ConversationGuard =
  | { ok: true; kind: "owner" | "member"; userId: string; /** the organization that owns the conversation (server-resolved); null when unknown */ profileId: string | null; admin: RpcClient }
  | { ok: false; status: number; error: string };

const deny = (status: number, error: string): ConversationGuard => ({ ok: false, status, error });

/** Authorizes ONE action on ONE conversation for the signed-in user. */
/** `logScope` keeps each route's own log namespace (whatsapp_send, whatsapp_media, inbox_tools ...). */
export async function guardConversationAction(conversationId: string, permission: string, logScope = "inbox_tools"): Promise<ConversationGuard> {
  const session = createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return deny(401, "not_found");

  // 1. the unchanged owner path: the user is an Inbox owner and the conversation is theirs (a read through their own RLS-bound session)
  const legacy = await resolveInboxOwner();
  if (legacy.ok && isUuid(conversationId)) {
    try {
      const { data } = await session.from("inbox_conversations").select("id").eq("id", conversationId).eq("profile_id", legacy.owner.profileId).maybeSingle();
      if (data) return finishOwner(user.id, legacy.owner.profileId, logScope);
    } catch {
      /* fall through to the staff check */
    }
  }

  // 2. team member? (their own membership rows are visible to them; no database function call unless they have any)
  const hasMembership = await hasActiveMembership(session, user.id);
  if (hasMembership && isUuid(conversationId)) {
    let admin: ReturnType<typeof createAdminClient>;
    try {
      admin = createAdminClient();
    } catch {
      console.error(JSON.stringify({ scope: logScope, result: "client_unavailable" }));
      return deny(503, "server_error");
    }
    let relation: unknown = null;
    try {
      relation = (await admin.rpc("inbox_actor_access", { p_actor_user_id: user.id, p_conversation_id: conversationId, p_permission: permission })).data;
    } catch {
      relation = null;
    }
    if (relation === "member") {
      let profileId: string | null = null;
      try {
        const { data } = await session.from("inbox_conversations").select("profile_id").eq("id", conversationId).maybeSingle();
        profileId = data && isUuid((data as any).profile_id) ? String((data as any).profile_id) : null;
      } catch {
        profileId = null;
      }
      return { ok: true, kind: "member", userId: user.id, profileId, admin: memberRpcClient(admin as unknown as RpcClient) };
    }
    if (relation === "owner") return finishOwner(user.id, null, logScope);
    if (relation === "forbidden") return deny(403, "forbidden");
  }

  // 3. everyone else: exactly the old behaviour (not an owner -> 403; an owner asking for a conversation that is not theirs -> the database answers 404)
  if (!legacy.ok) return deny(legacy.reason === "not_signed_in" ? 401 : 403, "not_found");
  return finishOwner(user.id, legacy.owner.profileId, logScope);
}

function finishOwner(userId: string, profileId: string | null, logScope: string): ConversationGuard {
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    console.error(JSON.stringify({ scope: logScope, result: "client_unavailable" }));
    return deny(503, "server_error");
  }
  return { ok: true, kind: "owner", userId, profileId, admin: admin as unknown as RpcClient };
}

/** Internal attribution of a team member's action in the organization activity log (conversation id and a label only: never message text). */
export async function recordMemberActivity(guard: { kind: "owner" | "member"; userId: string; profileId: string | null }, action: OrgActivityAction, details: Record<string, unknown>): Promise<void> {
  if (guard.kind !== "member" || !guard.profileId) return;
  await logOrgActivity({ profileId: guard.profileId, actorUserId: guard.userId, action, details });
}

export interface StaffAwareActor extends Actor {
  kind: "owner" | "member";
}

/** Same shape as withInboxOwner (JSON only, size cap, tolerant body), but the caller may be a team member holding `permission` on the conversation. */
export async function withConversationActor(
  request: Request,
  conversationId: string,
  permission: string,
  handler: (actor: StaffAwareActor, body: Record<string, unknown>) => Promise<ToolResult>,
  audit?: { action: (r: ToolResult) => OrgActivityAction | null },
): Promise<NextResponse> {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ ok: false, error: "invalid" }, 415);
  if (!isUuid(conversationId)) return json({ ok: false, error: "not_found" }, 404);

  const guard = await guardConversationAction(conversationId, permission);
  if (!guard.ok) return json({ ok: false, error: guard.error }, guard.status);

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: "invalid" }, 413);
    const parsed = raw.trim() === "" ? {} : JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }

  const result = await handler({ admin: guard.admin, userId: guard.userId, profileId: guard.profileId ?? "", kind: guard.kind }, body);
  if (guard.kind === "member" && guard.profileId && audit && result.status >= 200 && result.status < 300) {
    const action = audit.action(result);
    // internal attribution only: which team member did what, on which conversation (ids and a label, never message text)
    if (action) await recordMemberActivity(guard, action, { conversationId });
  }
  return json(result.body, result.status);
}

/**
 * Saved replies are per organization, not per conversation: the organization is the ACTOR's (the owner's own profile, or the staff workspace the
 * database confirmed and the cookie picked). `inbox_member_saved_reply_save` re-checks membership, the plan gate and inbox.saved_replies.
 */
export async function withSavedReplyActor(
  request: Request,
  handler: (actor: StaffAwareActor, body: Record<string, unknown>) => Promise<ToolResult>,
): Promise<NextResponse> {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ ok: false, error: "invalid" }, 415);
  const resolved = await resolveInboxActor();
  if (!resolved.ok) return json({ ok: false, error: "not_found" }, resolved.reason === "not_signed_in" ? 401 : 403);
  const { actor } = resolved;
  if (actor.kind === "staff" && !actorCan(actor, "inbox.saved_replies")) return json({ ok: false, error: "forbidden" }, 403);

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: "invalid" }, 413);
    const parsed = raw.trim() === "" ? {} : JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    console.error(JSON.stringify({ scope: "inbox_tools", result: "client_unavailable" }));
    return json({ ok: false, error: "server_error" }, 503);
  }
  const rpcAdmin = admin as unknown as RpcClient;
  const result = await handler({ admin: actor.kind === "staff" ? memberRpcClient(rpcAdmin) : rpcAdmin, userId: actor.userId, profileId: actor.profileId, kind: actor.kind === "staff" ? "member" : "owner" }, body);
  return json(result.body, result.status);
}
