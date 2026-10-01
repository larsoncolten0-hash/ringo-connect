import InvoiceEditor from "@/components/documents/InvoiceEditor";
import { isUuid } from "@/lib/documents/validation";

// New invoice. `?credit=1` opens the credit-sale preset (customer and due date required, optional deposit). `?correct=<id>` starts a corrected invoice from a voided one (the copy carries no number, date or due date).
export default function NewInvoicePage({ searchParams }: { searchParams: { correct?: string; credit?: string } }) {
  const correctId = isUuid(searchParams.correct) ? searchParams.correct : undefined;
  return <InvoiceEditor mode="new" correctId={correctId} credit={searchParams.credit === "1"} />;
}
