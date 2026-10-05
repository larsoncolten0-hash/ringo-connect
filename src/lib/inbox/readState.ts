import { isUuid } from "./format";
import type { Actor, ToolResult } from "./tools";

// Opening a conversation clears its unread count. ONE call to a service-role-only database function
// (supabase/migrations/2026-12-12_whatsapp_inbox_mark_read.sql) that sets inbox_conversations.unread_count = 0 and nothing else. The caller has
// already authenticated the user; the database re-derives ownership itself and answers "not_found" for anything that is not the actor's.
// Nothing here accepts a profile id, recipient, phone number id, WABA id, token or URL.

const bad = (status: number, error: "invalid" | "not_found" | "server_error"): ToolResult => ({ status, body: { ok: false, error } });

/** state "cleared": the count was above 0 and is now 0 (the page should refresh). state "unchanged": it was already 0 (nothing to refresh). */
export async function clearConversationUnread(actor: Actor, conversationId: string): Promise<ToolResult> {
  if (!isUuid(conversationId)) return bad(404, "not_found");
  let res: { data: unknown; error: { code?: string } | null };
  try {
    res = await actor.admin.rpc("inbox_mark_conversation_read", { p_actor_user_id: actor.userId, p_conversation_id: conversationId });
  } catch {
    console.error(JSON.stringify({ scope: "inbox_read", result: "rpc_failed", code: "rpc_exception" }));
    return bad(500, "server_error");
  }
  if (res.error) {
    // A short code only: never an id, a name, a number or a message.
    console.error(JSON.stringify({ scope: "inbox_read", result: "rpc_failed", code: String(res.error.code || "rpc_error").slice(0, 20) }));
    return bad(500, "server_error");
  }
  if (res.data === "ok") return { status: 200, body: { ok: true, state: "cleared" } };
  if (res.data === "noop") return { status: 200, body: { ok: true, state: "unchanged" } };
  return res.data === "not_found" ? bad(404, "not_found") : bad(422, "invalid");
}
