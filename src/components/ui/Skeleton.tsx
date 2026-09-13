// Shimmering placeholder blocks for content that's still being fetched.
// The shimmer itself is a plain CSS class (see globals.css's `.skeleton`)
// rather than a framer-motion/Tailwind keyframe animation — a pseudo-
// element gradient sweep is what reads as "premium loading UI" instead of
// a flat pulsing box, and it costs nothing to keep running across many
// stacked skeleton rows since it's pure CSS, not JS-driven.
//
// This file exports layout-agnostic shapes (a bar, a circle) plus a small
// set of composed shapes (metric/card/row/list/table/profile) that mirror
// the handful of content patterns most dashboard pages are built from.
// Page-shaped compositions that don't fit one of these (a bespoke grid,
// a one-off card) still live next to whichever loading.tsx assembles
// them — see src/app/dashboard/loading.tsx and its per-section siblings.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} aria-hidden="true" />;
}

export function SkeletonCircle({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-full ${className}`} aria-hidden="true" />;
}

// Mirrors StatCard.tsx's exact markup/spacing (icon chip + label + big
// value) so a skeleton grid doesn't visibly reflow into place once the
// real stat cards arrive.
export function RingoMetricSkeleton() {
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

// `rows` copies of SkeletonRow, undecorated — callers wrap it in whatever
// card/border treatment matches their real container (that treatment
// varies enough page to page — a table card, a plain list — that baking
// one in here would fight the "closely match real content" goal).
export function RingoListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </>
  );
}

// A generic bordered card — icon chip + title + `lines` body lines — for
// grid-of-cards content (tickets, products, music store items, plans).
// The last line is shorter so a stack of these doesn't look like a solid
// block of identical bars.
export function RingoCardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-ringo-border/60 bg-ringo-surface p-4 sm:p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
        <Skeleton className="h-3.5 w-2/5" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-3/5" : "w-full"}`} />
      ))}
    </div>
  );
}

// A table-shaped skeleton — header bar + `rows` rows, each mirroring the
// "primary cell (name + meta) / meta columns / status pill / action"
// shape most of the app's real data tables share (Bookings, Orders,
// Subscribers…). `columns` controls how many middle meta columns to
// show; the leading name+meta cell and trailing status pill are always
// present since virtually every such table has both. The header row and
// meta columns hide below `sm` the same way most of these tables already
// collapse to just the primary cell + status on narrow screens.
export function RingoTableSkeleton({ rows = 6, columns = 2 }: { rows?: number; columns?: number }) {
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface overflow-hidden">
      <div className="hidden sm:flex items-center gap-4 px-4 py-3 border-b border-ringo-border/70">
        <Skeleton className="h-3 w-24" />
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-16" />
        ))}
        <Skeleton className="h-3 w-14 ml-auto" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-ringo-border/40 last:border-0">
          <div className="flex flex-col gap-1.5 w-28 shrink-0">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-2.5 w-2/3" />
          </div>
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} className="hidden sm:block h-3 w-16" />
          ))}
          <Skeleton className="h-5 w-16 rounded-full ml-auto shrink-0" />
        </div>
      ))}
    </div>
  );
}

// Avatar + name/subtitle + a row of chips — for genuinely profile-shaped
// content (a customer/subscriber detail panel, a public profile header),
// as distinct from RingoCardSkeleton's icon+title card shape.
export function RingoProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <SkeletonCircle className="w-12 h-12 shrink-0" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-20 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}
