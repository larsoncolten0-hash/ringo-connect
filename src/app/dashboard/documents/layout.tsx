import DocumentsTabs from "@/components/documents/DocumentsTabs";
import { requireDocumentsOwner } from "@/lib/documents/access";

export const dynamic = "force-dynamic";

// Invoice area (/dashboard/documents/**). Owner only: the profile owner, in an entitled category, on a plan with the Business Toolkit,
// never a demo account. This is a UX redirect; /api/documents/** and the database functions enforce the same rules independently.
export default async function DocumentsLayout({ children }: { children: React.ReactNode }) {
  await requireDocumentsOwner();
  return (
    <div className="max-w-5xl">
      <DocumentsTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
