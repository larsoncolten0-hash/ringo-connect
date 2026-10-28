import { isSameOrigin } from "@/lib/customer/session";
import { requestRefund } from "@/lib/church/giving/gifts/flow";
import { buildGiftDeps, internalError, json, respond } from "@/lib/church/giving/gifts/http";

export const dynamic = "force-dynamic";

// POST /api/public/church-gifts/[id]/refund-request { t, reason }: the donor asks for a refund inside the window (48 hours after the confirmation by default). It RECORDS the request and nothing else:
// no money moves and nothing is sent to Fapshi. A Ringo administrator decides, and any refund is returned by hand and then recorded. The token is the donor's key, as for the status.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > 2_000) return json({ ok: false, error: "invalid_request" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  try {
    return respond(await requestRefund(buildGiftDeps(), params.id, body?.t, body?.reason), 201);
  } catch (err) {
    return internalError(err);
  }
}
