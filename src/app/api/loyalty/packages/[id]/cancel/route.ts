import { requireLoyaltyAccess } from "@/lib/loyalty/access";
import { cancelPackage } from "@/lib/loyalty/engine";
import { invalidRequest, outcomeJson } from "@/lib/loyalty/http";
import { isUuid } from "@/lib/loyalty/validate";

// Cancel an active package (e.g. activated by mistake). History is kept; who cancelled it and
// when is recorded. Needs loyalty.manage.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const access = await requireLoyaltyAccess(request, "loyalty.manage");
  if (!access.ok) return access.response;
  if (!isUuid(params.id)) return invalidRequest();

  const outcome = await cancelPackage({ profileId: access.profile.id, packageId: params.id, staffUserId: access.userId }, access.admin);
  return outcomeJson(outcome);
}
