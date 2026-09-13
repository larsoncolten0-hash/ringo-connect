import { Skeleton, RingoMetricSkeleton, RingoListSkeleton } from "@/components/ui/Skeleton";

// The default Suspense fallback for /dashboard/** routes that don't
// define a more specific loading.tsx of their own (see e.g.
// src/app/dashboard/bookings/loading.tsx and
// src/app/dashboard/subscription/loading.tsx for sections whose real
// shape differs enough to warrant one) — shown while a server
// component's data fetch is in flight, e.g. clicking between
// Editor/Community/Analytics in the sidebar or mobile tab bar.
// DashboardShell itself (sidebar, header, tab bar) stays mounted the
// whole time since only this segment's `children` suspend; only the
// content area below shows this skeleton.
//
// Deliberately one generic shape (title + stat-card row + a list card)
// rather than a bespoke skeleton per page — it approximates most
// dashboard pages (Music/Community/Restaurant overviews, Analytics, …)
// closely enough to avoid a jarring reflow once real content lands.
// `.loading-reveal` (see globals.css) holds it invisible for ~160ms so a
// fast navigation never flashes a skeleton at all.
export default function DashboardLoading() {
  return (
    <div className="loading-reveal flex flex-col gap-6" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <RingoMetricSkeleton key={i} />
        ))}
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 sm:p-6">
        <Skeleton className="h-4 w-32 mb-4" />
        <RingoListSkeleton rows={5} />
      </div>
    </div>
  );
}
