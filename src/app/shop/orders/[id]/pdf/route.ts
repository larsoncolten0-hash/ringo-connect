import { customerReceiptPdf } from "@/lib/shopReceiptPdf/access";

export const dynamic = "force-dynamic";

// PDF of the Shop receipt (RCP-…) shown at /shop/orders/[id]. Same public posture as that page: the order's unguessable id is the
// access control. Only a receipt with a succeeded payment has a PDF. Read-only: no document row, no bookkeeping entry, nothing stored.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return customerReceiptPdf(params.id, new URL(request.url).searchParams.get("lang"));
}
