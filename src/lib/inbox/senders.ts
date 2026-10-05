import { createAdminClient } from "@/lib/supabase/server";

// Who sent each outbound message of a conversation, when it was a TEAM MEMBER rather than the owner (inbox_messages.sent_by_user_id, recorded by the
// database from the authenticated actor). Read-only and display-only: it returns a short label (the member's public name or username) per message id, and
// nothing about the messages themselves. Failures return {} (the thread then simply shows no sender labels).
const MAX_MESSAGES = 200;

export async function loadSenderLabels(client: { from(table: string): any }, profileId: string, conversationId: string): Promise<Record<string, string>> {
  try {
    const sent = await client
      .from("inbox_messages")
      .select("id, sent_by_user_id")
      .eq("profile_id", profileId)
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .not("sent_by_user_id", "is", null)
      .limit(MAX_MESSAGES);
    if (sent.error || !Array.isArray(sent.data) || sent.data.length === 0) return {};
    const admin = createAdminClient();
    const { data: org } = await admin.from("profiles").select("user_id").eq("id", profileId).maybeSingle();
    const ownerId = org?.user_id as string | undefined;
    const ids = Array.from(new Set<string>(sent.data.map((r: any) => String(r.sent_by_user_id)).filter((id: string) => id && id !== ownerId)));
    if (ids.length === 0) return {};
    const { data: people } = await admin.from("profiles").select("user_id, name, username").in("user_id", ids);
    const label = new Map<string, string>((people || []).map((p: any) => [String(p.user_id), String(p.name || p.username || "").slice(0, 60)]));
    const out: Record<string, string> = {};
    for (const r of sent.data as any[]) {
      const l = label.get(String(r.sent_by_user_id));
      if (l) out[String(r.id)] = l;
    }
    return out;
  } catch {
    return {};
  }
}
