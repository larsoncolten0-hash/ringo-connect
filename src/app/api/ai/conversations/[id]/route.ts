import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { deleteOwnConversation, getOwnConversation, listConversationMessages } from "@/lib/ai/conversations";
import { isUuid } from "@/lib/customer/connect";

export const dynamic = "force-dynamic";

// GET /api/ai/conversations/[id] — one of the caller's own conversations.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.reason === "not_authenticated" ? 401 : 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });

  const conv = await getOwnConversation(access.access.workspace.userId, params.id);
  if (!conv) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });

  const messages = await listConversationMessages(conv.id, 200);
  const assistantIds = messages.filter((m) => m.role === "assistant").map((m) => m.id);
  const { data: feedback } = assistantIds.length
    ? await createClient().from("ai_feedback").select("message_id, rating").eq("user_id", access.access.workspace.userId).in("message_id", assistantIds)
    : { data: [] as { message_id: string; rating: number }[] };
  const ratingById = new Map((feedback || []).map((f: any) => [f.message_id, f.rating]));

  return NextResponse.json({
    conversation: { id: conv.id, title: conv.title },
    messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, rating: ratingById.get(m.id) ?? 0 })),
  });
}

// DELETE /api/ai/conversations/[id] — permanently deletes the caller's own
// conversation and its messages/feedback. Usage counters are kept (they hold
// no message content) so limits can't be reset by deleting history.
// Deletion is allowed even if the user has since lost beta access.
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });

  const deleted = await deleteOwnConversation(user.id, params.id);
  if (!deleted) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
