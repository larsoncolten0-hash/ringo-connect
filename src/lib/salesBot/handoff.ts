import type { Actor, ToolResult } from "@/lib/inbox/tools";
import { isUuid } from "@/lib/inbox/format";

// The owner's "resume the Smart Card sales bot" action for ONE conversation. It is one call to the existing database function wa_sales_set_handoff, which re-derives
// ownership itself (conversation -> profile -> profiles.user_id = the signed-in actor) and answers "not_found" for a conversation that is not the actor's. The caller has
// already authenticated the user (withInboxOwner); no owner, profile or phone number id is ever taken from the request. Resuming clears the hand-off flag and restarts the
// flow at the welcome message, and ONLY for a conversation that is actually in hand-off (anything else is a no-op, so an order in progress is never reset).

export async function resumeSalesBot(actor: Actor, conversationId: string): Promise<ToolResult> {
  if (!isUuid(conversationId)) return { status: 404, body: { ok: false, error: "not_found" } };
  let res: { data: unknown; error: { code?: string } | null };
  try {
    res = await actor.admin.rpc("wa_sales_set_handoff", { p_actor_user_id: actor.userId, p_conversation_id: conversationId, p_on: false });
  } catch {
    console.error(JSON.stringify({ scope: "sales_bot", result: "resume_exception" }));
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  if (res.error) {
    console.error(JSON.stringify({ scope: "sales_bot", result: "resume_failed", code: String(res.error.code || "rpc_error").slice(0, 20) }));
    return { status: 500, body: { ok: false, error: "server_error" } };
  }
  if (res.data === "ok") return { status: 200, body: { ok: true, state: "resumed" } };
  if (res.data === "noop") return { status: 200, body: { ok: true, state: "noop" } };
  if (res.data === "not_found") return { status: 404, body: { ok: false, error: "not_found" } };
  return { status: 422, body: { ok: false, error: "invalid" } };
}
