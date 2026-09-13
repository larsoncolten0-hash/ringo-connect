// Shimmering placeholder blocks for content that's still being fetched.
// The shimmer itself is a plain CSS class (see globals.css's `.skeleton`)
// rather than a framer-motion/Tailwind keyframe animation — a pseudo-
// element gradient sweep is what reads as "premium loading UI" instead of
// a flat pulsing box, and it costs nothing to keep running across many
// stacked skeleton rows since it's pure CSS, not JS-driven.
//
// This file only exports layout-agnostic shapes (a bar, a circle, a
// card). Page-shaped compositions (a stat-card grid, a table) live next
// to whichever loading.tsx assembles them — see src/app/dashboard/loading.tsx.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" />;
}

export function SkeletonCircle({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-full ${className}`} aria-hidden="true" />;
}

// Mirrors StatCard.tsx's exact markup/spacing (icon chip + label + big
// value) so the skeleton grid doesn't visibly reflow into place once the
// real stat cards arrive.
export function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 sm:p-5">
      <div className="flex items-center gap-2.5 mb-3">
        <Skeleton className="w-8 h-8 rounded-xl shrink-0" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-7 w-14" />
    </div>
  );
}

// A single avatar + two-line row — the shape of most list/table content
// across the dashboard (subscribers, bookings, orders, requests…).
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-ringo-border/60 last:border-0">
      <SkeletonCircle className="w-9 h-9 shrink-0" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      <Skeleton className="h-5 w-14 rounded-full shrink-0" />
    </div>
  );
}
