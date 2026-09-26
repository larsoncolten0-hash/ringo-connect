import { getClientIp } from "@/lib/customer/codes";
import { createProtectionTransaction } from "@/lib/protection/createTransaction";
import { buildProtectionCheckoutDeps, internalError, respond } from "@/lib/protection/checkoutHttp";

// Create (or idempotently resume) a Ringo Protection transaction for an EXISTING product order.
// Body: { order_id } only — the fee, total and every identity field are resolved server-side from
// the order and the current admin-configured Protection settings. Never touches Normal Payment's own
// checkout routes or tables.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const orderId = body && typeof body === "object" && typeof (body as any).order_id === "string" ? (body as any).order_id : null;
    return respond(await createProtectionTransaction(buildProtectionCheckoutDeps(), orderId ?? "", { clientKey: getClientIp(request.headers) }), 201);
  } catch (err) {
    return internalError(err);
  }
}
