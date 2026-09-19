import { NextResponse } from "next/server";
import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { getActiveConnection } from "@/lib/loyalty/customers";
import { buildCustomerLoyaltyProfile } from "@/lib/loyalty/customerProfile";
import { invalidRequest, notConnected, readJsonObject } from "@/lib/loyalty/http";

// Open a customer's loyalty profile from a search hit or after an action (refresh).
// The browser sends only a connection id; it is re-resolved against THIS profile every time.
export async function POST(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.scan");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body) return invalidRequest();

  const conn = await getActiveConnection(access.profile.id, body.connection_id, access.admin);
  if (!conn) return notConnected();

  const profile = await buildCustomerLoyaltyProfile(access.profile.id, conn, access.admin);
  return NextResponse.json({ profile });
}
