import { NextResponse } from "next/server";
import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { resolveScan } from "@/lib/loyalty/customers";
import { buildCustomerLoyaltyProfile } from "@/lib/loyalty/customerProfile";
import { invalidRequest, jsonError, notConnected, readJsonObject } from "@/lib/loyalty/http";

// QR text -> the customer's loyalty profile for THIS business.
// Chain: session -> active profile -> loyalty.scan -> QR -> customer -> ACTIVE connection.
// Malformed / unknown / revoked codes all answer with the same generic invalid_qr; a real code
// for a customer who is not connected answers not_connected and returns no customer data.
export async function POST(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.scan");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body) return invalidRequest();

  const scan = await resolveScan(access.profile.id, body.code, access.admin);
  if (scan.status === "invalid_qr") return jsonError("invalid_qr", 404);
  if (scan.status === "not_connected") return notConnected();

  const profile = await buildCustomerLoyaltyProfile(access.profile.id, scan.customer, access.admin);
  return NextResponse.json({ profile });
}
