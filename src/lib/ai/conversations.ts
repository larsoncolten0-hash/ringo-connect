import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { AiLocale } from "@/lib/ai/types";

// Conversation persistence. Reads use the caller's session client (RLS:
// own rows only) PLUS an explicit user_id filter; writes use the service
// role after guard.ts resolved the caller, with user_id always taken from
// that server-resolved identity. Only user text and final assistant text
// are stored — never tool results, prompts or provider payloads.

export const MAX_STORED_ASSISTANT_CHARS = 16000;

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export async function getOwnConversation(userId: string, conversationId: string) {
  const { data } = await createClient()
    .from("ai_conversations")
    .select("id, profile_id, title, locale, created_at, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function listOwnConversations(userId: string, limit = 30) {
  const { data, error } = await createClient()
    .from("ai_conversations")
    .select("id, title, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) console.error("listOwnConversations failed:", error.message);
  return data || [];
}

export async function listConversationMessages(conversationId: string, limit: number): Promise<StoredMessage[]> {
  // Newest N, returned oldest-first.
  const { data, error } = await createClient()
    .from("ai_messages")
    .select("id, role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) console.error("listConversationMessages failed:", error.message);
  return ((data || []) as StoredMessage[]).reverse();
}

export async function createConversation(userId: string, profileId: string, locale: AiLocale, firstMessage: string) {
  const title = firstMessage.replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const { data, error } = await createAdminClient()
    .from("ai_conversations")
    .insert({ user_id: userId, profile_id: profileId, locale, title })
    .select("id")
    .single();
  if (error) throw new Error(`createConversation failed: ${error.message}`);
  return data.id as string;
}

export async function appendMessage(conversationId: string, role: "user" | "assistant", content: string, toolsUsed: string[] = []) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_messages")
    .insert({ conversation_id: conversationId, role, content: content.slice(0, MAX_STORED_ASSISTANT_CHARS), tools_used: toolsUsed.slice(0, 20) })
    .select("id")
    .single();
  if (error) throw new Error(`appendMessage failed: ${error.message}`);
  await admin.from("ai_conversations").update({ updated_at: new Date().toISOString() }).eq("id", conversationId);
  return data.id as string;
}

export async function deleteOwnConversation(userId: string, conversationId: string): Promise<boolean> {
  // Session client + RLS "own delete" policy; messages/feedback cascade.
  const { data, error } = await createClient()
    .from("ai_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", userId)
    .select("id");
  if (error) {
    console.error("deleteOwnConversation failed:", error.message);
    return false;
  }
  return (data || []).length > 0;
}
