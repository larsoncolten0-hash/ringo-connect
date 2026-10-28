import { getClientIp } from "@/lib/customer/codes";
import { isSameOrigin } from "@/lib/customer/session";
import { startGift } from "@/lib/church/giving/gifts/flow";
import { buildGiftDeps, internalError, json, respond } from "@/lib/church/giving/gifts/http";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 4_000;

// POST /api/public/church-gifts: a visitor starts a gift. PUBLIC by design (no account), so everything is re-derived on the server: the church comes from the public page's username and must be a published
// church page, the fund must belong to THAT church and be open and published, giving must be switched on, the minimum and the rates come from the database, and the amount of the payment is the one validated here.
// Nothing is paid by this call: it creates the gift and asks Fapshi to prompt the payer's phone. A gift is paid only when the server has asked Fapshi itself (GET /api/public/church-gifts/[id]).
// The answer carries an access token the donor needs to follow the gift and to ask for a refund; only its hash is stored.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ ok: false, error: "invalid_request" }, 415);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: "invalid_request" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  try {
    return respond(await startGift(buildGiftDeps(), body, { clientKey: getClientIp(request.headers) }), 201);
  } catch (err) {
    return internalError(err);
  }
}
