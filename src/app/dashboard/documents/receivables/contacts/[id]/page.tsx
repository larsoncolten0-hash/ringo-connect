import { notFound } from "next/navigation";
import StatementView from "@/components/receivables/StatementView";
import { isUuid } from "@/lib/documents/validation";

export default function ContactStatementPage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return notFound();
  return <StatementView id={params.id} />;
}
