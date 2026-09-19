import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { getActiveConnection } from "@/lib/loyalty/customers";
import { activatePackage } from "@/lib/loyalty/engine";
import { invalidRequest, jsonError, notConnected, outcomeJson, readJsonObject } from "@/lib/loyalty/http";
import { notifyPackageActivated } from "@/lib/loyalty/notify";
import { templateHasItems } from "@/lib/loyalty/templates";
import { isUuid, parseIdempotencyKey, parseIsoDate, parseOptionalText } from "@/lib/loyalty/validate";

// Manually activate a package for a connected customer (after the business has been paid
// through its own process; no payment is taken here). The idempotency key doubles as the
// activation key, so a double tap can never sell the same package twice.
export async function POST(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.manage");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body || !isUuid(body.template_id)) return invalidRequest();
  const key = parseIdempotencyKey(body.idempotency_key);
  const paymentReference = parseOptionalText(body.payment_reference, 120);
  if (!key || paymentReference === undefined) return invalidRequest();

  let startsAt: Date | null = null;
  if (body.starts_at !== undefined && body.starts_at !== null && body.starts_at !== "") {
    startsAt = parseIsoDate(body.starts_at);
    if (!startsAt) return invalidRequest();
    const days = (startsAt.getTime() - Date.now()) / 864e5;
    if (days > 366 || days < -400) return invalidRequest();
  }

  const conn = await getActiveConnection(access.profile.id, body.connection_id, access.admin);
  if (!conn) return notConnected();

  if (!(await templateHasItems(access.profile.id, body.template_id, access.admin))) {
    // Unknown, foreign or empty template: one answer, no hint which.
    return jsonError("template_empty", 409);
  }

  const result = await activatePackage(
    {
      profileId: access.profile.id,
      customerId: conn.customerId,
      templateId: body.template_id,
      startsAt,
      staffUserId: access.userId,
      paymentReference,
      activationKey: key,
    },
    access.admin
  );
  // Only a NEW activation notifies (a replayed key answers "duplicate" and sends nothing).
  if (result.outcome === "activated") {
    await notifyPackageActivated({ customerId: conn.customerId, profileId: access.profile.id, businessName: access.profile.name ?? access.profile.username, packageId: result.packageId }, access.admin);
  }

  return outcomeJson(result.outcome, { packageId: result.packageId });
}
