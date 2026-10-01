import { NextResponse } from "next/server";
import { resolveBookkeepingOwner } from "@/lib/bookkeeping/access";
import { denialResponse } from "@/lib/bookkeeping/http";
import { loadBookkeepingSummary } from "@/lib/bookkeeping/loader";
import { DEFAULT_TIME_ZONE, isDateKey, monthRange, toLocalDateKey } from "@/lib/bookkeeping/summary";

export const dynamic = "force-dynamic";

const MAX_DAYS = 366;

// Totals for a date range (default: the current month in business-local time). Computed on the server from
// the database rows of the caller's OWN business; the browser never sums anything itself.
export async function GET(request: Request) {
  const access = await resolveBookkeepingOwner();
  if (!access.ok) return denialResponse(access.reason);
  const { owner } = access;

  const url = new URL(request.url);
  const def = monthRange(toLocalDateKey(new Date(), DEFAULT_TIME_ZONE));
  const from = url.searchParams.get("from") ?? def.from;
  const to = url.searchParams.get("to") ?? def.to;
  if (!isDateKey(from) || !isDateKey(to) || from > to) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 >= MAX_DAYS) return NextResponse.json({ error: "range_too_large" }, { status: 400 });

  try {
    // Goods are sold online, but no cost data exists until Inventory ships: profit is withheld, not guessed.
    const summary = await loadBookkeepingSummary(owner.supabase, { profileId: owner.profile.id, currency: owner.profile.currency || "XAF", from, to, cost: { kind: "unknown" } });
    return NextResponse.json({ summary });
  } catch (e: any) {
    console.error("bookkeeping summary failed:", e?.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
