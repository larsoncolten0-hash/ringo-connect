import type { RpcClient } from "@/lib/whatsapp/ingest";
import { BODY_MAX, TITLE_MAX, isUuid } from "./format";

// Owner actions in the Inbox: saved replies (create / edit / delete) and close / reopen. Each is ONE call to a service-role-only database
// function (supabase/migrations/2026-12-09_whatsapp_inbox_tools.sql). The caller has already authenticated the user and derived their profile
// from the session; the database re-checks ownership itself and answers "not_found" for anything that is not the actor's. Nothing here accepts a
// recipient, phone number id, WABA id or token, and nothing is ever deleted except the owner's own saved reply.

export interface ToolResult {
  status: number;
  body: { ok: true; id?: string; state?: string } | { ok: false; error: ToolError };
}
export type ToolError = "invalid" | "not_found" | "duplicate_title" | "limit_reached" | "server_error";

const bad = (status: number, error: ToolError): ToolResult => ({ status, body: { ok: false, error } });

function logFailure(fn: string, code: string) {
  // Function name and a short code only: never a title, a body, a name or a number.
  console.error(JSON.stringify({ scope: "inbox_tools", result: "rpc_failed", fn, code }));
}

async function call(admin: RpcClient, fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false }> {
  try {
    const res = await admin.rpc(fn, args);
    if (res.error) {
      logFailure(fn, String(res.error.code || "rpc_error").slice(0, 20));
      return { ok: false };
    }
    return { ok: true, data: res.data };
  } catch {
    logFailure(fn, "rpc_exception");
    return { ok: false };
  }
}

export interface Actor {
  admin: RpcClient;
  userId: string;
  /** The profile the SESSION resolved to (never from the request). The database verifies it belongs to the actor. */
  profileId: string;
}

/** Create (replyId === null) or update a saved reply. */
export async function saveSavedReply(actor: Actor, replyId: string | null, input: { title: unknown; body: unknown }): Promise<ToolResult> {
  if (replyId !== null && !isUuid(replyId)) return bad(404, "not_found");
  if (typeof input.title !== "string" || typeof input.body !== "string") return bad(422, "invalid");
  const title = input.title.trim();
  const body = input.body.trim();
  if (title === "" || Array.from(title).length > TITLE_MAX || body === "" || Array.from(body).length > BODY_MAX) return bad(422, "invalid");

  const r = await call(actor.admin, "inbox_saved_reply_save", { p_actor_user_id: actor.userId, p_profile_id: actor.profileId, p_reply_id: replyId, p_title: title, p_body: body });
  if (!r.ok) return bad(500, "server_error");
  const d = (r.data && typeof r.data === "object" ? r.data : {}) as { result?: string; id?: string };
  switch (d.result) {
    case "created": return { status: 201, body: { ok: true, id: d.id } };
    case "updated": return { status: 200, body: { ok: true, id: d.id } };
    case "not_found": return bad(404, "not_found");
    case "invalid": return bad(422, "invalid");
    case "duplicate_title": return bad(409, "duplicate_title");
    case "limit_reached": return bad(409, "limit_reached");
    default: return bad(500, "server_error");
  }
}

export async function deleteSavedReply(actor: Actor, replyId: string): Promise<ToolResult> {
  if (!isUuid(replyId)) return bad(404, "not_found");
  const r = await call(actor.admin, "inbox_saved_reply_delete", { p_actor_user_id: actor.userId, p_profile_id: actor.profileId, p_reply_id: replyId });
  if (!r.ok) return bad(500, "server_error");
  if (r.data === "ok") return { status: 200, body: { ok: true } };
  return r.data === "not_found" ? bad(404, "not_found") : bad(422, "invalid");
}

/** Close or reopen a conversation. Changes only its status. */
export async function setConversationStatus(actor: Actor, conversationId: string, status: unknown): Promise<ToolResult> {
  if (!isUuid(conversationId)) return bad(404, "not_found");
  if (status !== "open" && status !== "closed") return bad(422, "invalid");
  const r = await call(actor.admin, "inbox_set_conversation_status", { p_actor_user_id: actor.userId, p_conversation_id: conversationId, p_status: status });
  if (!r.ok) return bad(500, "server_error");
  if (r.data === "ok" || r.data === "noop") return { status: 200, body: { ok: true, state: status } };
  return r.data === "not_found" ? bad(404, "not_found") : bad(422, "invalid");
}
