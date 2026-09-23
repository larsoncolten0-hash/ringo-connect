import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { discardDraft, getOwnDraft, recordDraftEvent } from "@/lib/ai/drafts/store";
import { toDraftView } from "@/lib/ai/drafts/view";
import { isUuid } from "@/lib/customer/connect";
import { isSameOriginRequest } from "@/lib/ai/drafts/http";

// DELETE /api/ai/drafts/[id] — the owner's "Discard" on a review card.
// Marks the draft rejected (never deletes Ringo data). Applied drafts can't
// be discarded.
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.reason === "not_authenticated" ? 401 : 403 });
  if (!isUuid(params.id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { workspace } = access.access;
  const existing = await getOwnDraft(workspace, params.id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const row = await discardDraft(workspace, params.id);
  if (!row) return NextResponse.json({ error: "not_editable", draft: toDraftView(existing) }, { status: 409 });
  await recordDraftEvent({ draftId: row.id, workspace, draftType: row.draft_type, action: "discarded", revision: row.revision });
  return NextResponse.json({ ok: true, draft: toDraftView(row) });
}
