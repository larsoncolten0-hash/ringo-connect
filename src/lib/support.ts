// Shared by the admin support inbox's initial server-rendered list
// (src/app/admin/support/page.tsx) and its polling refresh
// (src/app/api/admin/support/conversations/route.ts) — one place for
// "what a conversation row looks like from the admin side," so the two
// can never quietly drift apart.
export type AdminConversationSummary = {
  id: string;
  userId: string;
  email: string | null;
  username: string | null;
  avatarUrl: string | null;
  lastMessageAt: string;
  lastMessageBody: string | null;
  lastMessageFromAdmin: boolean;
  // How many of the *user's* messages landed after this admin last
  // opened the conversation — a real count, not just a boolean, so the
  // inbox row and the "X unread" summary can both show a real number
  // instead of a dot standing in for "at least one."
  unreadCount: number;
  // Lightweight, derived rather than a stored column — "needs_reply"
  // whenever the last message is from the user (whether or not it's
  // technically unread yet), "replied" once an admin's own message is
  // the most recent one. No separate open/closed lifecycle exists for a
  // conversation in this schema, so this is what stands in for
  // "status" without adding one.
  status: "needs_reply" | "replied" | "new";
};

export async function listAdminConversations(admin: any): Promise<AdminConversationSummary[]> {
  const { data: conversations, error } = await admin
    .from("support_conversations")
    .select("id, user_id, last_message_at, admin_last_read_at")
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("listAdminConversations failed:", error.message);
    return [];
  }

  const ids = (conversations || []).map((c: any) => c.id);
  // profiles/users aren't joined via a nested PostgREST select — there's
  // no direct FK from support_conversations to profiles (both merely
  // reference users) — so two follow-up queries plus an in-memory merge
  // is simpler than relying on a multi-hop embed.
  const userIds = Array.from(new Set((conversations || []).map((c: any) => c.user_id).filter(Boolean)));
  const [{ data: users }, { data: profiles }, { data: recentMessages }, { data: unreadCandidates }] = await Promise.all([
    userIds.length ? admin.from("users").select("id, email").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? admin.from("profiles").select("user_id, username, avatar_url").in("user_id", userIds)
      : Promise.resolve({ data: [] as any[] }),
    // Latest message per conversation, for the inbox row's preview text —
    // ordered newest-first across every conversation and capped, then
    // reduced to "first one seen per conversation_id" below (since it's
    // already sorted, that's the latest one) rather than a per-row query
    // per conversation.
    ids.length
      ? admin
          .from("support_messages")
          .select("conversation_id, sender_type, body, created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as any[] }),
    // Every user-sent message in these conversations, capped — used only
    // to COUNT how many landed after each conversation's own
    // admin_last_read_at (a per-conversation threshold, so it has to be
    // done in JS rather than a single WHERE clause).
    ids.length
      ? admin
          .from("support_messages")
          .select("conversation_id, created_at")
          .eq("sender_type", "user")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(1000)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const userById = new Map((users || []).map((u: any) => [u.id, u]));
  const profileByUserId = new Map((profiles || []).map((p: any) => [p.user_id, p]));

  const latestByConversation = new Map<string, { sender_type: string; body: string; created_at: string }>();
  for (const m of recentMessages || []) {
    if (!latestByConversation.has(m.conversation_id)) latestByConversation.set(m.conversation_id, m);
  }

  const unreadCountByConversation = new Map<string, number>();
  const adminReadByConversation = new Map<string, string | null>(
    (conversations || []).map((c: any) => [c.id as string, c.admin_last_read_at as string | null])
  );
  for (const m of unreadCandidates || []) {
    const readAt = adminReadByConversation.get(m.conversation_id);
    const isUnread = !readAt || new Date(m.created_at) > new Date(readAt);
    if (isUnread) unreadCountByConversation.set(m.conversation_id, (unreadCountByConversation.get(m.conversation_id) || 0) + 1);
  }

  return (conversations || []).map((c: any) => {
    const profile: any = profileByUserId.get(c.user_id);
    const userRow: any = userById.get(c.user_id);
    const latest = latestByConversation.get(c.id);
    return {
      id: c.id,
      userId: c.user_id,
      email: userRow?.email ?? null,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      lastMessageAt: c.last_message_at,
      lastMessageBody: latest?.body ?? null,
      lastMessageFromAdmin: latest?.sender_type === "admin",
      unreadCount: unreadCountByConversation.get(c.id) || 0,
      status: !latest ? "new" : latest.sender_type === "user" ? "needs_reply" : "replied",
    };
  });
}
