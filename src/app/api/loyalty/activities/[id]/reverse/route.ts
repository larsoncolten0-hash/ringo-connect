import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { reverseActivity } from "@/lib/loyalty/engine";
import { invalidRequest, outcomeJson, readJsonObject } from "@/lib/loyalty/http";
import { isUuid, parseIdempotencyKey, parseReason } from "@/lib/loyalty/validate";

// Reverse an activity by appending a compensating row (the original is never edited or
// deleted). Needs loyalty.reverse, a written reason (3-300 chars), and an idempotency key.
// A redeemed / closed cycle cannot be reversed; the database decides that.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireLoyaltyAccess(request, "loyalty.reverse");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body || !isUuid(params.id)) return invalidRequest();
  const reason = parseReason(body.reason);
  const key = parseIdempotencyKey(body.idempotency_key);
  if (!reason || !key) return invalidRequest();

  const result = await reverseActivity(
    { profileId: access.profile.id, activityId: params.id, staffUserId: access.userId, reason, idempotencyKey: key },
    access.admin
  );
  return outcomeJson(result.outcome, { balance: result.balance });
}
