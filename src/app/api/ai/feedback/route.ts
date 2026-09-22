import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { isUuid } from "@/lib/customer/connect";

// POST /api/ai/feedback — thumbs up/down (+ optional note) on one of the
// caller's own assistant replies. { messageId, rating: 1 | -1 | 0, note? };
// rating 0 removes the feedback.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.reason === "not_authenticated" ? 401 : 403 });
  const userId = access.access.workspace.userId;

  const body = await request.json().catch(() => null);
  const messageId = body?.messageId;
  const rating = body?.rating;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
  if (!isUuid(messageId) || ![1, -1, 0].includes(rating)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  // Ownership: the session client can only see the caller's own messages
  // (RLS), and the conversation's user_id is checked explicitly as well.
  const { data: msg } = await createClient()
    .from("ai_messages")
    .select("id, role, ai_conversations!inner(user_id)")
    .eq("id", messageId)
    .eq("ai_conversations.user_id", userId)
    .maybeSingle();
  if (!msg || msg.role !== "assistant") return NextResponse.json({ error: "invalid_request" }, { status: 404 });

  const admin = createAdminClient();
  if (rating === 0) {
    await admin.from("ai_feedback").delete().eq("message_id", messageId).eq("user_id", userId);
    return NextResponse.json({ ok: true });
  }
  const { error } = await admin
    .from("ai_feedback")
    .upsert({ message_id: messageId, user_id: userId, rating, note: note || null }, { onConflict: "message_id,user_id" });
  if (error) {
    console.error("ai feedback failed:", error.message);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
