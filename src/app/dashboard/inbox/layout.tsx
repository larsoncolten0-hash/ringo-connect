import { redirect } from "next/navigation";
import { resolveInboxActor } from "@/lib/inbox/actor";

export const dynamic = "force-dynamic";

// Inbox area (/dashboard/inbox/**). The OWNER (the signed-in user's own profile with a WhatsApp account) or a TEAM MEMBER of an organization that has one
// (an active role with inbox.view, the Team plan gate, decided by the database). A UX redirect; every page below re-resolves the actor on the server and every
// query is scoped to the server-resolved organization (and the tables' owner-read / staff-read RLS).
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const access = await resolveInboxActor();
  if (!access.ok) redirect(access.reason === "not_signed_in" ? "/auth/login" : "/dashboard");
  return <div className="max-w-6xl">{children}</div>;
}
