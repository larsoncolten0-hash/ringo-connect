import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";

// Minimal admin read model for Ringo Protection disputes (Phase 7). Deliberately API-only in this
// phase — see the Phase 7 report for why the visual admin UI is explicitly deferred rather than
// expanding scope ("Do not redesign the Protection admin dashboard").
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const client = createAdminClient();
  const { data, error } = await client
    .from("protection_disputes")
    .select(
      `id, status, reason, message, opened_at, resolved_at,
       protection_transaction_id, order_id, profile_id, customer_id,
       protection_transactions(status, product_amount, protection_fee_amount, currency),
       profiles(name, username)`
    )
    .order("opened_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: "internal_error" }, { status: 500 });

  return NextResponse.json({
    disputes: (data || []).map((d: any) => ({
      id: d.id,
      status: d.status,
      reason: d.reason,
      message: d.message,
      openedAt: d.opened_at,
      resolvedAt: d.resolved_at,
      transactionId: d.protection_transaction_id,
      transactionStatus: d.protection_transactions?.status ?? null,
      protectedAmount: d.protection_transactions ? Number(d.protection_transactions.product_amount) : null,
      feeAmount: d.protection_transactions ? Number(d.protection_transactions.protection_fee_amount) : null,
      currency: d.protection_transactions?.currency ?? null,
      orderId: d.order_id,
      sellerName: d.profiles?.name || d.profiles?.username || null,
    })),
  });
}
