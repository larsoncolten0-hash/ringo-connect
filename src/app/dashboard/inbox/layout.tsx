import { redirect } from "next/navigation";
import { resolveInboxOwner } from "@/lib/inbox/access";

export const dynamic = "force-dynamic";

// Inbox area (/dashboard/inbox/**). Owner only: the signed-in user's OWN profile, and only when it has a WhatsApp account. A UX redirect;
// every page below re-resolves the owner on the server and every query is scoped to that profile (and the tables' owner-read RLS).
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const access = await resolveInboxOwner();
  if (!access.ok) redirect(access.reason === "not_signed_in" ? "/auth/login" : "/dashboard");
  return <div className="max-w-6xl">{children}</div>;
}
