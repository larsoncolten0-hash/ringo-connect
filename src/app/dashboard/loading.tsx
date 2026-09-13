import { Skeleton, StatCardSkeleton, SkeletonRow } from "@/components/ui/Skeleton";

// The Suspense fallback for every /dashboard/** route (Next only nests
// loading.tsx boundaries per segment, and none of the nested sections
// define their own — see src/app/dashboard/layout.tsx) — shown while a
// server component's data fetch is in flight, e.g. clicking between
// Editor/Community/Bookings/Analytics in the sidebar or mobile tab bar.
// DashboardShell itself (sidebar, header, tab bar) stays mounted the
// whole time since only this segment's `children` suspend; only the
// content area below shows this skeleton.
//
// Deliberately one generic shape (title + stat-card row + a list card)
// rather than a bespoke skeleton per page — it approximates most
// dashboard pages closely enough to avoid a jarring reflow once real
// content lands, without needing a matching loading.tsx for every single
// route this shell renders.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-6 animate-fade-in" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 sm:p-6">
        <Skeleton className="h-4 w-32 mb-4" />
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
