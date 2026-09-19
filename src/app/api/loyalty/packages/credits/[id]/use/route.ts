import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { getActiveConnection } from "@/lib/loyalty/customers";
import { usePackageCredit } from "@/lib/loyalty/engine";
import { notifyPackageUsed } from "@/lib/loyalty/notify";
import { invalidRequest, notConnected, outcomeJson, readJsonObject } from "@/lib/loyalty/http";
import { isUuid, parseIdempotencyKey, parseQuantity } from "@/lib/loyalty/validate";

// Use one or more credits of a customer's package (scan -> pick the service -> confirm). The
// credit must belong to the customer behind the connection AND this business; the database
// re-checks that and the balance under a lock.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireLoyaltyAccess(request, "loyalty.scan");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body || !isUuid(params.id)) return invalidRequest();
  const quantity = parseQuantity(body.quantity, 10_000);
  const key = parseIdempotencyKey(body.idempotency_key);
  if (quantity === null || !key) return invalidRequest();
  if (body.via !== undefined && body.via !== "scan" && body.via !== "search") return invalidRequest();

  const conn = await getActiveConnection(access.profile.id, body.connection_id, access.admin);
  if (!conn) return notConnected();

  const result = await usePackageCredit(
    {
      profileId: access.profile.id,
      customerId: conn.customerId,
      creditId: params.id,
      quantity,
      staffUserId: access.userId,
      source: body.via === "search" ? "staff_search" : "staff_scan",
      idempotencyKey: key,
    },
    access.admin
  );
  // Only a use that was actually recorded notifies; the balance is the one the database returned.
  if (result.outcome === "recorded") {
    await notifyPackageUsed(
      { customerId: conn.customerId, profileId: access.profile.id, businessName: access.profile.name ?? access.profile.username, packageId: result.packageId, actionKey: result.actionKey, remaining: result.remaining },
      access.admin
    );
  }

  return outcomeJson(result.outcome, {
    remaining: result.remaining,
    packageStatus: result.packageStatus,
    actionKey: result.actionKey,
  });
}
