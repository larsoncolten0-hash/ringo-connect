import { NextResponse } from "next/server";
import { resolveChurchActor } from "@/lib/church/actor";
import { churchRoute } from "@/lib/church/routeKit";
import { listGifts } from "@/lib/church/giving/gifts/handlers";
import { reconcileGifts } from "@/lib/church/giving/gifts/flow";
import { buildGiftDeps } from "@/lib/church/giving/gifts/http";

export const dynamic = "force-dynamic";

// GET /api/church/gifts?from=&to=&status=&fund_id=&limit= : the gifts of the church and the report of the period. Needs church.giving.manage. The owner also gets the commission and net.
export const GET = (request: Request) => churchRoute(request, { write: false }, (actor, { params }) => listGifts(actor, params));

// POST /api/church/gifts { action: "check_pending" }: ask Fapshi about this church's open and recently expired gifts now (a donor who closed the page, or lost signal, is still counted). The church comes from the
// signed-in session; the check settles through the same idempotent path as the donor's own page. Needs church.giving.manage. The only thing this route does with the service role is that check.
export async function POST(request: Request) {
  const resolved = await resolveChurchActor();
  if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.reason === "not_signed_in" ? "not_signed_in" : "forbidden" }, { status: resolved.reason === "not_signed_in" ? 401 : 403 });
  if (!resolved.actor.caps.manageGiving) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || body.action !== "check_pending") return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  try {
    const summary = await reconcileGifts(buildGiftDeps(), { profileId: resolved.actor.profileId, limit: 25 });
    return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error(JSON.stringify({ scope: "church_gifts", result: "reconcile_error" }));
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
