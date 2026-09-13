import { RingoMetricSkeleton, RingoTableSkeleton } from "@/components/ui/Skeleton";

// Bespoke Suspense fallback for /dashboard/bookings — its real content
// (see BookingsList.tsx) is a 4-metric row plus an actual <table>, not
// the generic dashboard/loading.tsx's avatar-row list, so a table-shaped
// skeleton is what avoids a layout jump once the real rows land.
// `.loading-reveal` (globals.css) holds it invisible for ~160ms so a
// fast page load never flashes a skeleton at all.
export default function BookingsLoading() {
  return (
    <div className="loading-reveal flex flex-col gap-5" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <RingoMetricSkeleton key={i} />
        ))}
      </div>

      <RingoTableSkeleton rows={6} columns={2} />
    </div>
  );
}
