import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { listOwnConversations } from "@/lib/ai/conversations";

// GET /api/ai/conversations — the caller's own recent Ringo AI conversations.
export const dynamic = "force-dynamic";

export async function GET() {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.reason === "not_authenticated" ? 401 : 403 });

  const conversations = await listOwnConversations(access.access.workspace.userId);
  return NextResponse.json({
    conversations: conversations.map((c: any) => ({ id: c.id, title: c.title, updatedAt: c.updated_at })),
  });
}
