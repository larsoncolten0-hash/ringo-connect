import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { reconcileGifts } from "@/lib/church/giving/gifts/flow";
import { buildGiftDeps } from "@/lib/church/giving/gifts/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST (Ringo administrators only): the reconciliation sweep over EVERY church's open and recently expired gifts. It asks Fapshi about each transaction once and settles through the same idempotent path as
// the donor's own page. It also reports the gifts that are paid but have no earning yet and the gifts held for review, so nothing stays unaccounted for. Run it by hand or from a scheduler; it is safe to repeat.
export async function POST() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const summary = await reconcileGifts(buildGiftDeps(), { limit: 50 });
    const db = createAdminClient();
    const [review, noEarning] = await Promise.all([
      db.from("church_gifts").select("id", { count: "exact", head: true }).eq("status", "payment_review"),
      db.from("church_gifts").select("id, church_gift_earnings(id)").eq("status", "succeeded").limit(2000),
    ]);
    const paidWithoutEarning = ((noEarning.data as Array<{ id: string; church_gift_earnings: unknown[] }>) || []).filter((g) => !g.church_gift_earnings || g.church_gift_earnings.length === 0).map((g) => g.id);
    return NextResponse.json({ ok: true, ...summary, review: review.count ?? 0, paid_without_earning: paidWithoutEarning });
  } catch {
    console.error(JSON.stringify({ scope: "church_gifts", result: "admin_reconcile_error" }));
    return NextResponse.json({ error: "Could not run the sweep." }, { status: 500 });
  }
}
