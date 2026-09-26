import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveProtectionDisputeToRefund, resolveProtectionDisputeToRelease } from "@/lib/protection/disputeEngine";
import { buildProtectionDisputeDeps } from "@/lib/protection/disputeHttp";

// Admin resolves an OPEN dispute toward either release or a refund request. Release reuses the
// unmodified Phase 6 release mechanism; refund reuses the unmodified Phase 3 refund-request
// mechanism (creates a `requested` protection_refunds row — never calls Fapshi, never marks
// anything `refunded`). Every action is server-side, admin-authorized, atomic and idempotent (see
// disputeEngine.ts).
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  forbidden: 403,
  invalid_request: 400,
  not_found: 404,
  not_eligible: 409,
  release_failed: 502,
  refund_failed: 502,
  conflict: 409,
  internal_error: 500,
};
const fail = (code: string) => NextResponse.json({ error: code }, { status: STATUS[code] ?? 500 });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await assertAdmin();
    if (!admin) return fail("forbidden");

    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    if (action !== "release" && action !== "refund") return fail("invalid_request");

    const deps = buildProtectionDisputeDeps();
    const outcome =
      action === "release"
        ? await resolveProtectionDisputeToRelease(deps, params.id, admin.id)
        : await resolveProtectionDisputeToRefund(deps, params.id, admin.id, { reason: typeof body?.reason === "string" ? body.reason.slice(0, 500) : undefined });

    if (!outcome.ok) return fail(outcome.code);

    // Same existing admin_audit_log table/pattern every other admin financial action already uses.
    await createAdminClient()
      .from("admin_audit_log")
      .insert({ admin_id: admin.id, action: `protection_dispute_resolve_${action}`, details: { transactionId: params.id, alreadyResolved: outcome.alreadyResolved } });

    return NextResponse.json({ ok: true, alreadyResolved: outcome.alreadyResolved, resolution: outcome.resolution ?? action });
  } catch (err) {
    console.error("[protection-dispute] resolve failed:", (err as Error)?.message || err);
    return fail("internal_error");
  }
}
