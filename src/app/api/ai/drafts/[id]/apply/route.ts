import { NextResponse } from "next/server";
import { resolveAiAccess } from "@/lib/ai/guard";
import { applyDraft } from "@/lib/ai/drafts/apply";
import { isUuid } from "@/lib/customer/connect";
import { isSameOriginRequest } from "@/lib/ai/drafts/http";

// POST /api/ai/drafts/[id]/apply { revision } — the owner's explicit
// "Confirm & Apply" click. The ONLY path that turns a Ringo AI draft into a
// real change. Not reachable from the model (no tool calls it) or from a
// chat message. Re-resolves the session and Ringo AI access (kill switch,
// beta, owner-only, not a demo account) on every call; applyDraft() then
// claims the draft atomically, re-validates it and writes through the
// owner's own session client (existing RLS + triggers).
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  not_found: 404,
  already_applied: 409,
  in_progress: 409,
  revision_mismatch: 409,
  discarded: 409,
  expired: 410,
  stale: 409,
  feature_unavailable: 403,
  plan_limit_reached: 403,
  invalid_payload: 422,
  facts_unavailable: 503,
  claim_failed: 503,
  write_failed: 500,
};

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const access = await resolveAiAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: access.reason === "not_authenticated" ? 401 : 403 });

  const body = await request.json().catch(() => null);
  const revision = body?.revision;
  if (!isUuid(params.id) || !Number.isInteger(revision) || revision < 1) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const result = await applyDraft(access.access.workspace, params.id, revision);
  if (result.ok) return NextResponse.json({ ok: true, draft: result.draft, alreadyApplied: result.alreadyApplied });
  return NextResponse.json({ ok: false, error: result.code, draft: result.draft }, { status: STATUS[result.code] ?? 400 });
}
