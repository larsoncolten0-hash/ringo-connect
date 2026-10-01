import { notFound } from "next/navigation";
import DocumentView from "@/components/documents/DocumentView";
import { isUuid } from "@/lib/documents/validation";

// One invoice or receipt. The component loads it through /api/documents/[id] (owner-scoped) and shows the actions its state allows.
export default function DocumentPage({ params }: { params: { id: string } }) {
  if (!isUuid(params.id)) notFound();
  return <DocumentView id={params.id} />;
}
