import { NextResponse } from "next/server";
import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { getLoyaltyOptions } from "@/lib/loyalty/categories";
import { invalidRequest, jsonError, notFound, readJsonObject } from "@/lib/loyalty/http";
import { parseTemplateUpdate, updateTemplate } from "@/lib/loyalty/templates";
import { isUuid } from "@/lib/loyalty/validate";

// Edit, archive (active:false) or restore a template. Packages already sold are snapshots and
// are never affected.
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const access = await requireLoyaltyAccess(request, "loyalty.manage");
  if (!access.ok) return access.response;

  const body = await readJsonObject(request);
  if (!body || !isUuid(params.id)) return invalidRequest();

  const parsed = parseTemplateUpdate(body, getLoyaltyOptions(access.profile));
  if (!parsed.ok) return jsonError(parsed.error, 400);

  const updated = await updateTemplate(access.profile.id, params.id, parsed.value, access.admin);
  if (!updated.ok) return updated.error === "not_found" ? notFound() : jsonError(updated.error, 500);
  return NextResponse.json({ template: updated.template });
}
