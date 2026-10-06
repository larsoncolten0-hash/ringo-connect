import DocumentsTabs from "@/components/documents/DocumentsTabs";
import { resolveToolkitLock } from "@/lib/toolkitLock";
import ToolkitLocked from "@/components/subscription/ToolkitLocked";
import { requireDocumentsOwner } from "@/lib/documents/access";
import { receivablesAvailable } from "@/lib/receivables/access";

export const dynamic = "force-dynamic";

// Invoice area (/dashboard/documents/**). Owner only: the profile owner, in an entitled category, on a plan with the Business Toolkit,
// never a demo account. This is a UX redirect; /api/documents/** and the database functions enforce the same rules independently.
export default async function DocumentsLayout({ children }: { children: React.ReactNode }) {
  // A Free owner in an entitled category sees this tool locked (what it does + an upgrade call to action) instead of being sent away. The tool itself
  // is never rendered, and its API and database functions still refuse a plan without the business tools.
  const lock = await resolveToolkitLock();
  if (lock.locked) return <div className="max-w-5xl"><ToolkitLocked tool="documents" /></div>;
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
