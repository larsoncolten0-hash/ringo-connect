import { notFound } from "next/navigation";
import InvoiceEditor from "@/components/documents/InvoiceEditor";
import { isUuid } from "@/lib/documents/validation";

export default function EditInvoicePage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) notFound();
  return <InvoiceEditor mode="edit" id={params.id} />;
}
