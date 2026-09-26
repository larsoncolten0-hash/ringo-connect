import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { parseManualRefundInput, recordManualProtectionRefundOutcome } from "@/lib/protection/refundEngine";
import { notifyProtectionRefundCompleted, notifyProtectionRefundFailed } from "@/lib/protection/disputeNotifications";

// Ringo Protection — Phase 12: records the result of a refund transfer the admin/operator already
// performed MANUALLY via Fapshi's own operational interface. This route never calls Fapshi and
// never moves money itself — it only lets an authorized admin report what already happened, so the
// database can distinguish "refund requested" from "refund actually completed" (spec section 5).
//
// The refund row is always looked up by protection_transaction_id (the URL param), never trusted
// from the client as a bare refund id — the same ownership-safe pattern every other Protection
// admin route in this codebase already uses.
export const dynamic = "force-dynamic";

const STATUS: Record<string, number> = {
  forbidden: 403,
  invalid_request: 400,
  invalid_phone: 400,
  invalid_network: 400,
  invalid_reference: 400,
  invalid_reason: 400,
  not_found: 404,
  conflict: 409,
  amount_exceeds_protected: 409,
  internal_error: 500,
};
const fail = (code: string) => NextResponse.json({ error: code }, { status: STATUS[code] ?? 500 });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const admin = await assertAdmin();
    if (!admin) return fail("forbidden");

    const body = await request.json().catch(() => ({}));
    const parsed = parseManualRefundInput(body);
    if (!parsed.ok) return fail(parsed.code);

    const db = createAdminClient();
    const { data: refund } = await db.from("protection_refunds").select("id, order_id").eq("protection_transaction_id", params.id).maybeSingle();
    if (!refund) return fail("not_found");

    const outcome = await recordManualProtectionRefundOutcome(db, refund.id, parsed.value);
    if (!outcome.ok) return fail(outcome.code);

    // Best-effort, non-blocking — never lets a notification failure affect the recorded outcome.
    if (parsed.value.outcome === "completed") {
      notifyProtectionRefundCompleted(refund.order_id).catch(() => {});
    } else {
      notifyProtectionRefundFailed(refund.order_id).catch(() => {});
    }

    // Same existing admin_audit_log table/pattern every other admin financial action already uses.
    await db.from("admin_audit_log").insert({
      admin_id: admin.id,
      action: "protection_refund_manual_outcome",
      details: { transactionId: params.id, refundId: refund.id, outcome: parsed.value.outcome },
    });

    return NextResponse.json({ ok: true, status: outcome.data?.status });
  } catch (err) {
    console.error("[protection-refund] manual outcome failed:", (err as Error)?.message || err);
    return fail("internal_error");
  }
}
