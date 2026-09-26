import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { listAdminProtectionDisputes } from "@/lib/protection/adminDisputes";

// Admin read model for Ringo Protection disputes. Now backed by the shared
// listAdminProtectionDisputes() reader (Phase 8) — this route and the /admin/protection/disputes
// page both read through the SAME function, so they can never drift apart.
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  try {
    const disputes = await listAdminProtectionDisputes();
    return NextResponse.json({ disputes });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
