import { requireTicketingProfile } from "@/lib/ticketingAuth";

export const dynamic = "force-dynamic";

// Tickets' own dashboard section — reachable from its own nav button (see
// DashboardShell), the same way Bookings has its own rather than living
// inside the main editor. Shared by Music & Entertainment and Events &
// Experiences (see requireTicketingProfile/profileHasTicketing).
export default async function TicketsDashboardLayout({ children }: { children: React.ReactNode }) {
  await requireTicketingProfile();

  return <div className="max-w-3xl">{children}</div>;
}
