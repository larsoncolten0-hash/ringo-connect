import { createClient, createAdminClient } from "@/lib/supabase/server";
import { notifyAdmins } from "@/lib/notifications";
import { sendPushToAdmins } from "@/lib/push/send";
import { NextResponse } from "next/server";

// A signed-in creator's own thread with the admin team — the API behind
// the dashboard's "Ask for help" chat widget (see
// src/components/dashboard/HelpWidget.tsx). One conversation per account
// (support_conversations.user_id is unique), created lazily on first use
// by either GET or POST — see 2026-09-27_support_chat.sql. Every query
// here runs on the caller's own session client, so RLS is the real
// access control: a user can only ever reach their own conversation.
async function getOrCreateConversation(supabase: ReturnType<typeof createClient>, userId: string) {
  const { data: existing } = await supabase.from("support_conversations").select("*").eq("user_id", userId).maybeSingle();
  if (existing) return existing;

  const { data: created, error } = await supabase.from("support_conversations").insert({ user_id: userId }).select().single();
  if (error) throw error;
  return created;
}

// Fetches the thread and — unless `?peek=1` is set — marks whatever the
// admin has sent so far as read. HelpWidget.tsx calls this two ways:
// plainly, on its ~3s poll while the panel is open (where "I fetched it"
// really does mean "the user is looking at it," so marking read on every
// call is correct), and with `?peek=1` on its slower background check
// while the panel is closed, which exists only to light the launcher's
// unread dot — that check must NOT mark anything read, or the dot would
// clear itself before anyone actually opened the panel to see it.
export async function GET(request: Request) {
  const peek = new URL(request.url).searchParams.get("peek") === "1";

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const conversation = await getOrCreateConversation(supabase, user.id).catch(() => null);
  if (!conversation) return NextResponse.json({ error: "Could not load your conversation." }, { status: 500 });

  const { data: messages } = await supabase
    .from("support_messages")
    .select("id, sender_type, body, created_at")
    .eq("conversation_id", conversation.id)
    .order("created_at", { ascending: true })
    .limit(200);

  const unread = (messages || []).filter(
    (m) => m.sender_type === "admin" && new Date(m.created_at) > new Date(conversation.user_last_read_at)
  ).length;

  if (!peek) {
    await supabase
      .from("support_conversations")
      .update({ user_last_read_at: new Date().toISOString() })
      .eq("id", conversation.id);
  }

  return NextResponse.json({ conversationId: conversation.id, messages: messages || [], unread });
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 4000) : "";
  if (!text) return NextResponse.json({ error: "Message can't be empty." }, { status: 400 });

  const conversation = await getOrCreateConversation(supabase, user.id).catch(() => null);
  if (!conversation) return NextResponse.json({ error: "Could not load your conversation." }, { status: 500 });

  const { data: message, error } = await supabase
    .from("support_messages")
    .insert({ conversation_id: conversation.id, sender_type: "user", sender_id: user.id, body: text })
    .select("id, sender_type, body, created_at")
    .single();

  if (error || !message) {
    console.error("support message insert failed:", error?.message);
    return NextResponse.json({ error: "Could not send your message — try again." }, { status: 500 });
  }

  // Sending counts as having read everything up to now too, so a stray
  // earlier admin reply doesn't linger as "unread" for someone who just
  // actively engaged with the thread.
  const now = new Date().toISOString();
  await supabase.from("support_conversations").update({ last_message_at: now, user_last_read_at: now }).eq("id", conversation.id);

  const { data: profile } = await supabase.from("profiles").select("username").eq("user_id", user.id).maybeSingle();
  const who = profile?.username ? `@${profile.username}` : user.email || "A creator";

  // Fire-and-forget: both helpers are documented safe-to-await-without-
  // try/catch (see notifications.ts / push/send.ts), and neither should
  // ever fail the message send itself.
  await Promise.all([
    notifyAdmins({
      type: "support_message",
      title: `New message from ${who}`,
      body: text.slice(0, 140),
      link: `/admin/support?c=${conversation.id}`,
    }),
    sendPushToAdmins(createAdminClient(), {
      category: "support_message",
      title: `New message from ${who}`,
      body: text.slice(0, 140),
      url: `/admin/support?c=${conversation.id}`,
    }),
  ]);

  return NextResponse.json({ message });
}
