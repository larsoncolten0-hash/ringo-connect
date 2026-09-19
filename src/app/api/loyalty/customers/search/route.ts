import { NextResponse } from "next/server";
import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { searchConnectedCustomers } from "@/lib/loyalty/customers";

// Fallback to scanning: search the business's OWN active connections. 3+ characters, capped
// results, masked email/phone, no customer ids in the response (only connection ids).
export async function GET(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.scan");
  if (!access.ok) return access.response;

  const q = new URL(request.url).searchParams.get("q");
  const result = await searchConnectedCustomers(access.profile.id, q, access.admin);
  return NextResponse.json(result);
}
