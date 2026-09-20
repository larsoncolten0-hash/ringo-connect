import { NextResponse } from "next/server";
import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { getActiveConnection } from "@/lib/loyalty/customers";
import { recordActivity } from "@/lib/loyalty/engine";
import { listActivity } from "@/lib/loyalty/history";
import { notifyAfterRecord } from "@/lib/loyalty/notify";
import { invalidRequest, notConnected, outcomeJson, readJsonObject } from "@/lib/loyalty/http";
import { isUuid, parseIdempotencyKey, parseQuantity } from "@/lib/loyalty/validate";

// Record a qualifying activity. The browser sends ONLY: which connection, which program, how
// many, and an idempotency key. It never sends a customer id, a profile id, or any
// progress/reward value: the server resolves the customer from the connection and computes
// the new progress inside one locked database transaction.
export async function POST(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.scan");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body) return invalidRequest();

  const quantity = parseQuantity(body.quantity);
  const key = parseIdempotencyKey(body.idempotency_key);
  if (!isUuid(body.program_id) || quantity === null || !key) return invalidRequest();
  if (body.via !== undefined && body.via !== "scan" && body.via !== "search") return invalidRequest();

  const conn = await getActiveConnection(access.profile.id, body.connection_id, access.admin);
  if (!conn) return notConnected();

  const result = await recordActivity(
    {
      profileId: access.profile.id,
      customerId: conn.customerId,
      programId: body.program_id,
      quantity,
      staffUserId: access.userId,
      source: body.via === "search" ? "staff_search" : "staff_scan",
      idempotencyKey: key,
    },
    access.admin
  );

  // Only AFTER the database transaction succeeded: deliver the milestones it newly claimed. The
  // recipient is the customer resolved from the verified connection, never from the request. Best
  // effort: this never throws and can never change the result above.
  await notifyAfterRecord(
    { customerId: conn.customerId, profileId: access.profile.id, businessName: access.profile.name ?? access.profile.username, programId: body.program_id, quantity, result },
    access.admin
  );

  return outcomeJson(result.outcome, {
    activityId: result.activityId,
    progress: result.progress,
    target: result.target,
    cycle: result.cycle,
    rewardUnlocked: result.notify.includes("unlocked"),
  });
}

// The business's loyalty history, newest first.
export async function GET(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.scan");
  if (!access.ok) return access.response;

  const url = new URL(request.url);
  const limitParam = Number(url.searchParams.get("limit"));
  const page = await listActivity(
    access.profile.id,
    { cursor: url.searchParams.get("cursor"), limit: Number.isInteger(limitParam) && limitParam > 0 ? limitParam : undefined },
    access.admin
  );
  return NextResponse.json(page);
}
