import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { getOwnConversation } from "@/lib/ai/conversations";
import { listConversationDrafts } from "@/lib/ai/drafts/store";
import { toDraftView } from "@/lib/ai/drafts/view";
import { isUuid } from "@/lib/customer/connect";

// GET /api/ai/drafts?conversationId=<uuid> — the review cards for one of the
// caller's own conversations (so they reappear when a conversation is
// reopened). Owner + profile + conversation ownership are all re-checked.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.reason === "not_authenticated" ? 401 : 403 });

  const conversationId = new URL(request.url).searchParams.get("conversationId");
  if (!isUuid(conversationId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { workspace } = access.access;
  const conv = await getOwnConversation(workspace.userId, conversationId);
  if (!conv || conv.profile_id !== workspace.profileId) return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });

  const rows = await listConversationDrafts(workspace, conversationId);
  return NextResponse.json({ drafts: rows.map(toDraftView).filter(Boolean) });
}
