import InvoiceEditor from "@/components/documents/InvoiceEditor";
import { isUuid } from "@/lib/documents/validation";

// New invoice. `?correct=<id>` starts a corrected invoice from a voided one (the copy carries no number, date or due date).
export default function NewInvoicePage({ searchParams }: { searchParams: { correct?: string } }) {
  const correctId = isUuid(searchParams.correct) ? searchParams.correct : undefined;
  return <InvoiceEditor mode="new" correctId={correctId} />;
}
