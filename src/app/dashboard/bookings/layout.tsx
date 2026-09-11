import { requireOwnProfile } from "@/lib/bookingAuth";
import BookingsTabs from "@/components/dashboard/BookingsTabs";

export const dynamic = "force-dynamic";

export default async function BookingsDashboardLayout({ children }: { children: React.ReactNode }) {
  await requireOwnProfile();

  return (
    <div className="max-w-5xl">
      <BookingsTabs />
      <div className="mt-5">{children}</div>
    </div>
  );
}
