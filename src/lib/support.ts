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
  unread: boolean;
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

  // profiles/users aren't joined via a nested PostgREST select — there's
  // no direct FK from support_conversations to profiles (both merely
  // reference users) — so two follow-up queries plus an in-memory merge
  // is simpler than relying on a multi-hop embed.
  const userIds = Array.from(new Set((conversations || []).map((c: any) => c.user_id).filter(Boolean)));
  const [{ data: users }, { data: profiles }] = await Promise.all([
    userIds.length ? admin.from("users").select("id, email").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length
      ? admin.from("profiles").select("user_id, username, avatar_url").in("user_id", userIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const userById = new Map((users || []).map((u: any) => [u.id, u]));
  const profileByUserId = new Map((profiles || []).map((p: any) => [p.user_id, p]));

  return (conversations || []).map((c: any) => {
    const profile: any = profileByUserId.get(c.user_id);
    const userRow: any = userById.get(c.user_id);
    return {
      id: c.id,
      userId: c.user_id,
      email: userRow?.email ?? null,
      username: profile?.username ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      lastMessageAt: c.last_message_at,
      // No admin has ever opened it, or something landed after they last
      // did — same rule the [id]/messages route uses to decide whether
      // its own GET should count as "already read."
      unread: !c.admin_last_read_at || new Date(c.last_message_at) > new Date(c.admin_last_read_at),
    };
  });
}
