import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { getActiveConnection } from "@/lib/loyalty/customers";
import { redeemReward } from "@/lib/loyalty/engine";
import { notifyAfterRedeem } from "@/lib/loyalty/notify";
import { invalidRequest, jsonError, notConnected, outcomeJson, readJsonObject } from "@/lib/loyalty/http";
import { isUuid } from "@/lib/loyalty/validate";

// Redeem a reward, always explicitly (never automatic). The browser sends the connection it
// is serving; the reward must belong to THAT customer and THIS business, otherwise it is
// reported as not found (no hint whether the id exists elsewhere).
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireLoyaltyAccess(request, "loyalty.scan");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body || !isUuid(params.id)) return invalidRequest();

  const conn = await getActiveConnection(access.profile.id, body.connection_id, access.admin);
  if (!conn) return notConnected();

  const { data: reward } = await access.admin
    .from("loyalty_rewards")
    .select("id")
    .eq("id", params.id)
    .eq("profile_id", access.profile.id)
    .eq("customer_id", conn.customerId)
    .maybeSingle();
  if (!reward) return jsonError("not_found", 404);

  const result = await redeemReward({ profileId: access.profile.id, rewardId: params.id, staffUserId: access.userId }, access.admin);
  // After the redemption is committed (best effort, never throws).
  await notifyAfterRedeem({ customerId: result.customerId, businessName: access.profile.name ?? access.profile.username, result }, access.admin);

  return outcomeJson(result.outcome, { title: result.title });
}
