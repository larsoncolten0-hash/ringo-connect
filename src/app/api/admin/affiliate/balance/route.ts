import { assertAdmin } from "@/lib/assertAdmin";
import { fapshiGetBalance } from "@/lib/fapshi";
import { NextResponse } from "next/server";

// Lets the admin see the Fapshi service's spendable balance before
// approving a batch of Mobile Money payouts, so a disbursement doesn't
// fail partway through for insufficient funds. Fetched lazily by the
// client rather than blocking the page — Fapshi being unreachable or
// unconfigured shouldn't take down the whole payouts page.
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const balance = await fapshiGetBalance();
    return NextResponse.json({ balance });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Could not fetch Fapshi balance." }, { status: 502 });
  }
}
