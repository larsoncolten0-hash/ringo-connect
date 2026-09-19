import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push/send";
import { NextResponse } from "next/server";

// One creator's thread, from the admin side — the mirror of
// src/app/api/support/messages/route.ts. Uses the service-role client
// throughout (gated by assertAdmin(), not RLS) since any full admin can
// read/reply to any conversation — there's no per-admin assignment.
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const adminUser = await assertAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("support_conversations")
    .select("id, user_id, admin_last_read_at")
    .eq("id", params.id)
    .maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const { data: messages } = await admin
    .from("support_messages")
    .select("id, sender_type, body, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(200);

  await admin
    .from("support_conversations")
    .update({ admin_last_read_at: new Date().toISOString() })
    .eq("id", conversation.id);

  return NextResponse.json({ messages: messages || [] });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const adminUser = await assertAdmin();
  if (!adminUser) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!text) return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });

  const admin = createAdminClient();
  const { data: conversation } = await admin
    .from("support_conversations")
    .select("id, user_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const { data: message, error } = await admin
    .from("support_messages")
    .insert({ conversation_id: conversation.id, sender_type: "admin", sender_id: adminUser.id, body: text })
    .select("id, sender_type, body, created_at")
    .single();

  if (error || !message) {
    console.error("admin support reply insert failed:", error?.message);
    return NextResponse.json({ error: "Could not send your reply — try again." }, { status: 500 });
  }

  // Replying counts as having read the thread too, same reasoning as the
  // user-side POST route bumping user_last_read_at on send.
  const now = new Date().toISOString();
  await admin
    .from("support_conversations")
    .update({ last_message_at: now, admin_last_read_at: now })
    .eq("id", conversation.id);

  await Promise.all([
    notifyUser(conversation.user_id, {
      type: "support_reply",
      title: "New reply from Ringo support",
      body: text.slice(0, 140),
      link: "/dashboard?support=open",
    }),
    sendPushToUser(admin, conversation.user_id, {
      category: "support_reply",
      title: "New reply from Ringo support",
      body: text.slice(0, 140),
      url: "/dashboard?support=open",
    }),
  ]);

  return NextResponse.json({ message });
}
