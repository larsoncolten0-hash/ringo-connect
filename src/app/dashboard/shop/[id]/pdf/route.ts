import { sellerReceiptPdf } from "@/lib/shopReceiptPdf/access";

export const dynamic = "force-dynamic";

// Seller-facing PDF of the same Shop receipt, for the seller's own orders only (see src/lib/shopReceiptPdf/access.ts). Not gated on the
// Business Toolkit: it is part of the existing Shop section.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return sellerReceiptPdf(params.id, new URL(request.url).searchParams.get("lang"));
}
