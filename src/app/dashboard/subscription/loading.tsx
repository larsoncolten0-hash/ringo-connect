import { Skeleton, RingoCardSkeleton } from "@/components/ui/Skeleton";

// Bespoke Suspense fallback for /dashboard/subscription — the real page
// (see SubscriptionView.tsx) is a plain doc header (eyebrow + title +
// subtitle), a billing-interval toggle, and a 3-column plan grid, not
// the generic dashboard/loading.tsx's stat-grid + list shape, so it gets
// its own skeleton instead. `.loading-reveal` (globals.css) holds it
// invisible for ~160ms so a fast load never flashes a skeleton at all.
export default function SubscriptionLoading() {
  return (
    <div className="loading-reveal max-w-4xl" role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>

      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-7 w-56 max-w-full mb-2" />
      <Skeleton className="h-4 w-72 max-w-full mb-6" />
      <Skeleton className="h-9 w-40 rounded-card mb-8" />

      <div className="grid sm:grid-cols-3 gap-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <RingoCardSkeleton key={i} lines={4} />
        ))}
      </div>
    </div>
  );
}
