import DocumentsTabs from "@/components/documents/DocumentsTabs";
import { requireDocumentsOwner } from "@/lib/documents/access";
import { receivablesAvailable } from "@/lib/receivables/access";

export const dynamic = "force-dynamic";

// Invoice area (/dashboard/documents/**). Owner only: the profile owner, in an entitled category, on a plan with the Business Toolkit,
// never a demo account. This is a UX redirect; /api/documents/** and the database functions enforce the same rules independently.
export default async function DocumentsLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireDocumentsOwner();
  // the Debtors tab appears only once the Phase 3 tables exist (before that nobody sees a half-working section)
  const debtors = await receivablesAvailable(owner as any);
  return (
    <div className="max-w-5xl">
      <DocumentsTabs debtors={debtors} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
