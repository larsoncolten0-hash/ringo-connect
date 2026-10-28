import { checkGift } from "@/lib/church/giving/gifts/flow";
import { buildGiftDeps, internalError, respond } from "@/lib/church/giving/gifts/http";

export const dynamic = "force-dynamic";

// GET /api/public/church-gifts/[id]?t=<token>: the state of a gift, and its receipt once it is confirmed. The server asks Fapshi itself about the transaction and settles a success exactly once; polling,
// refreshes and several tabs all converge. The token is the donor's key: a wrong token and a missing gift look exactly the same. Nothing about the payer (phone, email) is ever returned.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const token = new URL(request.url).searchParams.get("t");
    return respond(await checkGift(buildGiftDeps(), params.id, token));
  } catch (err) {
    return internalError(err);
  }
}
