import { NextResponse } from "next/server";
import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { invalidRequest, jsonError, notFound, readJsonObject } from "@/lib/loyalty/http";
import { parseProgramUpdate, updateProgram } from "@/lib/loyalty/programs";
import { isUuid } from "@/lib/loyalty/validate";

// Edit a program's non-identity fields, or pause/resume it (active). type, action, currency
// and profile can never change: the database refuses those columns for the service role.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const access = await requireLoyaltyAccess(request, "loyalty.manage");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body || !isUuid(params.id)) return invalidRequest();

  // The program must belong to THIS profile; its (immutable) type decides which fields are valid.
  const { data: existing } = await access.admin
    .from("loyalty_programs")
    .select("id, type")
    .eq("id", params.id)
    .eq("profile_id", access.profile.id)
    .maybeSingle();
  if (!existing) return notFound();

  const parsed = parseProgramUpdate(body, (existing as any).type);
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const updated = await updateProgram(access.profile.id, params.id, parsed.value, access.admin);
  if (!updated.ok) return jsonError(updated.error, updated.error === "not_found" ? 404 : updated.error === "program_exists" ? 409 : 500);
  return NextResponse.json({ program: updated.program });
}
