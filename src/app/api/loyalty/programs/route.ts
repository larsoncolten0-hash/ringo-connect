import { NextResponse } from "next/server";
import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { getLoyaltyOptions } from "@/lib/loyalty/categories";
import { invalidRequest, jsonError, readJsonObject } from "@/lib/loyalty/http";
import { createProgram, listPrograms, parseProgramCreate } from "@/lib/loyalty/programs";

// Programs are managed with loyalty.manage. The profile is the caller's own (from the
// session); the currency is taken from that profile, never trusted from the browser when the
// profile has one; type/action are checked against what this profile's categories allow.
export async function GET(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.manage");
  if (!access.ok) return access.response;
  return NextResponse.json({ programs: await listPrograms(access.profile.id, access.admin) });
}

export async function POST(request: Request) {
  const access = await requireLoyaltyAccess(request, "loyalty.manage");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body) return invalidRequest();

  const options = getLoyaltyOptions(access.profile);
  if (options.availability === "hidden") return jsonError("invalid_request", 400);

  const parsed = parseProgramCreate(body, options, access.profile.currency);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const created = await createProgram(access.profile.id, access.userId, parsed.value, access.admin);
  if (!created.ok) return jsonError(created.error, created.error === "program_exists" ? 409 : 500);
  return NextResponse.json({ program: created.program }, { status: 201 });
}
